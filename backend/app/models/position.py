import uuid
from sqlalchemy import String, Integer, Numeric, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, UUIDMixin, TimestampMixin


class Position(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint(
            "trading_session_id", "tradingsymbol", "exchange", "side",
            name="uq_position_session_symbol"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    trading_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trading_sessions.id", ondelete="CASCADE"), nullable=False
    )

    tradingsymbol: Mapped[str] = mapped_column(String(100), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)
    side: Mapped[str] = mapped_column(String(5), nullable=False)  # LONG | SHORT
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    average_entry_price: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    current_price: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    unrealized_pnl: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)

    # Relationships
    trading_session = relationship("TradingSession", back_populates="positions")
