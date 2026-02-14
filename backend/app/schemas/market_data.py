from datetime import date, datetime
from pydantic import BaseModel, Field


class InstrumentResponse(BaseModel):
    instrument_token: int
    tradingsymbol: str
    name: str | None
    exchange: str
    segment: str | None
    instrument_type: str | None
    lot_size: int
    tick_size: float | None
    expiry: date | None

    model_config = {"from_attributes": True}


class InstrumentSearchParams(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)
    exchange: str | None = None


class OHLCVResponse(BaseModel):
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int

    model_config = {"from_attributes": True}


class OHLCVQueryParams(BaseModel):
    symbol: str
    exchange: str = "NSE"
    from_date: date
    to_date: date
    interval: str = Field(default="1d", pattern=r"^(1m|5m|15m|30m|1h|1d)$")
