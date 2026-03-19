"""Tests for chat skills prompt and skill command parsing (api/chat.py).

Covers:
  1. Prompt loading — all placeholders resolve, no KeyError, both langs.
  2. _strip_skills — correctly extracts each skill type from a response.
  3. Regex parity — every command the prompt advertises is detected by code.
  4. Skill interaction edge cases (order, mixed, underscore vs space, case).

No database, no LLM, no network — pure Python.

Run with:
    cd C:\\Users\\User\\PycharmProjects\\your_own
    python -m pytest tests/autonomy/test_chat_skills.py -v
"""
from __future__ import annotations

import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import pytest
from infrastructure.llm.prompt_loader import get_prompt

_PROMPTS = "infrastructure/api/prompts/chat_skills.md"

# ── Replicate _strip_skills exactly as in api/chat.py ─────────────────────────
# (copied so the test has no runtime dependency on FastAPI / DB imports)

def _strip_skills(text: str):
    """Returns (clean_text, save_m, search_m, web_m, img_m, sched_m)."""
    save_m   = list(re.finditer(r"\[SAVE[_ ]MEMORY:\s*(.*?)\]",     text, re.DOTALL | re.IGNORECASE))
    search_m = list(re.finditer(r"\[SEARCH[_ ]MEMORIES:\s*(.*?)\]", text, re.DOTALL | re.IGNORECASE))
    web_m    = list(re.finditer(r"\[WEB[_ ]SEARCH:\s*(.*?)\]",      text, re.DOTALL | re.IGNORECASE))
    img_m    = list(re.finditer(r"\[GENERATE[_ ]IMAGE:\s*(.*?)\]",  text, re.DOTALL | re.IGNORECASE))
    sched_m  = list(re.finditer(r"\[SCHEDULE[_ ]MESSAGE:\s*(.*?)\]",text, re.DOTALL | re.IGNORECASE))
    all_m    = sorted(save_m + search_m + web_m + img_m + sched_m, key=lambda m: m.start())
    clean    = text[: all_m[0].start()].rstrip() if all_m else text
    return clean, save_m, search_m, web_m, img_m, sched_m

# Replicate _CMD_OPEN_RE from chat.py
_CMD_OPEN_RE = re.compile(
    r"\[(SEARCH[_ ]MEMORIES|WEB[_ ]SEARCH|SAVE[_ ]MEMORY|GENERATE[_ ]IMAGE|SCHEDULE[_ ]MESSAGE):",
    re.IGNORECASE,
)


# ── 1. Prompt loading ─────────────────────────────────────────────────────────

