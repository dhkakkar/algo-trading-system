from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    SL = "SL"
    SL_M = "SL-M"


class Product(str, Enum):
    CNC = "CNC"    # Cash and Carry (delivery)
    MIS = "MIS"    # Margin Intraday
    NRML = "NRML"  # Normal (F&O)


class SignalType(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    EXIT = "EXIT"


@dataclass
class Signal:
    symbol: str
    signal_type: SignalType
    strength: float = 1.0
    exchange: str = "NSE"


@dataclass
class FilledOrder:
    order_id: str
    symbol: str
    exchange: str
    side: str
    quantity: int
    fill_price: float
    timestamp: datetime


@dataclass
class PositionInfo:
    symbol: str
    exchange: str
    side: str  # LONG or SHORT
    quantity: int
    average_entry_price: float
    current_price: float
    unrealized_pnl: float
    pnl_percent: float
