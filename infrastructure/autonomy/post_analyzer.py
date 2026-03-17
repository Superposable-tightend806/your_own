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
import uuid
from datetime import datetime, timezone

from infrastructure.autonomy import identity_memory as identity
from infrastructure.autonomy import workbench as wb
from infrastructure.autonomy.cmd_parser import (
    CancelMessage,
    ParsedCommand,
    RescheduleMessage,
    RewriteMessage,
    ScheduleMessage,
    SendMessage,
    parse_commands,
    strip_commands,
)
from infrastructure.llm.prompt_loader import get_prompt
from infrastructure.settings_store import now_local

from infrastructure.logging.logger import setup_logger

logger = setup_logger("autonomy.post_analyzer")

_PROMPTS = "infrastructure/autonomy/prompts/post_analyzer.md"


def _get_ai_name() -> str:
    from infrastructure.settings_store import load_settings
    return load_settings().get("ai_name", "") or "AI"


def _make_client(api_key: str):
    from infrastructure.llm.client import LLMClient
    from infrastructure.settings_store import load_settings
    s = load_settings()
    return LLMClient(api_key=api_key, model=s.get("model", "anthropic/claude-opus-4.6"))


def _detect_lang(text: str) -> str:
    return "ru" if re.search(r"[А-Яа-яЁё]", text or "") else "en"


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
            lines.append(f"User: {u}")
        if a:
            lines.append(f"Assistant: {a}")
        lines.append("")
    if current_user_text.strip():
        lines.append(f"User: {current_user_text}")
    if current_assistant_text.strip():
        lines.append(f"Assistant: {current_assistant_text}")
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
        parts.append(f"[{ts}] {body}")
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
                lines.append(f"  - [{ts}] «{m.text}»")
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
                lines.append(f"  - [{ts}] «{msg}»")
    except Exception as exc:
        logger.warning("[post_analyzer] failed to load pending tasks: %s", exc)

    if not lines:
        return ""

    lines.append(
        "Не дублируй. Если хочешь — запланируй что-то новое, но не повторяй то, что уже сказал.\n"
        "Ты сможешь переписать эти сообщения или отменить их в момент отправки — тогда ты увидишь весь свой журнал и само сообщение. Не переживай о них сейчас."
    )
    return "\n".join(lines)


