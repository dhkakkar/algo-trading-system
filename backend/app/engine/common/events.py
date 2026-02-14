"""
Event dataclasses for the event-driven trading engine architecture.

These events flow through the system in the following order:
  MarketEvent -> (strategy logic) -> SignalEvent -> OrderEvent -> FillEvent
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class MarketEvent:
    """New market bar available for one or more symbols."""

    timestamp: datetime
    data: dict  # {symbol: {open, high, low, close, volume}}


@dataclass
class SignalEvent:
    """Strategy generated a trading signal."""

    timestamp: datetime
    symbol: str
    exchange: str
    signal_type: str  # 'BUY' or 'SELL'
    quantity: int
    order_type: str  # 'MARKET', 'LIMIT', etc.
    price: Optional[float] = None
    product: str = "MIS"


@dataclass
class OrderEvent:
    """An order to be sent for execution."""

    timestamp: datetime
    symbol: str
    exchange: str
    side: str  # 'BUY' or 'SELL'
    quantity: int
    order_type: str  # 'MARKET', 'LIMIT', 'SL', 'SL-M'
    order_id: str = ""
    price: Optional[float] = None
    trigger_price: Optional[float] = None
    product: str = "MIS"
    status: str = "pending"


@dataclass
class FillEvent:
    """An order has been filled (fully or partially)."""

    timestamp: datetime
    symbol: str
    exchange: str
    side: str  # 'BUY' or 'SELL'
    quantity: int
    fill_price: float
    commission: float  # Total charges (brokerage + STT + taxes)
    order_id: str = ""
