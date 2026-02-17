import uuid
from datetime import date, datetime
from sqlalchemy import String, Text, Integer, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class Backtest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "backtests"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    initial_capital: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=100000.00)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False, default="1d")
    parameters: Mapped[dict] = mapped_column(JSONB, default=dict)
    instruments: Mapped[list] = mapped_column(JSONB, default=list)

    # Result metrics
    total_return: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    cagr: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    sharpe_ratio: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    sortino_ratio: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    max_drawdown: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    win_rate: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    profit_factor: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    total_trades: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_trade_pnl: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)

    equity_curve: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    drawdown_curve: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    logs: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="backtests")
    strategy = relationship("Strategy", back_populates="backtests")
    orders = relationship("Order", back_populates="backtest")
    trades = relationship("Trade", back_populates="backtest")
