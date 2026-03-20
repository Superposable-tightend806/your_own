from __future__ import annotations

import re
from pathlib import Path

from infrastructure.skills.base import SkillBase, SkillContext, SkillResult


class SaveMemorySkill(SkillBase):
    id = "save_memory"
    cmd_name = "SAVE_MEMORY"
    display = {"en": "Save Memory", "ru": "Запомнить"}
    description = {
        "en": "AI extracts a key fact from the conversation and saves it to long-term memory.",
        "ru": "AI извлекает ключевой факт из разговора и сохраняет его в долгосрочную память.",
    }
    example = "[SAVE_MEMORY: She decided to open-source the project]"
    action_type = "post"
    persist_in_db = False
    parse_re = re.compile(r"\[SAVE[_ ]MEMORY:\s*(.*?)\]", re.DOTALL | re.IGNORECASE)
    _prompt_dir = Path(__file__).resolve().parent

    async def execute(self, match: re.Match, ctx: SkillContext) -> SkillResult:
        """Not used directly — save_memory is batch-processed after the stream.

        See ``execute_batch`` for the actual implementation.
        """
        return SkillResult()

    async def execute_batch(
        self,
        matches: list[re.Match],
        clean_text: str,
        ctx: SkillContext,
    ) -> list[dict]:
        """Extract and store facts for all SAVE_MEMORY matches at once."""
        if not matches:
            ctx.dbg("SAVE_MEMORY execute_batch called with 0 matches")
            return []

        ctx.dbg(f"SAVE_MEMORY execute_batch matches={len(matches)}")
        results: list[dict] = []
        try:
            from infrastructure.memory.key_info import extract_and_store

            extraction_pairs: list[dict] = []
            for item in list(reversed(ctx.recent_pairs))[-2:]:
                if item["user_text"]:
                    extraction_pairs.append({"role": "user", "content": item["user_text"]})
                if item["assistant_text"]:
                    extraction_pairs.append({"role": "assistant", "content": item["assistant_text"]})
            extraction_pairs.append({"role": "user", "content": ctx.current_user_text})
            extraction_pairs.append({"role": "assistant", "content": clean_text})

            ctx.dbg(f"SAVE_MEMORY extraction_pairs={len(extraction_pairs)} clean_text_len={len(clean_text)}")

            for i, m in enumerate(matches):
                hint = m.group(1).strip() if m.group(1) else ""
                ctx.dbg(f"SAVE_MEMORY #{i} hint={hint[:80]}")
                r = await extract_and_store(
                    api_key=ctx.api_key,
                    account_id=ctx.account_id,
                    recent_pairs=extraction_pairs,
                    hint=hint,
                )
                ctx.dbg(f"SAVE_MEMORY #{i} result={'OK' if r else 'None'} {r}")
                if r:
                    results.append(r)
        except Exception as exc:
            ctx.logger.warning("[save_memory] skill failed: %s", exc)
            ctx.dbg(f"SAVE_MEMORY EXCEPTION: {type(exc).__name__}: {exc}")
        return results


skill = SaveMemorySkill()
