from __future__ import annotations

import re
from pathlib import Path

from infrastructure.skills.base import SkillBase, SkillContext, SkillResult


class WebSearchSkill(SkillBase):
    id = "web_search"
    cmd_name = "WEB_SEARCH"
    display = {"en": "Web Search", "ru": "Поиск в интернете"}
    description = {
        "en": "AI searches the live web for fresh external information.",
        "ru": "AI ищет актуальную информацию в интернете.",
    }
    example = "[WEB_SEARCH: weather Yerevan today]"
    action_type = "agentic"
    persist_in_db = True
    parse_re = re.compile(r"\[WEB[_ ]SEARCH:\s*(.*?)\]", re.DOTALL | re.IGNORECASE)
    _prompt_dir = Path(__file__).resolve().parent

    def pre_sse_events(self, match: re.Match) -> list[tuple[str, dict]]:
        return [("web_start", {"query": match.group(1).strip()})]

    async def execute(self, match: re.Match, ctx: SkillContext) -> SkillResult:
        query = match.group(1).strip()
        ctx.logger.info("[web_search] query=%s", query[:120])
        ctx.dbg(f"WEB_SEARCH query={query[:120]}")

        continuation = self.get_section("web_continuation", ctx.lang, web_query=query)
        return SkillResult(continuation=continuation, continuation_web_search=True)


skill = WebSearchSkill()
