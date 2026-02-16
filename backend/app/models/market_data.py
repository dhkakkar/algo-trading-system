from datetime import datetime
from sqlalchemy import String, Integer, BigInteger, Numeric, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class OHLCVData(Base):
    __tablename__ = "ohlcv_data"

    # Composite primary key: time + instrument_token + interval
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    instrument_token: Mapped[int] = mapped_column(Integer, primary_key=True)
    interval: Mapped[str] = mapped_column(String(10), primary_key=True)

    tradingsymbol: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)
    open: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    high: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    low: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    close: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("ix_ohlcv_symbol_exchange_interval_time", "tradingsymbol", "exchange", "interval", "time"),
    )