class TestPromptLoading:
    """Verify that the prompt file loads and all placeholders resolve."""

    def _build_skills(self, lang: str) -> str:
        return get_prompt(
            _PROMPTS,
            lang=lang,
            section="skills",
            now_str="2026-03-18 11:00",
            workbench_block="",
        )

    def test_ru_loads(self):
        text = self._build_skills("ru")
        assert "2026-03-18 11:00" in text
        assert "{" not in text, "Unresolved placeholder in RU skills prompt"

    def test_en_loads(self):
        text = self._build_skills("en")
        assert "2026-03-18 11:00" in text
        assert "{" not in text, "Unresolved placeholder in EN skills prompt"

    def test_ru_has_all_commands(self):
        text = self._build_skills("ru")
        for cmd in ["SEARCH_MEMORIES", "WEB_SEARCH", "SAVE_MEMORY",
                    "GENERATE_IMAGE", "SCHEDULE_MESSAGE"]:
            assert cmd in text, f"Command {cmd} missing from RU skills prompt"

    def test_en_has_all_commands(self):
        text = self._build_skills("en")
        for cmd in ["SEARCH_MEMORIES", "WEB_SEARCH", "SAVE_MEMORY",
                    "GENERATE_IMAGE", "SCHEDULE_MESSAGE"]:
            assert cmd in text, f"Command {cmd} missing from EN skills prompt"

    def test_workbench_block_injected(self):
        wb = "Your recent entries from the inner journal:\n[2026-03-18 10:00] She's sleeping.\n\n"
        text = get_prompt(
            _PROMPTS, lang="en", section="skills",
            now_str="2026-03-18 11:00",
            workbench_block=wb,
        )
        assert "She's sleeping." in text

    def test_workbench_block_empty(self):
        text = get_prompt(
            _PROMPTS, lang="ru", section="skills",
            now_str="2026-03-18 11:00",
            workbench_block="",
        )
        assert "## Skills" in text

    def test_search_continuation_ru(self):
        text = get_prompt(
            _PROMPTS, lang="ru", section="search_continuation",
            results_block="[вчера] Она: привет\n  Я: привет",
        )
        assert "вчера" in text
        assert "{" not in text

    def test_search_continuation_en(self):
        text = get_prompt(
            _PROMPTS, lang="en", section="search_continuation",
            results_block="[yesterday] Them: hi\n  Me: hi",
        )
        assert "yesterday" in text
        assert "{" not in text

    def test_search_empty_ru(self):
        text = get_prompt(_PROMPTS, lang="ru", section="search_empty", query="бывший парень")
        assert "бывший парень" in text
        assert "{" not in text

    def test_search_empty_en(self):
        text = get_prompt(_PROMPTS, lang="en", section="search_empty", query="old friend")
        assert "old friend" in text
        assert "{" not in text

    def test_search_cont_hint_ru(self):
        text = get_prompt(_PROMPTS, lang="ru", section="search_cont_hint", attempts_left=3)
        assert "3" in text
        assert "{" not in text

    def test_search_cont_hint_en(self):
        text = get_prompt(_PROMPTS, lang="en", section="search_cont_hint", attempts_left=2)
        assert "2" in text
        assert "{" not in text

    def test_web_continuation_ru(self):
        text = get_prompt(_PROMPTS, lang="ru", section="web_continuation", web_query="погода Ереван")
        assert "погода Ереван" in text
        assert "{" not in text

    def test_web_continuation_en(self):
        text = get_prompt(_PROMPTS, lang="en", section="web_continuation", web_query="weather Yerevan")
        assert "weather Yerevan" in text
        assert "{" not in text

    def test_image_error_ru(self):
        text = get_prompt(_PROMPTS, lang="ru", section="image_error")
        assert "{" not in text
        assert len(text) > 0

    def test_image_error_en(self):
        text = get_prompt(_PROMPTS, lang="en", section="image_error")
        assert "{" not in text
        assert len(text) > 0

    def test_trailing_hint_ru(self):
        text = get_prompt(_PROMPTS, lang="ru", section="trailing_hint")
        assert "{" not in text

    def test_trailing_hint_en(self):
        text = get_prompt(_PROMPTS, lang="en", section="trailing_hint")
        assert "{" not in text


# ── 2. _strip_skills parsing ──────────────────────────────────────────────────

class TestStripSkills:
    """Unit-test _strip_skills without invoking FastAPI."""

    def test_no_skills(self):
        text = "Просто текст без команд."
        clean, save, search, web, img, sched = _strip_skills(text)
        assert clean == text
        assert save == search == web == img == sched == []

    def test_save_memory(self):
        text = "Отвечаю.\n[SAVE_MEMORY: Она боится темноты]"
        clean, save, search, web, img, sched = _strip_skills(text)
        assert clean == "Отвечаю."
        assert len(save) == 1
        assert save[0].group(1).strip() == "Она боится темноты"
        assert search == web == img == sched == []

    def test_search_memories(self):
        text = "Дай подумаю.\n[SEARCH_MEMORIES: бывший, расставание, тоска]"
        clean, save, search, web, img, sched = _strip_skills(text)
        assert "Дай подумаю" in clean
        assert len(search) == 1
        assert "расставание" in search[0].group(1)

    def test_web_search(self):
        text = "Посмотрю.\n[WEB_SEARCH: погода Ереван сегодня]"
        clean, save, search, web, img, sched = _strip_skills(text)
        assert len(web) == 1
        assert "Ереван" in web[0].group(1)

    def test_generate_image(self):
        text = "Вот.\n[GENERATE_IMAGE: gpt5 | coffee shop at golden hour]"
        clean, save, search, web, img, sched = _strip_skills(text)
        assert len(img) == 1
        raw = img[0].group(1).strip()
        model, prompt = raw.split("|", 1)
        assert model.strip() == "gpt5"
        assert "coffee" in prompt

    def test_schedule_message(self):
        text = "Напишу утром.\n[SCHEDULE_MESSAGE: 2026-03-19 09:00 | Доброе утро]"
        clean, save, search, web, img, sched = _strip_skills(text)
        assert len(sched) == 1
        raw = sched[0].group(1).strip()
        ts_str, msg = raw.split("|", 1)
        assert ts_str.strip() == "2026-03-19 09:00"
        assert "Доброе утро" in msg

    def test_clean_text_is_everything_before_first_skill(self):
        text = (
            "Первая часть ответа.\n"
            "[SEARCH_MEMORIES: что-то]\n"
            "[SAVE_MEMORY: факт]"
        )
        clean, *_ = _strip_skills(text)
        assert clean == "Первая часть ответа."

    def test_multiple_saves(self):
        text = (
            "Запомню всё.\n"
            "[SAVE_MEMORY: Факт первый]\n"
            "[SAVE_MEMORY: Факт второй]"
        )
        clean, save, *_ = _strip_skills(text)
        assert len(save) == 2

    def test_underscore_and_space_variants(self):
        """Both SEARCH_MEMORIES and SEARCH MEMORIES must be detected."""
        for cmd in ["[SEARCH_MEMORIES: test]", "[SEARCH MEMORIES: test]"]:
            _, _, search, *_ = _strip_skills(f"Текст.\n{cmd}")
            assert len(search) == 1, f"Variant not detected: {cmd}"

    def test_case_insensitive(self):
        text = "text.\n[save_memory: lowercase fact]"
        _, save, *_ = _strip_skills(text)
        assert len(save) == 1

    def test_multiline_fact(self):
        text = "ok.\n[SAVE_MEMORY: First line\nSecond line]"
        _, save, *_ = _strip_skills(text)
        assert len(save) == 1
        assert "Second line" in save[0].group(1)


