import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class TradingSessionCreate(BaseModel):
    strategy_id: uuid.UUID
    mode: str = Field(..., pattern=r"^(paper|live)$")
    initial_capital: float = Field(default=100000.00, gt=0)
    parameters: dict = Field(default_factory=dict)
    instruments: list[str] = Field(default_factory=list)
    timeframe: str = Field(default="1d", pattern=r"^(1m|5m|15m|30m|1h|1d)$")


class TradingSessionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    strategy_id: uuid.UUID
    strategy_name: str | None = None
    strategy_version: int
    mode: str
    status: str
    initial_capital: float
    current_capital: float | None
    parameters: dict
    instruments: list
    timeframe: str
    error_message: str | None
    started_at: datetime | None
    stopped_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TradingSessionListResponse(BaseModel):
    id: uuid.UUID
    strategy_id: uuid.UUID
    strategy_name: str | None = None
    strategy_version: int
    mode: str
    status: str
    initial_capital: float
    current_capital: float | None
    instruments: list
    timeframe: str
    started_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class OrderResponse(BaseModel):
    id: uuid.UUID
    tradingsymbol: str
    exchange: str
    transaction_type: str
    order_type: str
    product: str
    quantity: int
    price: float | None
    filled_quantity: int
    average_price: float | None
    status: str
    mode: str
    placed_at: datetime
    filled_at: datetime | None

    model_config = {"from_attributes": True}


class PositionResponse(BaseModel):
    id: uuid.UUID
    tradingsymbol: str
    exchange: str
    side: str
    quantity: int
    average_entry_price: float
    current_price: float | None
    unrealized_pnl: float | None
    mode: str

    model_config = {"from_attributes": True}


class TradeResponse(BaseModel):
    id: uuid.UUID
    tradingsymbol: str
    exchange: str
    side: str
    quantity: int
    entry_price: float
    exit_price: float | None
    pnl: float | None
    pnl_percent: float | None
    charges: float
    net_pnl: float | None
    mode: str
    entry_at: datetime
    exit_at: datetime | None

    model_config = {"from_attributes": True}
