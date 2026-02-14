"""Simulated broker for paper trading — fills orders at market LTP."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional
from app.engine.common.events import OrderEvent, FillEvent
from app.integrations.kite_connect.constants import (
    INTRADAY_BROKERAGE_PERCENT, INTRADAY_BROKERAGE_MAX,
    STT_INTRADAY_SELL, EXCHANGE_TXN_CHARGE_NSE, GST_RATE,
    SEBI_CHARGES, STAMP_DUTY_BUY,
)

logger = logging.getLogger(__name__)

class SimulatedBroker:
    """Fills orders at current LTP with realistic fee simulation."""

    def __init__(self):
        self._current_prices: dict[str, float] = {}  # symbol -> LTP
        self._order_counter = 0

    def update_prices(self, prices: dict[str, float]):
        """Update LTPs from live tick data."""
        self._current_prices.update(prices)

    def get_price(self, symbol: str) -> Optional[float]:
        return self._current_prices.get(symbol)

    def try_fill_order(self, order: OrderEvent) -> Optional[FillEvent]:
        """Attempt to fill an order at current LTP."""
        ltp = self._current_prices.get(order.symbol)
        if ltp is None:
            return None  # No price available yet

        fill_price = ltp

        if order.order_type == "LIMIT":
            if order.side == "BUY" and ltp > (order.price or float('inf')):
                return None  # Price above limit
            if order.side == "SELL" and ltp < (order.price or 0):
                return None  # Price below limit
            fill_price = order.price or ltp

        elif order.order_type in ("SL", "SL-M"):
            trigger = order.trigger_price or order.price
            if trigger is None:
                return None
            if order.side == "BUY" and ltp < trigger:
                return None  # Trigger not hit
            if order.side == "SELL" and ltp > trigger:
                return None  # Trigger not hit
            fill_price = ltp  # Fill at market after trigger

        # Calculate fees (same Zerodha model as backtest)
        turnover = fill_price * order.quantity
        brokerage = min(turnover * INTRADAY_BROKERAGE_PERCENT / 100, INTRADAY_BROKERAGE_MAX)
        stt = turnover * STT_INTRADAY_SELL if order.side == "SELL" else 0
        exchange_charges = turnover * EXCHANGE_TXN_CHARGE_NSE
        gst = (brokerage + exchange_charges) * GST_RATE
        sebi = turnover * SEBI_CHARGES
        stamp = turnover * STAMP_DUTY_BUY if order.side == "BUY" else 0
        commission = round(brokerage + stt + exchange_charges + gst + sebi + stamp, 2)

        return FillEvent(
            timestamp=datetime.now(timezone.utc),
            symbol=order.symbol,
            exchange=order.exchange,
            side=order.side,
            quantity=order.quantity,
            fill_price=round(fill_price, 2),
            commission=commission,
            order_id=order.order_id,
        )
