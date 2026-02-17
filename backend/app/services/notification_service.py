"""Notification service — sends alerts via Telegram, Email, and SMS."""
from __future__ import annotations

import asyncio
import logging
from uuid import UUID

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import async_session_factory
from app.models.notification_settings import NotificationSettings
from app.schemas.notifications import NotificationEventType

logger = logging.getLogger(__name__)

_settings = get_settings()
_fernet = None
if _settings.encryption_key:
    try:
        _fernet = Fernet(_settings.encryption_key.encode())
    except Exception:
        logger.warning("Invalid encryption key for notification service")


def encrypt(text: str) -> str:
    if _fernet and text:
        return _fernet.encrypt(text.encode()).decode()
    return text


def decrypt(text: str) -> str:
    if _fernet and text:
        return _fernet.decrypt(text.encode()).decode()
    return text


# ---------------------------------------------------------------------------
# Message formatting
# ---------------------------------------------------------------------------

EVENT_TITLES: dict[str, str] = {
    NotificationEventType.ORDER_FILLED: "Order Filled",
    NotificationEventType.ORDER_REJECTED: "Order Rejected",
    NotificationEventType.STOP_LOSS_TRIGGERED: "Stop-Loss Triggered",
    NotificationEventType.SESSION_CRASHED: "Session Crashed",
    NotificationEventType.BROKER_DISCONNECTED: "Broker Disconnected",
    NotificationEventType.MAX_DRAWDOWN_BREACHED: "Max Drawdown Breached",
    NotificationEventType.SESSION_STARTED: "Session Started",
    NotificationEventType.SESSION_STOPPED: "Session Stopped",
    NotificationEventType.POSITION_OPENED: "Position Opened",
    NotificationEventType.POSITION_CLOSED: "Position Closed",
    NotificationEventType.DAILY_PNL_SUMMARY: "Daily P&L Summary",
    NotificationEventType.SESSION_PAUSED: "Session Paused",
    NotificationEventType.SESSION_RESUMED: "Session Resumed",
    NotificationEventType.TARGET_PROFIT_REACHED: "Target Profit Reached",
    NotificationEventType.NO_TRADES_TODAY: "No Trades Today",
}

CRITICAL_EVENTS = {
    NotificationEventType.ORDER_FILLED,
    NotificationEventType.ORDER_REJECTED,
    NotificationEventType.STOP_LOSS_TRIGGERED,
    NotificationEventType.SESSION_CRASHED,
    NotificationEventType.BROKER_DISCONNECTED,
    NotificationEventType.MAX_DRAWDOWN_BREACHED,
}


def _format_message(event_type: NotificationEventType, payload: dict) -> str:
    title = EVENT_TITLES.get(event_type, event_type.value)
    severity = "CRITICAL" if event_type in CRITICAL_EVENTS else "INFO"
    lines = [f"[{severity}] {title}"]
    for key, value in payload.items():
        lines.append(f"  {key}: {value}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Channel senders
# ---------------------------------------------------------------------------

async def _send_telegram(bot_token: str, chat_id: str, message: str) -> None:
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, json={
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML",
        })
        if resp.status_code != 200:
            logger.warning("Telegram send failed: %s %s", resp.status_code, resp.text[:200])


async def _send_email(
    smtp_host: str, smtp_port: int, username: str, password: str,
    use_tls: bool, from_addr: str, to_addr: str, subject: str, body: str,
) -> None:
    import aiosmtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    await aiosmtplib.send(
        msg,
        hostname=smtp_host,
        port=smtp_port,
        username=username,
        password=password,
        start_tls=use_tls,
    )


async def _send_sms(
    account_sid: str, auth_token: str, from_number: str, to_number: str, body: str,
) -> None:
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            url,
            data={"To": to_number, "From": from_number, "Body": body},
            auth=(account_sid, auth_token),
        )
        if resp.status_code not in (200, 201):
            logger.warning("Twilio SMS failed: %s %s", resp.status_code, resp.text[:200])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def notify(user_id: UUID, event_type: NotificationEventType, payload: dict) -> None:
    """
    Fire-and-forget notification dispatcher.

    Loads user's notification settings, checks which channels are enabled
    for this event, and sends to each in parallel.
    Call via asyncio.create_task() so it never blocks the trading engine.
    """
    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(NotificationSettings).where(NotificationSettings.user_id == user_id)
            )
            ns = result.scalar_one_or_none()

        if not ns:
            return

        event_channels = ns.event_channels or {}
        channels = event_channels.get(event_type.value, [])
        if not channels:
            return

        message = _format_message(event_type, payload)
        tasks = []

        if "telegram" in channels and ns.telegram_enabled and ns.telegram_bot_token_enc and ns.telegram_chat_id:
            bot_token = decrypt(ns.telegram_bot_token_enc)
            tasks.append(_send_telegram(bot_token, ns.telegram_chat_id, message))

        if "email" in channels and ns.email_enabled and ns.smtp_host and ns.smtp_password_enc:
            subject = f"AlgoTrader: {EVENT_TITLES.get(event_type, event_type.value)}"
            password = decrypt(ns.smtp_password_enc)
            tasks.append(_send_email(
                ns.smtp_host, ns.smtp_port or 587, ns.smtp_username or "",
                password, ns.smtp_use_tls, ns.email_from or "", ns.email_to or "",
                subject, message,
            ))

        if "sms" in channels and ns.sms_enabled and ns.twilio_auth_token_enc and ns.twilio_from_number:
            auth_token = decrypt(ns.twilio_auth_token_enc)
            tasks.append(_send_sms(
                ns.twilio_account_sid or "", auth_token,
                ns.twilio_from_number, ns.sms_to_number or "", message[:1600],
            ))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, Exception):
                    logger.warning("Notification channel failed: %s", r)

    except Exception as exc:
        logger.error("notify() failed for user %s event %s: %s", user_id, event_type, exc)


def fire_notification(user_id, event_type: NotificationEventType, payload: dict):
    """Schedule a notification as a background task (fire-and-forget)."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(notify(user_id, event_type, payload))
    except RuntimeError:
        pass


async def send_test_notification(ns: NotificationSettings, channel: str) -> str:
    """Send a test notification to a specific channel. Returns status message."""
    test_message = "[TEST] AlgoTrader notification system is working!"
    try:
        if channel == "telegram":
            if not ns.telegram_bot_token_enc or not ns.telegram_chat_id:
                return "Telegram credentials not configured"
            await _send_telegram(decrypt(ns.telegram_bot_token_enc), ns.telegram_chat_id, test_message)
            return "Telegram test message sent"
        elif channel == "email":
            if not ns.smtp_host or not ns.smtp_password_enc:
                return "Email SMTP settings not configured"
            await _send_email(
                ns.smtp_host, ns.smtp_port or 587, ns.smtp_username or "",
                decrypt(ns.smtp_password_enc), ns.smtp_use_tls,
                ns.email_from or "", ns.email_to or "",
                "AlgoTrader Test", test_message,
            )
            return "Test email sent"
        elif channel == "sms":
            if not ns.twilio_auth_token_enc or not ns.twilio_from_number:
                return "Twilio SMS settings not configured"
            await _send_sms(
                ns.twilio_account_sid or "", decrypt(ns.twilio_auth_token_enc),
                ns.twilio_from_number, ns.sms_to_number or "", test_message,
            )
            return "Test SMS sent"
        return f"Unknown channel: {channel}"
    except Exception as exc:
        return f"Test failed: {exc}"
