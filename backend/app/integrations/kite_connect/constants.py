"""Zerodha Kite Connect constants."""

# Exchanges
class Exchange:
    NSE = "NSE"
    BSE = "BSE"
    NFO = "NFO"
    CDS = "CDS"
    BFO = "BFO"
    MCX = "MCX"
    BCD = "BCD"

# Product types
class ProductType:
    CNC = "CNC"      # Cash and Carry (delivery)
    MIS = "MIS"      # Margin Intraday Settlement
    NRML = "NRML"    # Normal (F&O overnight)

# Order types
class OrderType:
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    SL = "SL"        # Stop Loss
    SL_M = "SL-M"    # Stop Loss Market

# Order variety
class Variety:
    REGULAR = "regular"
    AMO = "amo"        # After Market Order
    CO = "co"          # Cover Order
    ICEBERG = "iceberg"

# Transaction types
class TransactionType:
    BUY = "BUY"
    SELL = "SELL"

# Validity
class Validity:
    DAY = "DAY"
    IOC = "IOC"        # Immediate or Cancel
    TTL = "TTL"        # Time to Live

# Market hours (IST)
MARKET_OPEN_HOUR = 9
MARKET_OPEN_MINUTE = 15
MARKET_CLOSE_HOUR = 15
MARKET_CLOSE_MINUTE = 30

# Zerodha brokerage structure
EQUITY_BROKERAGE_PERCENT = 0  # Zero for delivery
INTRADAY_BROKERAGE_PERCENT = 0.03  # 0.03% or Rs 20 whichever is lower
INTRADAY_BROKERAGE_MAX = 20
STT_DELIVERY_BUY = 0.001  # 0.1% on buy side
STT_DELIVERY_SELL = 0.001  # 0.1% on sell side
STT_INTRADAY_SELL = 0.00025  # 0.025% on sell side only
EXCHANGE_TXN_CHARGE_NSE = 0.0000345
EXCHANGE_TXN_CHARGE_BSE = 0.0000375
GST_RATE = 0.18  # 18% on brokerage + txn charges
SEBI_CHARGES = 0.000001  # Rs 10 per crore
STAMP_DUTY_BUY = 0.00015  # 0.015% on buy side
