# Memory Retrieval — How It Works

This document describes exactly how memories are selected and injected into each chat dialogue, based on the actual code.

There are two independent memory stores. Both are queried on every chat request.

---

## Two Stores, Two Purposes

| Store | Technology | What it holds | When it's used |
|---|---|---|---|
| **key_info** | ChromaDB | Distilled facts — events, decisions, relationships, self-insights. Rated 1–4 by importance. | Automatically injected into every chat as the AI's passive memory |
| **messages** | PostgreSQL + pgvector | Raw conversation chunks with embeddings | Queried only when the AI explicitly calls `[SEARCH_MEMORIES: query]` |

---

## Automatic Chroma Injection (Every Chat)

### Step 1 — Multi-query extraction

`chroma_pipeline.py` → `query_similar_multi()`

The current user message is split into queries:
- The full message text (always)
- Each sentence separately, if the message is longer than 80 characters (up to 4 sentences)

Each query is run through ChromaDB independently. Results are merged and deduplicated by `id`, keeping the **lowest distance** (best match) per fact.

### Step 2 — Hard filters

`chroma_pipeline.py` → `_query_similar()`

Two facts are excluded from every result:

1. **Distance > 0.65** — too semantically distant, not relevant enough.
2. **Created or last used within the last `days_cutoff` days** (default: 2 days) — recently surfaced facts are suppressed to prevent the same anchors from dominating every conversation.

The `days_cutoff` filter checks both `created_at` and `last_used` metadata fields.

### Step 3 — Scoring and boosts

After raw vector search, each candidate fact's distance score is adjusted by a series of boosts and penalties. Lower final score = higher priority.

```
initial_score = cosine_distance (0.0 = identical, 1.0 = opposite)

boosts applied in order:

1. Keyword boost         −0.25 per matching lemma/synonym
2. Exact match boost     −0.15 if full text matches, −0.10 if subset
3. Impressive boost      −0.12 if impressive=4, −0.05 if impressive=3
                         (skipped entirely for "Вдохновение/Inspiration" category)
4. Recency penalty       +small per day beyond 60 days old (max +0.10)
                         (skipped for "Вдохновение/Inspiration" category)
5. Inspiration penalty   applied ONLY to "Вдохновение/Inspiration" category:
                         +0.15 if last_used within 3 days
                         +0.03 per use, capped at +0.20
```

The Inspiration-category facts (self-insights about who the AI is) have their own dedicated penalty track. They cannot get the impressive boost or recency boost — only their own frequency/recency suppression. This prevents the same character anchors from appearing in every reply.

### Step 4 — Final selection

Facts are sorted ascending by final score. Top `top_k` (default: 5) are returned.

### Step 5 — Injection into context

`api/chat.py` → `_build_chroma_block()`

Selected facts are formatted as:

```
Your memories:
— (today) fact text
— (3 days ago) fact text
— (2 month ago) fact text
```

This block is injected as an **assistant role message** in the LLM message list — just before the current user message. It appears as the AI "remembering" rather than as a system instruction.

```
[SYSTEM]      soul.md + skill instructions + workbench
[USER]        history pair N-5 user text
[ASSISTANT]   history pair N-5 assistant reply
...
[USER]        history pair N user text
[ASSISTANT]   history pair N assistant reply
[ASSISTANT]   "Вот что я помню:\n— fact1\n— fact2..."    ← Chroma block here
[USER]        current message
```

### Step 6 — Usage update

After the response is sent, `update_usage()` is called for every fact that was retrieved. This increments the `frequency` counter and stamps `last_used` in the metadata. ChromaDB doesn't support in-place updates, so each updated fact is deleted and re-added with new metadata.

---

## Explicit Memory Search (AI-initiated)

When the AI emits `[SEARCH_MEMORIES: query]` during a response, a different pipeline runs:

`infrastructure/memory/retrieval.py` → `retrieve_relevant_pairs()`

This searches **raw past conversations** stored in PostgreSQL, not distilled facts.

1. NLP tokenization via `FocusPointPipeline` — lemmatization + synonym expansion (pymorphy3 + RuWordNet for RU, NLTK WordNet for EN).
2. If embeddings available: KNN query using pgvector `<=>` cosine distance, fetching top 200 candidates.
3. If embeddings unavailable: fallback to PostgreSQL array `&&` overlap on `focus_point` keyword arrays.
4. Each candidate scored:
   ```
   composite = min(1.0, cosine_similarity + keyword_boost + exact_boost)
   ```
   - `keyword_boost`: +0.10 per matching lemma, max +0.25
   - `exact_boost`: +0.15 for exact match, +0.10 for subset
5. Floor filters: cosine < 0.35 or total < 0.40 are discarded.
6. Deduplicate by `pair_id`, keep best-scored chunk per pair.
7. Full user+assistant text fetched for the top pairs.

Results are injected back into the conversation as a continuation prompt, and the AI continues its reply with awareness of what it found.

---

## Memory Writing — How Facts Get Created

Facts are created through three paths:

### Path 1 — AI saves during chat (`[SAVE_MEMORY]`)

`infrastructure/memory/key_info.py` → `extract_and_store()`

1. AI emits `[SAVE_MEMORY: hint]` in its reply.
2. LLM call with `key_info_extraction.md` prompt: extracts a clean fact + category from the last 2–3 conversation pairs, guided by the hint.
3. LLM call with `key_info_impressive.md`: rates the fact 1–4.
4. Dedup check: `find_similar()` with threshold 0.35. If a similar fact exists, an LLM call with `key_info_dedup.md` decides: `skip` / `replace` / `keep_both`.
5. `pipeline.add_entry()` stores the fact in ChromaDB with embedding.

### Path 2 — Self-insights from reflection (`workbench_rotator.py`)

After workbench notes age past 48h, the rotator runs an LLM pass over them and extracts insights about the AI's own character. These are forced into the **Вдохновение / Inspiration** category with `impressive=3` and go through the same dedup pipeline.

### Path 3 — Reflection writes directly (`reflection_engine.py`)

During autonomous reflection, the AI can emit `[WRITE_NOTE: text]` (workbench) or trigger a `[SAVE_MEMORY]`-equivalent through the post-analyzer flow.

---

## NLP Pipeline

Both Chroma and pgvector retrieval use `FocusPointPipeline` (`infrastructure/memory/focus_point.py`) for keyword extraction:

- Language detection (Russian vs. English)
- Tokenization and lemmatization:
  - **Russian**: `pymorphy3` for morphological analysis, `RuWordNet` for synonyms
  - **English**: NLTK tokenizer, `WordNet` for synonyms
- Stop-word removal
- Returns a ranked list of lemmas + synonyms used for keyword boosting

---

## Key Files

| File | Role |
|---|---|
| `infrastructure/memory/chroma_pipeline.py` | ChromaDB reads/writes, scoring, boosts, penalties |
| `infrastructure/memory/retrieval.py` | pgvector search over raw conversations |
| `infrastructure/memory/key_info.py` | SAVE_MEMORY handler — extract, rate, dedup, store |
| `infrastructure/memory/focus_point.py` | NLP — lemmatization, synonyms, language detection |
| `api/chat.py` — `_build_chroma_block()` | Formats facts for context injection |
| `api/chat.py` — context assembly (~line 430) | Assembles the full LLM message list |
