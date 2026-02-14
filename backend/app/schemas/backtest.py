import uuid
from datetime import date, datetime
from pydantic import BaseModel, Field


class BacktestCreate(BaseModel):
    strategy_id: uuid.UUID
    start_date: date
    end_date: date
    initial_capital: float = Field(default=100000.00, gt=0)
    timeframe: str = Field(default="1d", pattern=r"^(1m|5m|15m|30m|1h|1d)$")
    parameters: dict = Field(default_factory=dict)
    instruments: list[str] = Field(default_factory=list)


class BacktestMetrics(BaseModel):
    total_return: float | None = None
    cagr: float | None = None
    sharpe_ratio: float | None = None
    sortino_ratio: float | None = None
    max_drawdown: float | None = None
    win_rate: float | None = None
    profit_factor: float | None = None
    total_trades: int | None = None
    avg_trade_pnl: float | None = None


class BacktestResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    strategy_id: uuid.UUID
    strategy_version: int
    status: str
    start_date: date
    end_date: date
    initial_capital: float
    timeframe: str
    parameters: dict
    instruments: list

    # Metrics (populated on completion)
    total_return: float | None = None
    cagr: float | None = None
    sharpe_ratio: float | None = None
    sortino_ratio: float | None = None
    max_drawdown: float | None = None
    win_rate: float | None = None
    profit_factor: float | None = None
    total_trades: int | None = None
    avg_trade_pnl: float | None = None

    equity_curve: list | None = None
    drawdown_curve: list | None = None
    error_message: str | None = None

    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BacktestListResponse(BaseModel):
    id: uuid.UUID
    strategy_id: uuid.UUID
    strategy_version: int
    status: str
    start_date: date
    end_date: date
    initial_capital: float
    total_return: float | None = None
    sharpe_ratio: float | None = None
    max_drawdown: float | None = None
    total_trades: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BacktestTradeResponse(BaseModel):
    symbol: str
    exchange: str
    side: str
    quantity: int
    entry_price: float
    exit_price: float | None
    pnl: float | None
    pnl_percent: float | None
    charges: float
    net_pnl: float | None
    entry_at: str
    exit_at: str | None
