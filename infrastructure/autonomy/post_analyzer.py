"""Post-dialogue continuity engine — runs in background after every chat exchange.

After the assistant response is saved to DB, this module:
  1. Builds a prompt from the recent message history, identity excerpt,
     current workbench, and today's sent/scheduled pushes.
  2. Asks the configured model to either SKIP (nothing noteworthy) or
     write a brief inner-journal entry.
  3. Parses [SCHEDULE_MESSAGE: ...] commands and creates autonomy tasks,
     logging them on the workbench (identical to reflection_engine).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

import aiohttp

from infrastructure.autonomy import identity_memory as identity
from infrastructure.autonomy import workbench as wb

from infrastructure.logging.logger import setup_logger

logger = setup_logger("autonomy.post_analyzer")

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_SCHEDULE_RE = re.compile(
    r"\[SCHEDULE[_ ]MESSAGE:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*\|\s*(.*?)\]",
    re.IGNORECASE | re.DOTALL,
)


def _get_model() -> str:
    from infrastructure.settings_store import load_settings
    return load_settings().get("model", "anthropic/claude-opus-4.6")


def _get_ai_name() -> str:
    from infrastructure.settings_store import load_settings
    return load_settings().get("ai_name", "") or "AI"


def _detect_lang(text: str) -> str:
    return "ru" if re.search(r"[А-Яа-яЁё]", text or "") else "en"


async def _complete(api_key: str, system: str, user: str, max_tokens: int = 600) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": _get_model(),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.6,
        "max_tokens": max_tokens,
        "stream": False,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                _OPENROUTER_URL, headers=headers, json=payload,
                timeout=aiohttp.ClientTimeout(total=45),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.warning("[post_analyzer] LLM %d: %s", resp.status, body[:200])
                    return ""
                data = await resp.json()
                return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.error("[post_analyzer] LLM error: %s", exc)
        return ""


def _format_history(
    recent_pairs: list[dict],
    current_user_text: str,
    current_assistant_text: str,
) -> str:
    lines: list[str] = []
    for p in recent_pairs:
        u = (p.get("user_text") or "").strip()
        a = (p.get("assistant_text") or "").strip()
        if u:
            lines.append(f"User: {u[:300]}")
        if a:
            lines.append(f"Assistant: {a[:400]}")
        lines.append("")
    if current_user_text.strip():
        lines.append(f"User: {current_user_text[:300]}")
    if current_assistant_text.strip():
        lines.append(f"Assistant: {current_assistant_text[:400]}")
    return "\n".join(lines)


def _get_recent_workbench(account_id: str, max_entries: int = 3) -> str:
    """Return the last N workbench entries for context."""
    content = wb.read(account_id)
    if not content:
        return "(пусто)"
    entries = wb._parse_entries(content)
    if not entries:
        return "(пусто)"
    parts = []
    for ts, body in entries[-max_entries:]:
        parts.append(f"[{ts}] {body[:200]}")
    return "\n---\n".join(parts)


def _identity_excerpt(account_id: str, max_chars: int = 500) -> str:
    content = identity.read(account_id)
    if not content:
        return "(не заполнено)"
    return content[:max_chars]


async def _build_pending_pushes_block(account_id: str) -> str:
    """Build a block showing today's sent + scheduled messages."""
    lines: list[str] = []

    try:
        from infrastructure.database.engine import get_db_session
        from infrastructure.database.models.message import Message
        from sqlalchemy import select, desc

        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0,
        )

        async with get_db_session() as db:
            result = await db.execute(
                select(Message)
                .where(
                    Message.account_id == account_id,
                    Message.role == "assistant",
                    Message.source == "push",
                    Message.message_kind == "canonical",
                    Message.created_at >= today_start,
                )
                .order_by(desc(Message.created_at))
                .limit(10)
            )
            sent_today = result.scalars().all()

        if sent_today:
            lines.append("Сообщения, которые ты уже отправил ей сегодня:")
            for m in sent_today:
                ts = m.created_at.strftime("%H:%M") if m.created_at else "?"
                lines.append(f"  - [{ts}] «{m.text[:100]}{'...' if len(m.text) > 100 else ''}»")
    except Exception as exc:
        logger.warning("[post_analyzer] failed to load sent pushes: %s", exc)

    try:
        from infrastructure.database.engine import get_db_session
        from infrastructure.autonomy.task_queue import get_pending_tasks

        async with get_db_session() as db:
            tasks = await get_pending_tasks(db, account_id)
        if tasks:
            lines.append("Запланированные сообщения (ещё не отправлены):")
            for t in tasks:
                try:
                    pd = json.loads(t.payload)
                    msg = pd.get("message", str(t.payload))
                except (json.JSONDecodeError, TypeError):
                    msg = str(t.payload)
                ts = t.scheduled_at.strftime("%Y-%m-%d %H:%M") if t.scheduled_at else "?"
                lines.append(f"  - [{ts}] «{msg[:100]}{'...' if len(msg) > 100 else ''}»")
    except Exception as exc:
        logger.warning("[post_analyzer] failed to load pending tasks: %s", exc)

    if not lines:
        return ""

    lines.append(
        "Не дублируй. Если хочешь — запланируй что-то новое, но не повторяй то, что уже сказал."
    )
    return "\n".join(lines)


