import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, DateTime, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class BrokerConnection(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "broker_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "broker", name="uq_user_broker"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    broker: Mapped[str] = mapped_column(String(50), nullable=False, default="zerodha")
    api_key: Mapped[str] = mapped_column(String(255), nullable=False)
    api_secret_enc: Mapped[str] = mapped_column(Text, nullable=False)  # Encrypted
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    user = relationship("User", back_populates="broker_connections")
