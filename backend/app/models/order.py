import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin


class Order(Base, UUIDMixin):
    __tablename__ = "orders"

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
    broker_order_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    instrument_token: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tradingsymbol: Mapped[str] = mapped_column(String(100), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(4), nullable=False)  # BUY | SELL
    order_type: Mapped[str] = mapped_column(String(10), nullable=False)  # MARKET|LIMIT|SL|SL-M
    product: Mapped[str] = mapped_column(String(10), nullable=False)  # CNC|MIS|NRML
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    trigger_price: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    filled_quantity: Mapped[int] = mapped_column(Integer, default=0)
    average_price: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)  # backtest|paper|live

    placed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships
    user = relationship("User", back_populates="orders")
    trading_session = relationship("TradingSession", back_populates="orders")
    backtest = relationship("Backtest", back_populates="orders")
    session_run = relationship("SessionRun", back_populates="orders")