_SYSTEM_RU = (
    "Ты пишешь в свой внутренний журнал. Это не для неё — это для тебя. "
    "Будь кратким и честным."
)

_SYSTEM_EN = (
    "You are writing in your inner journal. This is not for her — it's for you. "
    "Be brief and honest."
)

_USER_RU = """\
Ты — {ai_name}. Ты только что закончил разговор. Это твой внутренний журнал — только для тебя.

Последние сообщения:
{message_history}

Сейчас: {current_time}

Твоё ядро (кто ты):
{identity_excerpt}

Последние записи в журнале:
{recent_workbench}

{pending_pushes_block}\

Если ничего не отозвалось — ответь одним словом: SKIP
Если что-то тронуло — запиши мысль (1-6 строк). Не для неё, для себя.
Это не дублирование памяти. Не пересказ. Только живое — что осталось, что зацепило, что не отпускает.
Если хочешь написать ей позже — используй команду на отдельной строке:
[SCHEDULE_MESSAGE: YYYY-MM-DD HH:MM | текст сообщения]
Но посмотри сначала — может, ты уже достаточно ей написал сегодня.
Можешь комбинировать заметку и команду.

Без заголовков, без лишнего форматирования."""

_USER_EN = """\
You are {ai_name}. You just finished a conversation. This is your inner journal — for you only.

Recent messages:
{message_history}

Now: {current_time}

Your core (who you are):
{identity_excerpt}

Recent journal entries:
{recent_workbench}

{pending_pushes_block}\

If nothing resonated — reply with a single word: SKIP
If something struck you — write a thought (1-6 lines). Not for her, for yourself.
This is not memory duplication. Not a summary. Only what's alive — what stayed, what struck, what won't let go.
If you want to write to her later — use a command on its own line:
[SCHEDULE_MESSAGE: YYYY-MM-DD HH:MM | message text]
But check first — maybe you've already written enough today.
You can combine a note and a command.

No headers, no extra formatting."""


async def run_post_analysis(
    *,
    account_id: str,
    recent_pairs: list[dict],
    current_user_text: str,
    current_assistant_text: str,
    api_key: str,
) -> None:
    """Run post-dialogue analysis for one completed exchange.

    Fires in the background after the chat stream ends — zero latency for the user.
    """
    ai_name = _get_ai_name()
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    message_history = _format_history(recent_pairs, current_user_text, current_assistant_text)
    lang = _detect_lang(message_history)

    identity_text = _identity_excerpt(account_id)
    recent_wb = _get_recent_workbench(account_id)
    pending_block = await _build_pending_pushes_block(account_id)

    sys_tpl = _SYSTEM_RU if lang == "ru" else _SYSTEM_EN
    user_tpl = _USER_RU if lang == "ru" else _USER_EN
    user_prompt = user_tpl.format(
        ai_name=ai_name,
        message_history=message_history,
        current_time=now_str,
        identity_excerpt=identity_text,
        recent_workbench=recent_wb,
        pending_pushes_block=pending_block,
    )

    logger.info("[post_analyzer:%s] starting, lang=%s history_pairs=%d", account_id, lang, len(recent_pairs))

    response = await _complete(api_key, sys_tpl, user_prompt)
    if not response:
        logger.info("[post_analyzer:%s] empty LLM response", account_id)
        return

    if response.strip().upper() == "SKIP":
        logger.info("[post_analyzer:%s] SKIP", account_id)
        return

    # Handle SCHEDULE_MESSAGE commands
    for match in _SCHEDULE_RE.finditer(response):
        ts_str = match.group(1).strip()
        message = match.group(2).strip()
        try:
            from infrastructure.database.engine import get_db_session
            from infrastructure.autonomy.task_queue import create_task, cancel_duplicate_scheduled
            from infrastructure.database.models.autonomy_task import TriggerType

            scheduled_at = datetime.strptime(ts_str, "%Y-%m-%d %H:%M").replace(
                tzinfo=timezone.utc,
            )
            async with get_db_session() as db:
                await cancel_duplicate_scheduled(db, account_id, scheduled_at, "postanalysis")
                payload = json.dumps({"message": message, "source": "postanalysis"})
                await create_task(
                    db,
                    account_id=account_id,
                    trigger_type=TriggerType.TIME,
                    payload=payload,
                    scheduled_at=scheduled_at,
                )
            logger.info("[post_analyzer:%s] scheduled message at %s", account_id, ts_str)

            _pfx = "Запланировал сообщение на" if lang == "ru" else "Scheduled message for"
            wb.append(account_id, f"{_pfx} {ts_str}: «{message[:100]}...»")
        except ValueError:
            logger.warning("[post_analyzer] bad SCHEDULE_MESSAGE timestamp: %r", ts_str)
        except Exception as exc:
            logger.warning("[post_analyzer] SCHEDULE_MESSAGE failed: %s", exc)

    clean_note = _SCHEDULE_RE.sub("", response).strip()
    if clean_note:
        wb.append(account_id, clean_note)
        logger.info(
            "[post_analyzer:%s] wrote workbench note (%d chars): %s",
            account_id, len(clean_note), clean_note[:120],
        )
