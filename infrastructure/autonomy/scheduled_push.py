"""ScheduledPushWorker — direct push delivery.

For each due AutonomyTask (trigger_type=TIME, status=PENDING, scheduled_at <= now):

Phase 1 — Mark as DONE in DB immediately (prevents double-delivery).
Phase 2 — Send via Pushy.
Phase 3 — Save the sent message to the messages table (visible in chat).

This ensures exactly-once delivery even if the worker crashes mid-flight:
if the process dies after Phase 1 but before Phase 2 the task stays DONE
(not re-queued) and we simply miss that push — acceptable for a personal AI.
"""
from __future__ import annotations

import json

from infrastructure.autonomy.helpers import detect_lang, get_ai_name, save_push_message
from infrastructure.database.engine import get_db_session

from infrastructure.logging.logger import setup_logger

logger = setup_logger("autonomy.scheduled_push")


async def run_due(account_id: str) -> None:
    """Process all due TIME tasks for *account_id*."""
    from infrastructure.settings_store import load_settings
    settings = load_settings()

    async with get_db_session() as db:
        from infrastructure.autonomy.task_queue import get_due_tasks, mark_done
        tasks = await get_due_tasks(db, account_id)
        if not tasks:
            return

        logger.info("[scheduled_push:%s] %d due task(s)", account_id, len(tasks))

        # Deduplicate by scheduled_at: keep only the most recently created task
        # per time slot. Any earlier duplicates are marked DONE without sending.
        seen_times: dict[datetime, object] = {}
        from datetime import datetime as _dt
        for task in sorted(tasks, key=lambda t: t.created_at or _dt.min):
            seen_times[task.scheduled_at] = task
        dedup_tasks = list(seen_times.values())

        for task in tasks:
            if task not in dedup_tasks:
                logger.info(
                    "[scheduled_push] dedup: suppressing duplicate task_id=%s at %s",
                    task.id, task.scheduled_at,
                )
                await mark_done(db, task.id)

        tasks = dedup_tasks

        for task in tasks:
            # Phase 1: mark DONE immediately to prevent double-delivery
            await mark_done(db, task.id)
            logger.info("[scheduled_push] marked DONE task_id=%s", task.id)

            # Parse payload
            try:
                payload_data = json.loads(task.payload)
                message = payload_data.get("message", "")
                source = payload_data.get("source", "unknown")
            except (json.JSONDecodeError, TypeError):
                message = str(task.payload)
                source = "unknown"

            if not message:
                logger.warning("[scheduled_push] empty message for task_id=%s", task.id)
                continue

            logger.info(
                "[scheduled_push] task_id=%s source=%s msg=%s",
                task.id, source, message[:80],
            )

            # Phase 2: send via Pushy
            from infrastructure.pushy.client import get_client
            from infrastructure.settings_store import load_settings as _ls
            _s = _ls()
            ai_name = get_ai_name()
            _has_api_key = bool(_s.get("pushy_api_key", ""))
            _has_token = bool(_s.get("pushy_device_token", ""))
            logger.info(
                "[scheduled_push] pushy config: api_key=%s device_token=%s",
                "present" if _has_api_key else "MISSING",
                "present" if _has_token else "MISSING",
            )
            client = get_client()
            if client:
                logger.info("[scheduled_push] sending push notification task_id=%s", task.id)
                push_ok = await client.send(title=ai_name, body=message)
                if push_ok:
                    logger.info("[scheduled_push] push delivered OK task_id=%s", task.id)
                else:
                    logger.warning("[scheduled_push] push delivery FAILED task_id=%s (see [pushy] logs above)", task.id)
            else:
                logger.warning("[scheduled_push] Pushy not configured (api_key or device_token missing), skipping push task_id=%s", task.id)

            # Phase 3: persist in chat history
            await save_push_message(account_id=account_id, text=message)

            # Phase 4: log to workbench
            from infrastructure.autonomy import workbench as wb
            _lang = detect_lang(message)
            _preview = message[:60] + ("…" if len(message) > 60 else "")
            _pfx = "Отправил сообщение" if _lang == "ru" else "Sent message"
            wb.append(account_id, f"{_pfx}: «{_preview}»")
