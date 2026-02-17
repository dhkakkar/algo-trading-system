from pydantic import BaseModel
from enum import Enum


class NotificationChannel(str, Enum):
    TELEGRAM = "telegram"
    EMAIL = "email"
    SMS = "sms"


class NotificationEventType(str, Enum):
    # Critical
    ORDER_FILLED = "order_filled"
    ORDER_REJECTED = "order_rejected"
    STOP_LOSS_TRIGGERED = "stop_loss_triggered"
    SESSION_CRASHED = "session_crashed"
    BROKER_DISCONNECTED = "broker_disconnected"
    MAX_DRAWDOWN_BREACHED = "max_drawdown_breached"
    # Important
    SESSION_STARTED = "session_started"
    SESSION_STOPPED = "session_stopped"
    POSITION_OPENED = "position_opened"
    POSITION_CLOSED = "position_closed"
    DAILY_PNL_SUMMARY = "daily_pnl_summary"
    # Info
    SESSION_PAUSED = "session_paused"
    SESSION_RESUMED = "session_resumed"
    TARGET_PROFIT_REACHED = "target_profit_reached"
    NO_TRADES_TODAY = "no_trades_today"


# --- Telegram ---

class TelegramSettings(BaseModel):
    enabled: bool = False
    bot_token: str | None = None
    chat_id: str | None = None


class TelegramSettingsResponse(BaseModel):
    enabled: bool = False
    bot_token_set: bool = False
    chat_id: str | None = None


# --- Email ---

class EmailSettings(BaseModel):
    enabled: bool = False
    smtp_host: str | None = None
    smtp_port: int | None = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    email_from: str | None = None
    email_to: str | None = None


class EmailSettingsResponse(BaseModel):
    enabled: bool = False
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_password_set: bool = False
    smtp_use_tls: bool = True
    email_from: str | None = None
    email_to: str | None = None


# --- SMS ---

class SmsSettings(BaseModel):
    enabled: bool = False
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    sms_to_number: str | None = None


class SmsSettingsResponse(BaseModel):
    enabled: bool = False
    twilio_account_sid: str | None = None
    twilio_auth_token_set: bool = False
    twilio_from_number: str | None = None
    sms_to_number: str | None = None


# --- Combined ---

class NotificationSettingsUpdate(BaseModel):
    telegram: TelegramSettings | None = None
    email: EmailSettings | None = None
    sms: SmsSettings | None = None
    event_channels: dict[str, list[str]] | None = None


class NotificationSettingsResponse(BaseModel):
    telegram: TelegramSettingsResponse
    email: EmailSettingsResponse
    sms: SmsSettingsResponse
    event_channels: dict[str, list[str]]


class TestNotificationRequest(BaseModel):
    channel: NotificationChannel
