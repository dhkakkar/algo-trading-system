import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class StrategyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    code: str = Field(..., min_length=10)
    parameters: dict = Field(default_factory=dict)
    instruments: list[str] = Field(default_factory=list)
    timeframe: str = Field(default="1d", pattern=r"^(1m|5m|15m|30m|1h|1d)$")


class StrategyUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    code: str | None = Field(None, min_length=10)
    parameters: dict | None = None
    instruments: list[str] | None = None
    timeframe: str | None = Field(None, pattern=r"^(1m|5m|15m|30m|1h|1d)$")


class StrategyResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: str | None
    code: str
    source_type: str
    version: int
    is_active: bool
    parameters: dict
    instruments: list
    timeframe: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StrategyListResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    source_type: str
    version: int
    is_active: bool
    instruments: list
    timeframe: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StrategyVersionResponse(BaseModel):
    id: uuid.UUID
    strategy_id: uuid.UUID
    version: int
    code: str
    parameters: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class StrategyValidateResponse(BaseModel):
    valid: bool
    error: str | None = None
