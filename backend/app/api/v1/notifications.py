import logging
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.notification_settings import NotificationSettings
from app.schemas.notifications import (
    NotificationSettingsUpdate, NotificationSettingsResponse,
    TelegramSettingsResponse, EmailSettingsResponse, SmsSettingsResponse,
    TestNotificationRequest,
)
from app.services.notification_service import encrypt, send_test_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _build_response(ns: NotificationSettings) -> NotificationSettingsResponse:
    return NotificationSettingsResponse(
        telegram=TelegramSettingsResponse(
            enabled=ns.telegram_enabled,
            bot_token_set=bool(ns.telegram_bot_token_enc),
            chat_id=ns.telegram_chat_id,
        ),
        email=EmailSettingsResponse(
            enabled=ns.email_enabled,
            smtp_host=ns.smtp_host,
            smtp_port=ns.smtp_port,
            smtp_username=ns.smtp_username,
            smtp_password_set=bool(ns.smtp_password_enc),
            smtp_use_tls=ns.smtp_use_tls,
            email_from=ns.email_from,
            email_to=ns.email_to,
        ),
        sms=SmsSettingsResponse(
            enabled=ns.sms_enabled,
            twilio_account_sid=ns.twilio_account_sid,
            twilio_auth_token_set=bool(ns.twilio_auth_token_enc),
            twilio_from_number=ns.twilio_from_number,
            sms_to_number=ns.sms_to_number,
        ),
        event_channels=ns.event_channels or {},
    )


@router.get("/settings", response_model=NotificationSettingsResponse)
async def get_notification_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NotificationSettings).where(NotificationSettings.user_id == current_user.id)
    )
    ns = result.scalar_one_or_none()
    if not ns:
        return NotificationSettingsResponse(
            telegram=TelegramSettingsResponse(),
            email=EmailSettingsResponse(),
            sms=SmsSettingsResponse(),
            event_channels={},
        )
    return _build_response(ns)


@router.put("/settings", response_model=NotificationSettingsResponse)
async def update_notification_settings(
    data: NotificationSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NotificationSettings).where(NotificationSettings.user_id == current_user.id)
    )
    ns = result.scalar_one_or_none()
    if not ns:
        ns = NotificationSettings(user_id=current_user.id)
        db.add(ns)

    # Telegram
    if data.telegram is not None:
        ns.telegram_enabled = data.telegram.enabled
        if data.telegram.bot_token is not None:
            ns.telegram_bot_token_enc = encrypt(data.telegram.bot_token) if data.telegram.bot_token else None
        if data.telegram.chat_id is not None:
            ns.telegram_chat_id = data.telegram.chat_id

    # Email
    if data.email is not None:
        ns.email_enabled = data.email.enabled
        if data.email.smtp_host is not None:
            ns.smtp_host = data.email.smtp_host
        if data.email.smtp_port is not None:
            ns.smtp_port = data.email.smtp_port
        if data.email.smtp_username is not None:
            ns.smtp_username = data.email.smtp_username
        if data.email.smtp_password is not None:
            ns.smtp_password_enc = encrypt(data.email.smtp_password) if data.email.smtp_password else None
        ns.smtp_use_tls = data.email.smtp_use_tls
        if data.email.email_from is not None:
            ns.email_from = data.email.email_from
        if data.email.email_to is not None:
            ns.email_to = data.email.email_to

    # SMS
    if data.sms is not None:
        ns.sms_enabled = data.sms.enabled
        if data.sms.twilio_account_sid is not None:
            ns.twilio_account_sid = data.sms.twilio_account_sid
        if data.sms.twilio_auth_token is not None:
            ns.twilio_auth_token_enc = encrypt(data.sms.twilio_auth_token) if data.sms.twilio_auth_token else None
        if data.sms.twilio_from_number is not None:
            ns.twilio_from_number = data.sms.twilio_from_number
        if data.sms.sms_to_number is not None:
            ns.sms_to_number = data.sms.sms_to_number

    # Event channels
    if data.event_channels is not None:
        ns.event_channels = data.event_channels

    await db.commit()
    await db.refresh(ns)
    return _build_response(ns)


@router.post("/test")
async def test_notification(
    data: TestNotificationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NotificationSettings).where(NotificationSettings.user_id == current_user.id)
    )
    ns = result.scalar_one_or_none()
    if not ns:
        return {"success": False, "message": "No notification settings configured. Save settings first."}

    message = await send_test_notification(ns, data.channel.value)
    success = "sent" in message.lower()
    return {"success": success, "message": message}
