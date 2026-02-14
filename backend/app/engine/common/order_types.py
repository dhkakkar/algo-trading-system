"""Enumerations for order-related constants used across all engine modes."""

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
    MIS = "MIS"    # Margin Intraday Settlement
    NRML = "NRML"  # Normal (F&O overnight)


class OrderStatus(str, Enum):
    PENDING = "pending"
    OPEN = "open"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
