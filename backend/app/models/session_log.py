import uuid
from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class SessionLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "session_logs"
    __table_args__ = (
        Index("ix_session_logs_session_id", "trading_session_id"),
        Index("ix_session_logs_level", "level"),
    )

    trading_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trading_sessions.id", ondelete="CASCADE"), nullable=False
    )
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="INFO")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="system")
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Relationships
    trading_session = relationship("TradingSession", back_populates="logs")
