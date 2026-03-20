"""Pushy push notification client.

Pushy (https://pushy.me) delivers push notifications to Android and iOS
devices via device tokens registered by the Expo mobile app.

Usage:
    client = PushyClient(api_key="...", device_token="...")
    await client.send(title="Hello", body="World")

API key and device token are read from settings at call time so they
pick up changes without restarting the backend.
"""
from __future__ import annotations

import logging
from typing import Any

import aiohttp

logger = logging.getLogger("pushy")

_PUSHY_API_URL = "https://api.pushy.me/push"


class PushyClient:
    """Async Pushy notification sender."""

    def __init__(self, api_key: str, device_token: str) -> None:
        self.api_key = api_key
        self.device_token = device_token

    async def send(
        self,
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
    ) -> bool:
        """Send an immediate push notification.

        Returns True on success, False on failure (logs the error).
        """
        if not self.api_key or not self.device_token:
            logger.warning("[pushy] send skipped — api_key or device_token not configured")
            return False

        payload: dict[str, Any] = {
            "to": self.device_token,
            "data": data or {"title": title, "message": body},
        }

        url = f"{_PUSHY_API_URL}?api_key={self.api_key}"
        logger.info("[pushy] sending to device_token=%s...%s", self.device_token[:6], self.device_token[-4:])
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    text = await resp.text()
                    if resp.status == 200:
                        logger.info("[pushy] notification sent OK: %r", title)
                        return True
                    logger.warning(
                        "[pushy] send FAILED status=%d body=%s title=%r",
                        resp.status, text[:300], title,
                    )
                    return False
        except aiohttp.ClientConnectorError as exc:
            logger.error("[pushy] connection error (network?): %s", exc)
            return False
        except aiohttp.ServerTimeoutError as exc:
            logger.error("[pushy] timeout after 10s: %s", exc)
            return False
        except Exception as exc:
            logger.error("[pushy] unexpected send error: %s", exc)
            return False


def get_client() -> PushyClient | None:
    """Build a PushyClient from current settings.

    Returns None (and logs a warning) if credentials are not configured.
    """
    from infrastructure.settings_store import load_settings
    settings = load_settings()
    api_key = settings.get("pushy_api_key", "")
    device_token = settings.get("pushy_device_token", "")
    if not api_key or not device_token:
        return None
    return PushyClient(api_key=api_key, device_token=device_token)