# ── 3. _CMD_OPEN_RE — buffering trigger ───────────────────────────────────────

class TestCmdOpenRe:
    """Verify that the buffering regex fires on all skill-opening brackets."""

    @pytest.mark.parametrize("fragment", [
        "[SEARCH_MEMORIES:",
        "[SEARCH MEMORIES:",
        "[WEB_SEARCH:",
        "[WEB SEARCH:",
        "[SAVE_MEMORY:",
        "[SAVE MEMORY:",
        "[GENERATE_IMAGE:",
        "[GENERATE IMAGE:",
        "[SCHEDULE_MESSAGE:",
        "[SCHEDULE MESSAGE:",
    ])
    def test_detects_open_bracket(self, fragment: str):
        assert _CMD_OPEN_RE.search(fragment), f"Not detected: {fragment}"

    def test_does_not_fire_on_plain_text(self):
        assert not _CMD_OPEN_RE.search("Just a regular sentence.")

    def test_does_not_fire_on_closed_bracket(self):
        assert not _CMD_OPEN_RE.search("[GENERATED_IMAGE: /path/to/img.png]")


# ── 4. Simulated full LLM responses ──────────────────────────────────────────

_CASES = [
    (
        "plain reply, no skills",
        "Привет. Я рад тебя видеть.",
        dict(save=0, search=0, web=0, img=0, sched=0),
        "Привет",
    ),
    (
        "save only",
        "Запомню.\n[SAVE_MEMORY: Она переехала в Ереван]",
        dict(save=1, search=0, web=0, img=0, sched=0),
        "Запомню",
    ),
    (
        "search only",
        "Дай вспомню.\n[SEARCH_MEMORIES: переезд, Ереван, квартира]",
        dict(save=0, search=1, web=0, img=0, sched=0),
        "вспомню",
    ),
    (
        "web search only",
        "Проверю погоду.\n[WEB_SEARCH: weather Yerevan today]",
        dict(save=0, search=0, web=1, img=0, sched=0),
        "Проверю",
    ),
    (
        "image only",
        "Вот картинка.\n[GENERATE_IMAGE: gemini | stars over Yerevan at night]",
        dict(save=0, search=0, web=0, img=1, sched=0),
        "картинка",
    ),
    (
        "schedule only",
        "Напишу утром.\n[SCHEDULE_MESSAGE: 2026-03-19 08:00 | Good morning]",
        dict(save=0, search=0, web=0, img=0, sched=1),
        "утром",
    ),
    (
        "search + save together",
        "Проверю и запомню.\n[SEARCH_MEMORIES: job, team]\n[SAVE_MEMORY: She got a promotion]",
        dict(save=1, search=1, web=0, img=0, sched=0),
        "Проверю",
    ),
    (
        "all skills at once",
        (
            "Всё сразу.\n"
            "[SEARCH_MEMORIES: test]\n"
            "[WEB_SEARCH: Yerevan weather]\n"
            "[SAVE_MEMORY: fact]\n"
            "[GENERATE_IMAGE: gpt5 | prompt]\n"
            "[SCHEDULE_MESSAGE: 2026-03-19 09:00 | msg]"
        ),
        dict(save=1, search=1, web=1, img=1, sched=1),
        "Всё сразу",
    ),
]


