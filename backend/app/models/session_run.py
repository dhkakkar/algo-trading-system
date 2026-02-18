import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class SessionRun(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "session_runs"

    trading_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trading_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    initial_capital: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    final_capital: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)

    # Result metrics (same as Backtest model)
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
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    trading_session = relationship("TradingSession", back_populates="runs")
    orders = relationship("Order", back_populates="session_run")
    trades = relationship("Trade", back_populates="session_run")
    logs = relationship("SessionLog", back_populates="session_run")