async def _execute_command(cmd: ParsedCommand, *, account_id: str, lang: str) -> None:
    """Execute one parsed autonomy command."""
    from infrastructure.database.engine import get_db_session
    from infrastructure.autonomy.task_queue import (
        cancel_duplicate_scheduled,
        cancel_task_by_time,
        create_task,
        reschedule_task,
    )
    from infrastructure.database.models.autonomy_task import TriggerType
    from infrastructure.settings_store import local_to_utc

    _ru = lang == "ru"

    if isinstance(cmd, SendMessage):
        try:
            from infrastructure.pushy.client import get_client
            client = get_client()
            if client:
                await client.send(title=_get_ai_name(), body=cmd.text)
                logger.info("[post_analyzer:%s] sent push: %s", account_id, cmd.text[:80])
            else:
                logger.warning("[post_analyzer] SEND_MESSAGE: Pushy not configured")
            from infrastructure.memory.live_store import build_canonical_row
            from infrastructure.database.repositories.message_repo import MessageRepository
            row = build_canonical_row(
                pair_id=uuid.uuid4(), account_id=account_id,
                role="assistant", text=cmd.text, source="push",
            )
            async with get_db_session() as db:
                await MessageRepository(db).bulk_save([row])
            _pfx = "Написал ей" if _ru else "Sent message"
            _preview = cmd.text[:60] + ("…" if len(cmd.text) > 60 else "")
            wb.append(account_id, f"{_pfx}: «{_preview}»")
        except Exception as exc:
            logger.warning("[post_analyzer] SEND_MESSAGE failed: %s", exc)

    elif isinstance(cmd, ScheduleMessage):
        try:
            scheduled_at = local_to_utc(datetime.strptime(cmd.ts_str, "%Y-%m-%d %H:%M"))
            async with get_db_session() as db:
                await cancel_duplicate_scheduled(db, account_id, scheduled_at, "postanalysis")
                payload = json.dumps({"message": cmd.text, "source": "postanalysis"})
                await create_task(
                    db,
                    account_id=account_id,
                    trigger_type=TriggerType.TIME,
                    payload=payload,
                    scheduled_at=scheduled_at,
                )
            logger.info("[post_analyzer:%s] scheduled message at %s", account_id, cmd.ts_str)
            _pfx = "Запланировал сообщение на" if _ru else "Scheduled message for"
            _preview = cmd.text[:60] + ("…" if len(cmd.text) > 60 else "")
            wb.append(account_id, f"{_pfx} {cmd.ts_str}: «{_preview}»")
        except ValueError:
            logger.warning("[post_analyzer] bad SCHEDULE_MESSAGE ts: %r", cmd.ts_str)
        except Exception as exc:
            logger.warning("[post_analyzer] SCHEDULE_MESSAGE failed: %s", exc)

    elif isinstance(cmd, CancelMessage):
        try:
            scheduled_at = local_to_utc(datetime.strptime(cmd.ts_str, "%Y-%m-%d %H:%M"))
            async with get_db_session() as db:
                found = await cancel_task_by_time(db, account_id, scheduled_at)
            logger.info("[post_analyzer:%s] CANCEL_MESSAGE %s found=%s", account_id, cmd.ts_str, found)
            if found:
                _pfx = "Отменил сообщение на" if _ru else "Cancelled message for"
                wb.append(account_id, f"{_pfx} {cmd.ts_str}")
        except ValueError:
            logger.warning("[post_analyzer] bad CANCEL_MESSAGE ts: %r", cmd.ts_str)
        except Exception as exc:
            logger.warning("[post_analyzer] CANCEL_MESSAGE failed: %s", exc)

    elif isinstance(cmd, RescheduleMessage):
        try:
            old_utc = local_to_utc(datetime.strptime(cmd.old_ts_str, "%Y-%m-%d %H:%M"))
            new_utc = local_to_utc(datetime.strptime(cmd.new_ts_str, "%Y-%m-%d %H:%M"))
            async with get_db_session() as db:
                found = await reschedule_task(db, account_id, old_utc, new_utc)
            logger.info(
                "[post_analyzer:%s] RESCHEDULE_MESSAGE %s -> %s found=%s",
                account_id, cmd.old_ts_str, cmd.new_ts_str, found,
            )
            if found:
                _pfx = "Перенёс сообщение с" if _ru else "Rescheduled message from"
                _mid = "на" if _ru else "to"
                wb.append(account_id, f"{_pfx} {cmd.old_ts_str} {_mid} {cmd.new_ts_str}")
        except ValueError:
            logger.warning("[post_analyzer] bad RESCHEDULE_MESSAGE: %r -> %r", cmd.old_ts_str, cmd.new_ts_str)
        except Exception as exc:
            logger.warning("[post_analyzer] RESCHEDULE_MESSAGE failed: %s", exc)

    elif isinstance(cmd, RewriteMessage):
        try:
            from infrastructure.autonomy.task_queue import rewrite_task
            scheduled_at = local_to_utc(datetime.strptime(cmd.ts_str, "%Y-%m-%d %H:%M"))
            async with get_db_session() as db:
                found = await rewrite_task(db, account_id, scheduled_at, cmd.new_text)
            logger.info("[post_analyzer:%s] REWRITE_MESSAGE %s found=%s", account_id, cmd.ts_str, found)
            if found:
                _pfx = "Переписал сообщение на" if _ru else "Rewrote message for"
                _preview = cmd.new_text[:60] + ("…" if len(cmd.new_text) > 60 else "")
                wb.append(account_id, f"{_pfx} {cmd.ts_str}: «{_preview}»")
        except ValueError:
            logger.warning("[post_analyzer] bad REWRITE_MESSAGE ts: %r", cmd.ts_str)
        except Exception as exc:
            logger.warning("[post_analyzer] REWRITE_MESSAGE failed: %s", exc)


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
    now_str = now_local().strftime("%Y-%m-%d %H:%M")

    message_history = _format_history(recent_pairs, current_user_text, current_assistant_text)
    lang = _detect_lang(message_history)

    identity_text = _identity_excerpt(account_id)
    recent_wb = _get_recent_workbench(account_id)
    pending_block = await _build_pending_pushes_block(account_id)

    system_prompt = get_prompt(_PROMPTS, lang=lang, section="system")
    user_prompt = get_prompt(
        _PROMPTS, lang=lang, section="user",
        ai_name=ai_name,
        message_history=message_history,
        current_time=now_str,
        identity_excerpt=identity_text,
        recent_workbench=recent_wb,
        pending_pushes_block=pending_block,
    )

    logger.info("[post_analyzer:%s] starting, lang=%s history_pairs=%d", account_id, lang, len(recent_pairs))

    client = _make_client(api_key)
    response = await client.complete(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=1500,
        temperature=0.6,
    )
    if not response:
        logger.info("[post_analyzer:%s] empty LLM response", account_id)
        return

    if response.strip().upper() == "SKIP":
        logger.info("[post_analyzer:%s] SKIP", account_id)
        return

    commands = parse_commands(response)
    for cmd in commands:
        await _execute_command(cmd, account_id=account_id, lang=lang)

    clean_note = strip_commands(response)
    if clean_note:
        wb.append(account_id, clean_note)
        logger.info(
            "[post_analyzer:%s] wrote workbench note (%d chars): %s",
            account_id, len(clean_note), clean_note[:120],
        )
