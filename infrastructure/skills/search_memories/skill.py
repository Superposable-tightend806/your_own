from __future__ import annotations

import re
from pathlib import Path

from infrastructure.skills.base import SkillBase, SkillContext, SkillResult


class SearchMemoriesSkill(SkillBase):
    id = "search_memories"
    cmd_name = "SEARCH_MEMORIES"
    display = {"en": "Search Memories", "ru": "Поиск воспоминаний"}
    description = {
        "en": "AI searches raw conversation history in pgvector for relevant past context.",
        "ru": "AI ищет в истории разговоров через pgvector релевантный контекст.",
    }
    example = "[SEARCH_MEMORIES: breakup, longing, ex-boyfriend]"
    action_type = "agentic"
    persist_in_db = True
    parse_re = re.compile(r"\[SEARCH[_ ]MEMORIES:\s*(.*?)\]", re.DOTALL | re.IGNORECASE)
    _prompt_dir = Path(__file__).resolve().parent

    def pre_sse_events(self, match: re.Match) -> list[tuple[str, dict]]:
        return [("search_start", {"query": match.group(1).strip()})]

    def get_cont_hint(self, lang: str, attempts_left: int) -> str:
        return self.get_section("search_cont_hint", lang, attempts_left=attempts_left)

    async def execute(self, match: re.Match, ctx: SkillContext) -> SkillResult:
        from infrastructure.memory.retrieval import humanize_timestamp, retrieve_relevant_pairs

        query = match.group(1).strip()
        search_results = await retrieve_relevant_pairs(
            session=ctx.db,
            account_id=ctx.account_id,
            query_text=query,
            top_n=6,
            exclude_pair_ids=[],
            min_age_days=ctx.cutoff_days,
        )
        ctx.logger.info("[search_memories] results=%d query=%s", len(search_results), query[:120])

        found_pairs = [
            {
                "time": humanize_timestamp(p.created_at, ctx.lang),
                "user": p.user_text or "",
                "assistant": p.assistant_text or "",
            }
            for p in search_results
        ]

        sse_events: list[tuple[str, dict]] = [
            ("search_results", {"query": query, "results": found_pairs}),
        ]

        if found_pairs:
            parts: list[str] = []
            for item in found_pairs:
                parts.append(f"[{item['time']}]")
                if item["user"]:
                    parts.append(f"  Они: {item['user']}")
                if item["assistant"]:
                    parts.append(f"  Я: {item['assistant']}")
                parts.append("")
            results_block = "\n".join(parts)
            continuation = self.get_section("search_continuation", ctx.lang, results_block=results_block)
        else:
            continuation = self.get_section("search_empty", ctx.lang, query=query)

        return SkillResult(sse_events=sse_events, continuation=continuation)


skill = SearchMemoriesSkill()
