"""
Simulated execution handler for backtesting.

Models realistic order fills with slippage and calculates Zerodha-style
brokerage and regulatory charges for Indian equity markets.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.engine.common.events import FillEvent, OrderEvent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Zerodha fee constants (mirrored from app.integrations.kite_connect.constants
# but inlined here so the backtest engine has zero external broker dependency).
# ---------------------------------------------------------------------------

# Brokerage
_EQUITY_DELIVERY_BROKERAGE_PCT = 0.0         # Zero for delivery
_INTRADAY_BROKERAGE_PCT = 0.0003             # 0.03%
_INTRADAY_BROKERAGE_MAX = 20.0               # Rs 20 cap per order

# Securities Transaction Tax
_STT_DELIVERY_PCT = 0.001                    # 0.1% on both buy & sell
_STT_INTRADAY_SELL_PCT = 0.00025             # 0.025% on sell side only

# Exchange transaction charges
_EXCHANGE_TXN_NSE = 0.0000345
_EXCHANGE_TXN_BSE = 0.0000375

# GST on (brokerage + exchange txn charges)
_GST_RATE = 0.18

# SEBI charges (Rs 10 per crore = 0.0001%)
_SEBI_CHARGES = 0.000001

# Stamp duty (on buy side only)
_STAMP_DUTY_BUY = 0.00015                    # 0.015%


class SimulatedExecutionHandler:
    """
    Simulates order execution during a backtest.

    Supports MARKET, LIMIT, SL, and SL-M order types with configurable
    slippage.

    Args:
        slippage_percent: Slippage applied to market order fills as a
            fraction (e.g. 0.05 means 0.05%).  Buys are slipped up, sells
            are slipped down.
        fill_at: Determines the base fill price for MARKET orders.

            - ``"next_open"`` (default): fill at the *next* bar's open price
              plus slippage.  This is the most realistic setting because the
              strategy decision is made *after* seeing the current bar, and
              the earliest possible execution is the next bar's open.
            - ``"current_close"``: fill at the *current* bar's close plus
              slippage.  Slightly optimistic but useful for daily strategies
              where the signal fires near the close and a Market-On-Close
              order is assumed.
    """

    def __init__(
        self,
        slippage_percent: float = 0.05,
        fill_at: str = "next_open",
    ) -> None:
        self.slippage_pct = slippage_percent / 100.0  # convert to fraction
        if fill_at not in ("next_open", "current_close"):
            raise ValueError(f"fill_at must be 'next_open' or 'current_close', got '{fill_at}'")
        self.fill_at = fill_at

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def execute_order(
        self,
        order: OrderEvent,
        current_bar: dict,
        next_bar: Optional[dict] = None,
    ) -> Optional[FillEvent]:
        """
        Attempt to fill *order* given the current and (optionally) next bar.

        Returns a :class:`FillEvent` if the order is filled, or ``None`` if
        the order cannot be filled on this bar (e.g. a LIMIT order whose
        price was never reached).

        Args:
            order: The order to execute.
            current_bar: OHLCV dict for the bar on which the order was placed
                         or is being evaluated.
            next_bar: OHLCV dict for the bar *after* the order was placed.
                      Required when ``fill_at="next_open"``.
        """
        order_type = order.order_type.upper()

        if order_type == "MARKET":
            return self._fill_market(order, current_bar, next_bar)
        elif order_type == "LIMIT":
            return self._fill_limit(order, current_bar, next_bar)
        elif order_type == "SL":
            return self._fill_stop_loss(order, current_bar, next_bar)
        elif order_type in ("SL-M", "SL_M"):
            return self._fill_stop_loss_market(order, current_bar, next_bar)
        else:
            logger.warning("Unknown order type '%s' -- treating as MARKET", order_type)
            return self._fill_market(order, current_bar, next_bar)

    # ------------------------------------------------------------------
    # Charges calculation
    # ------------------------------------------------------------------

    def calculate_charges(
        self,
        symbol: str,
        exchange: str,
        side: str,
        quantity: int,
        price: float,
        product: str,
    ) -> float:
        """
        Calculate total transaction charges (Zerodha fee structure).

        Includes brokerage, STT, exchange txn charges, GST, SEBI charges,
        and stamp duty.

        Returns the total charges in INR.
        """
        turnover = quantity * price
        is_buy = side.upper() == "BUY"
        is_intraday = product.upper() == "MIS"

        # --- Brokerage ---
        if is_intraday:
            brokerage = min(turnover * _INTRADAY_BROKERAGE_PCT, _INTRADAY_BROKERAGE_MAX)
        else:
            # Delivery: zero brokerage at Zerodha
            brokerage = 0.0

        # --- STT ---
        if is_intraday:
            # Intraday: STT only on sell side
            stt = turnover * _STT_INTRADAY_SELL_PCT if not is_buy else 0.0
        else:
            # Delivery: STT on both sides
            stt = turnover * _STT_DELIVERY_PCT

        # --- Exchange transaction charges ---
        exch = exchange.upper()
        if exch == "BSE":
            txn_rate = _EXCHANGE_TXN_BSE
        else:
            txn_rate = _EXCHANGE_TXN_NSE  # default to NSE rate
        exchange_txn = turnover * txn_rate

        # --- GST: 18% on (brokerage + exchange txn charges) ---
        gst = (brokerage + exchange_txn) * _GST_RATE

        # --- SEBI charges ---
        sebi = turnover * _SEBI_CHARGES

        # --- Stamp duty (buy side only) ---
        stamp = turnover * _STAMP_DUTY_BUY if is_buy else 0.0

        total = brokerage + stt + exchange_txn + gst + sebi + stamp

        return round(total, 2)

    # ------------------------------------------------------------------
    # Private fill methods
    # ------------------------------------------------------------------

    def _fill_market(
        self,
        order: OrderEvent,
        current_bar: dict,
        next_bar: Optional[dict],
    ) -> Optional[FillEvent]:
        """Fill a MARKET order."""
        base_price = self._get_base_price(current_bar, next_bar)
        if base_price is None:
            return None

        fill_price = self._apply_slippage(base_price, order.side)
        return self._create_fill(order, fill_price, current_bar, next_bar)

    def _fill_limit(
        self,
        order: OrderEvent,
        current_bar: dict,
        next_bar: Optional[dict],
    ) -> Optional[FillEvent]:
        """
        Fill a LIMIT order if the price was reachable during the bar.

        For BUY LIMIT: fills if the bar's low <= limit price.
        For SELL LIMIT: fills if the bar's high >= limit price.

        The fill price is the limit price itself (best case for limit orders).
        """
        if order.price is None:
            logger.warning("LIMIT order for %s has no price -- skipping", order.symbol)
            return None

        # Use the execution bar (next bar for next_open mode, current for current_close)
        exec_bar = self._get_execution_bar(current_bar, next_bar)
        if exec_bar is None:
            return None

        is_buy = order.side.upper() == "BUY"

        if is_buy:
            # BUY LIMIT: fill if the bar's low went at or below our limit
            if exec_bar["low"] <= order.price:
                # Fill at the limit price (or open if open is already below limit)
                fill_price = min(order.price, exec_bar["open"])
                return self._create_fill(order, fill_price, current_bar, next_bar)
        else:
            # SELL LIMIT: fill if the bar's high went at or above our limit
            if exec_bar["high"] >= order.price:
                fill_price = max(order.price, exec_bar["open"])
                return self._create_fill(order, fill_price, current_bar, next_bar)

        return None  # Price not reached

    def _fill_stop_loss(
        self,
        order: OrderEvent,
        current_bar: dict,
        next_bar: Optional[dict],
    ) -> Optional[FillEvent]:
        """
        Fill a SL (Stop-Loss Limit) order.

        The trigger_price activates the order; once triggered it becomes a
        LIMIT order at order.price.

        For BUY SL: trigger when bar's high >= trigger_price, fill at limit.
        For SELL SL: trigger when bar's low <= trigger_price, fill at limit.
        """
        if order.trigger_price is None:
            logger.warning("SL order for %s has no trigger price -- skipping", order.symbol)
            return None

        exec_bar = self._get_execution_bar(current_bar, next_bar)
        if exec_bar is None:
            return None

        is_buy = order.side.upper() == "BUY"
        triggered = False

        if is_buy:
            triggered = exec_bar["high"] >= order.trigger_price
        else:
            triggered = exec_bar["low"] <= order.trigger_price

        if not triggered:
            return None

        # Once triggered, try to fill at the limit price
        limit_price = order.price if order.price is not None else order.trigger_price
        if is_buy:
            if exec_bar["low"] <= limit_price:
                fill_price = min(limit_price, max(exec_bar["open"], order.trigger_price))
                return self._create_fill(order, fill_price, current_bar, next_bar)
        else:
            if exec_bar["high"] >= limit_price:
                fill_price = max(limit_price, min(exec_bar["open"], order.trigger_price))
                return self._create_fill(order, fill_price, current_bar, next_bar)

        return None  # Triggered but limit not reachable

    def _fill_stop_loss_market(
        self,
        order: OrderEvent,
        current_bar: dict,
        next_bar: Optional[dict],
    ) -> Optional[FillEvent]:
        """
        Fill a SL-M (Stop-Loss Market) order.

        Same trigger logic as SL, but once triggered, fills as a MARKET
        order (at trigger price + slippage).
        """
        if order.trigger_price is None:
            logger.warning("SL-M order for %s has no trigger -- skipping", order.symbol)
            return None

        exec_bar = self._get_execution_bar(current_bar, next_bar)
        if exec_bar is None:
            return None

        is_buy = order.side.upper() == "BUY"

        if is_buy:
            if exec_bar["high"] >= order.trigger_price:
                # Triggered -- fill at trigger or open, whichever is worse for buyer
                base = max(exec_bar["open"], order.trigger_price)
                fill_price = self._apply_slippage(base, order.side)
                return self._create_fill(order, fill_price, current_bar, next_bar)
        else:
            if exec_bar["low"] <= order.trigger_price:
                base = min(exec_bar["open"], order.trigger_price)
                fill_price = self._apply_slippage(base, order.side)
                return self._create_fill(order, fill_price, current_bar, next_bar)

        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_base_price(
        self, current_bar: dict, next_bar: Optional[dict]
    ) -> Optional[float]:
        """Determine the base fill price based on the ``fill_at`` setting."""
        if self.fill_at == "next_open":
            if next_bar is None:
                # No next bar (last bar of data) -- fall back to current close
                return current_bar.get("close")
            return next_bar.get("open")
        else:
            # current_close
            return current_bar.get("close")

    def _get_execution_bar(
        self, current_bar: dict, next_bar: Optional[dict]
    ) -> Optional[dict]:
        """Return the bar on which execution is evaluated."""
        if self.fill_at == "next_open":
            return next_bar if next_bar is not None else current_bar
        return current_bar

    def _apply_slippage(self, price: float, side: str) -> float:
        """Apply slippage to a price.  Buys slip up, sells slip down."""
        if side.upper() == "BUY":
            return round(price * (1 + self.slippage_pct), 2)
        else:
            return round(price * (1 - self.slippage_pct), 2)

    def _create_fill(
        self,
        order: OrderEvent,
        fill_price: float,
        current_bar: dict,
        next_bar: Optional[dict],
    ) -> FillEvent:
        """Create a FillEvent with commission calculated."""
        commission = self.calculate_charges(
            symbol=order.symbol,
            exchange=order.exchange,
            side=order.side,
            quantity=order.quantity,
            price=fill_price,
            product=order.product,
        )

        # Fill timestamp: use execution bar's timestamp
        if self.fill_at == "next_open" and next_bar is not None:
            fill_ts = next_bar.get("timestamp", order.timestamp)
        else:
            fill_ts = current_bar.get("timestamp", order.timestamp)

        return FillEvent(
            timestamp=fill_ts,
            symbol=order.symbol,
            exchange=order.exchange,
            side=order.side,
            quantity=order.quantity,
            fill_price=round(fill_price, 2),
            commission=commission,
            order_id=order.order_id,
        )
