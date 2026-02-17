import uuid
from sqlalchemy import String, Text, Boolean, Integer, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class NotificationSettings(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "notification_settings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_notification_settings_user"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # --- Telegram ---
    telegram_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    telegram_bot_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # --- Email (SMTP) ---
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    email_from: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_to: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- SMS (Twilio) ---
    sms_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    twilio_account_sid: Mapped[str | None] = mapped_column(String(100), nullable=True)
    twilio_auth_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    twilio_from_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sms_to_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # --- Per-event channel preferences ---
    # e.g. {"order_filled": ["telegram", "sms"], "session_crashed": ["telegram", "email", "sms"]}
    event_channels: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=dict)

    # Relationships
    user = relationship("User", back_populates="notification_settings")
