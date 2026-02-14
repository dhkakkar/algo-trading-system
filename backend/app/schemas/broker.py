from datetime import datetime
from pydantic import BaseModel, Field


class BrokerConnectRequest(BaseModel):
    api_key: str = Field(..., min_length=1)
    api_secret: str = Field(..., min_length=1)


class BrokerCallbackRequest(BaseModel):
    request_token: str


class BrokerStatusResponse(BaseModel):
    connected: bool
    broker: str = "zerodha"
    api_key: str | None = None
    token_expiry: datetime | None = None
    login_url: str | None = None