@pytest.mark.parametrize("desc,text,counts,clean_fragment", _CASES)
def test_simulated_llm_response(desc, text, counts, clean_fragment):
    clean, save, search, web, img, sched = _strip_skills(text)
    assert len(save)   == counts["save"],   f"[{desc}] save count"
    assert len(search) == counts["search"], f"[{desc}] search count"
    assert len(web)    == counts["web"],    f"[{desc}] web count"
    assert len(img)    == counts["img"],    f"[{desc}] img count"
    assert len(sched)  == counts["sched"],  f"[{desc}] sched count"
    if clean_fragment:
        assert clean_fragment in clean, f"[{desc}] clean text missing '{clean_fragment}'"


# ── 5. SCHEDULE_MESSAGE payload parsing ───────────────────────────────────────

class TestScheduleMessageParsing:
    """Verify that ts_str and message can be extracted from matched group."""

    @pytest.mark.parametrize("raw,expected_ts,expected_msg", [
        ("2026-03-19 09:00 | Доброе утро", "2026-03-19 09:00", "Доброе утро"),
        ("2026-03-19 22:30 | Good night, sleep well", "2026-03-19 22:30", "Good night, sleep well"),
        (" 2026-03-19 08:00 |  Привет  ", "2026-03-19 08:00", "Привет"),
    ])
    def test_split(self, raw: str, expected_ts: str, expected_msg: str):
        text = f"ответ.\n[SCHEDULE_MESSAGE: {raw}]"
        _, _, _, _, _, sched = _strip_skills(text)
        assert len(sched) == 1
        arg = sched[0].group(1).strip()
        assert "|" in arg
        ts_str, msg = arg.split("|", 1)
        assert ts_str.strip() == expected_ts
        assert msg.strip() == expected_msg

    def test_missing_pipe_not_parsed_as_valid(self):
        """If there's no pipe the scheduler should skip it — verify we detect that."""
        text = "ok.\n[SCHEDULE_MESSAGE: 2026-03-19 09:00 without pipe]"
        _, _, _, _, _, sched = _strip_skills(text)
        assert len(sched) == 1
        arg = sched[0].group(1).strip()
        assert "|" not in arg  # caller must check and skip


# ── 6. Prompt ↔ code parity ───────────────────────────────────────────────────

class TestPromptCodeParity:
    """Every skill advertised in the prompt must have a matching regex in _strip_skills."""

    _ADVERTISED = ["SEARCH_MEMORIES", "WEB_SEARCH", "SAVE_MEMORY",
                   "GENERATE_IMAGE", "SCHEDULE_MESSAGE"]

    @pytest.mark.parametrize("cmd", _ADVERTISED)
    def test_cmd_in_ru_prompt(self, cmd: str):
        text = get_prompt(
            _PROMPTS, lang="ru", section="skills",
            now_str="2026-03-18 11:00", workbench_block="",
        )
        assert cmd in text, f"{cmd} missing from RU prompt"

    @pytest.mark.parametrize("cmd", _ADVERTISED)
    def test_cmd_in_en_prompt(self, cmd: str):
        text = get_prompt(
            _PROMPTS, lang="en", section="skills",
            now_str="2026-03-18 11:00", workbench_block="",
        )
        assert cmd in text, f"{cmd} missing from EN prompt"

    @pytest.mark.parametrize("cmd", _ADVERTISED)
    def test_cmd_parsed_by_strip_skills(self, cmd: str):
        """Each advertised command must produce at least one match in _strip_skills."""
        # Build a minimal LLM response using each command with valid syntax
        samples = {
            "SEARCH_MEMORIES":  f"text.\n[{cmd}: query, detail]",
            "WEB_SEARCH":       f"text.\n[{cmd}: weather today]",
            "SAVE_MEMORY":      f"text.\n[{cmd}: She loves coffee]",
            "GENERATE_IMAGE":   f"text.\n[{cmd}: gpt5 | a sunrise]",
            "SCHEDULE_MESSAGE": f"text.\n[{cmd}: 2026-03-19 09:00 | Hello]",
        }
        text = samples[cmd]
        _, save, search, web, img, sched = _strip_skills(text)
        total = len(save) + len(search) + len(web) + len(img) + len(sched)
        assert total == 1, f"{cmd} not matched by _strip_skills"

    @pytest.mark.parametrize("cmd", _ADVERTISED)
    def test_cmd_triggers_buffering(self, cmd: str):
        """Each command must trigger the SSE buffering regex."""
        opening = f"[{cmd}:"
        assert _CMD_OPEN_RE.search(opening), f"Buffering regex misses [{cmd}:"
