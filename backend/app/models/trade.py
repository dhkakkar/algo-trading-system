import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin


class Trade(Base, UUIDMixin):
    __tablename__ = "trades"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trading_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trading_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    backtest_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("backtests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    session_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    entry_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=True
    )
    exit_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=True
    )

    tradingsymbol: Mapped[str] = mapped_column(String(100), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)
    side: Mapped[str] = mapped_column(String(5), nullable=False)  # LONG | SHORT
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_price: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    exit_price: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    pnl: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    pnl_percent: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    charges: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    net_pnl: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)

    entry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships
    user = relationship("User", back_populates="trades")
    trading_session = relationship("TradingSession", back_populates="trades")
    backtest = relationship("Backtest", back_populates="trades")
    session_run = relationship("SessionRun", back_populates="trades")
    entry_order = relationship("Order", foreign_keys=[entry_order_id])
    exit_order = relationship("Order", foreign_keys=[exit_order_id])
