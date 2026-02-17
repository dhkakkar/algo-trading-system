import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class TradingSession(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "trading_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False
    )
    strategy_version: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)  # 'paper' | 'live'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="stopped", index=True)
    initial_capital: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=100000.00)
    current_capital: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    parameters: Mapped[dict] = mapped_column(JSONB, default=dict)
    instruments: Mapped[list] = mapped_column(JSONB, default=list)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False, default="1d")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="trading_sessions")
    strategy = relationship("Strategy", back_populates="trading_sessions")
    orders = relationship("Order", back_populates="trading_session")
    trades = relationship("Trade", back_populates="trading_session")
    positions = relationship("Position", back_populates="trading_session", cascade="all, delete-orphan")
    logs = relationship("SessionLog", back_populates="trading_session", cascade="all, delete-orphan", order_by="SessionLog.created_at")
