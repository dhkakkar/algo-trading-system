"""
Portfolio tracker for backtesting.

Maintains positions, cash, equity curve, and completed trade records as the
backtest progresses bar by bar.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from app.engine.common.events import FillEvent

logger = logging.getLogger(__name__)


class Portfolio:
    """
    In-memory portfolio state manager for a single backtest run.

    Tracks:
      - Cash balance
      - Open positions (keyed by symbol)
      - Equity curve (list of {timestamp, equity} snapshots)
      - Completed (round-trip) trades
      - All order records

    Args:
        initial_capital: Starting cash in INR.
    """

    def __init__(self, initial_capital: float) -> None:
        self.initial_capital: float = initial_capital
        self.cash: float = initial_capital

        # Open positions: {symbol: {quantity, avg_price, side, exchange, total_cost}}
        self.positions: dict[str, dict[str, Any]] = {}

        # Equity curve snapshots
        self.equity_curve: list[dict[str, Any]] = []

        # Completed round-trip trades
        self.trades: list[dict[str, Any]] = []

        # All order records (for reference / debugging)
        self.orders: list[dict[str, Any]] = []

        # Running totals for charge tracking
        self.total_charges: float = 0.0

    # ------------------------------------------------------------------
    # Fill processing
    # ------------------------------------------------------------------

    def update_on_fill(self, fill: FillEvent) -> Optional[dict]:
        """
        Update positions and cash when an order is filled.

        For BUY fills:
          - If no existing position or existing LONG position: add to long.
          - If existing SHORT position: reduce/close short.

        For SELL fills:
          - If no existing position or existing SHORT position: add to short.
          - If existing LONG position: reduce/close long.

        Returns a completed trade dict if a position was closed/reduced,
        otherwise ``None``.

        Args:
            fill: The FillEvent describing the execution.

        Returns:
            A trade dict if the fill closed (or partially closed) a position,
            otherwise None.
        """
        self.total_charges += fill.commission

        is_buy = fill.side.upper() == "BUY"
        symbol = fill.symbol
        position = self.positions.get(symbol)

        completed_trade: Optional[dict] = None

        if position is None:
            # No existing position -- open a new one
            self._open_position(fill)
            # Deduct/add cash
            if is_buy:
                self.cash -= (fill.fill_price * fill.quantity) + fill.commission
            else:
                self.cash += (fill.fill_price * fill.quantity) - fill.commission
        else:
            pos_side = position["side"]

            if (is_buy and pos_side == "LONG") or (not is_buy and pos_side == "SHORT"):
                # Adding to an existing position in the same direction
                self._add_to_position(fill)
                if is_buy:
                    self.cash -= (fill.fill_price * fill.quantity) + fill.commission
                else:
                    self.cash += (fill.fill_price * fill.quantity) - fill.commission
            else:
                # Closing / reducing the position (opposite direction)
                completed_trade = self._reduce_position(fill)

        return completed_trade

    # ------------------------------------------------------------------
    # Position queries
    # ------------------------------------------------------------------

    def get_position(self, symbol: str) -> Optional[dict]:
        """
        Get the current position for *symbol*.

        Returns a dict with keys:
          ``symbol, exchange, side, quantity, avg_price``
        or ``None`` if flat.
        """
        pos = self.positions.get(symbol)
        if pos is None:
            return None
        return {
            "symbol": symbol,
            "exchange": pos["exchange"],
            "side": pos["side"],
            "quantity": pos["quantity"],
            "avg_price": pos["avg_price"],
        }

    def get_all_positions(self) -> list[dict]:
        """Return a list of all open positions."""
        result = []
        for symbol, pos in self.positions.items():
            result.append({
                "symbol": symbol,
                "exchange": pos["exchange"],
                "side": pos["side"],
                "quantity": pos["quantity"],
                "avg_price": pos["avg_price"],
            })
        return result

    # ------------------------------------------------------------------
    # Portfolio value
    # ------------------------------------------------------------------

    def get_portfolio_value(self, current_prices: dict[str, float]) -> float:
        """
        Calculate total portfolio value: cash + mark-to-market positions.

        Args:
            current_prices: ``{symbol: current_price}`` for all traded symbols.
        """
        position_value = 0.0
        for symbol, pos in self.positions.items():
            price = current_prices.get(symbol, pos["avg_price"])
            qty = pos["quantity"]
            if pos["side"] == "LONG":
                position_value += price * qty
            else:
                # SHORT: liability to buy back at current price.
                # Cash already received sell proceeds, so position value
                # is the negative of the current buyback cost.
                position_value -= price * qty

        return self.cash + position_value

    # ------------------------------------------------------------------
    # Equity curve
    # ------------------------------------------------------------------

    def record_equity(
        self, timestamp: datetime, current_prices: dict[str, float]
    ) -> None:
        """Record a snapshot of the portfolio value on the equity curve."""
        equity = self.get_portfolio_value(current_prices)
        self.equity_curve.append({
            "timestamp": timestamp.isoformat() if isinstance(timestamp, datetime) else str(timestamp),
            "equity": round(equity, 2),
        })

    # ------------------------------------------------------------------
    # Force-close all positions
    # ------------------------------------------------------------------

    def close_all_positions(
        self, current_prices: dict[str, float], timestamp: datetime
    ) -> list[dict]:
        """
        Close all open positions at current market prices.

        This is called at the end of a backtest to ensure all trades are
        properly recorded.

        Returns a list of completed trade dicts.
        """
        closed_trades = []
        symbols = list(self.positions.keys())

        for symbol in symbols:
            pos = self.positions[symbol]
            price = current_prices.get(symbol, pos["avg_price"])

            # Create a synthetic fill to close
            if pos["side"] == "LONG":
                close_side = "SELL"
            else:
                close_side = "BUY"

            fill = FillEvent(
                timestamp=timestamp,
                symbol=symbol,
                exchange=pos["exchange"],
                side=close_side,
                quantity=pos["quantity"],
                fill_price=price,
                commission=0.0,  # Simplified -- no commission on forced close
                order_id=f"CLOSE-{symbol}",
            )

            trade = self.update_on_fill(fill)
            if trade is not None:
                closed_trades.append(trade)

        return closed_trades

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _open_position(self, fill: FillEvent) -> None:
        """Open a new position from a fill."""
        side = "LONG" if fill.side.upper() == "BUY" else "SHORT"
        self.positions[fill.symbol] = {
            "quantity": fill.quantity,
            "avg_price": fill.fill_price,
            "side": side,
            "exchange": fill.exchange,
            "total_cost": fill.fill_price * fill.quantity,
            "entry_timestamp": fill.timestamp,
            "entry_order_id": fill.order_id,
        }
        logger.debug(
            "Opened %s position: %s x%d @ %.2f",
            side, fill.symbol, fill.quantity, fill.fill_price,
        )

    def _add_to_position(self, fill: FillEvent) -> None:
        """Add to an existing position in the same direction."""
        pos = self.positions[fill.symbol]
        old_qty = pos["quantity"]
        old_cost = pos["total_cost"]

        new_cost = fill.fill_price * fill.quantity
        total_qty = old_qty + fill.quantity
        total_cost = old_cost + new_cost

        pos["quantity"] = total_qty
        pos["total_cost"] = total_cost
        pos["avg_price"] = round(total_cost / total_qty, 2)

        logger.debug(
            "Added to %s: %s +%d @ %.2f (avg now %.2f, total %d)",
            pos["side"], fill.symbol, fill.quantity, fill.fill_price,
            pos["avg_price"], total_qty,
        )

    def _reduce_position(self, fill: FillEvent) -> Optional[dict]:
        """
        Reduce or close an existing position (opposite-side fill).

        Returns a completed trade dict.
        """
        pos = self.positions[fill.symbol]
        close_qty = min(fill.quantity, pos["quantity"])
        remaining_qty = pos["quantity"] - close_qty
        excess_qty = fill.quantity - close_qty

        # Calculate P&L for the closed portion
        if pos["side"] == "LONG":
            # Was long, now selling
            pnl = (fill.fill_price - pos["avg_price"]) * close_qty
            # Cash changes: receive sale proceeds minus commission
            self.cash += (fill.fill_price * close_qty) - fill.commission
        else:
            # Was short, now buying to cover
            pnl = (pos["avg_price"] - fill.fill_price) * close_qty
            # Cash changes: pay for covering minus commission
            self.cash -= (fill.fill_price * close_qty) + fill.commission

        net_pnl = pnl - fill.commission

        # Build the completed trade record
        trade = {
            "symbol": fill.symbol,
            "exchange": fill.exchange,
            "side": pos["side"],
            "quantity": close_qty,
            "entry_price": pos["avg_price"],
            "exit_price": fill.fill_price,
            "pnl": round(pnl, 2),
            "charges": round(fill.commission, 2),
            "net_pnl": round(net_pnl, 2),
            "pnl_percent": round(
                (pnl / (pos["avg_price"] * close_qty)) * 100, 4
            ) if pos["avg_price"] * close_qty != 0 else 0.0,
            "entry_at": (
                pos["entry_timestamp"].isoformat()
                if isinstance(pos["entry_timestamp"], datetime)
                else str(pos["entry_timestamp"])
            ),
            "exit_at": (
                fill.timestamp.isoformat()
                if isinstance(fill.timestamp, datetime)
                else str(fill.timestamp)
            ),
            "entry_order_id": pos.get("entry_order_id", ""),
            "exit_order_id": fill.order_id,
        }
        self.trades.append(trade)

        logger.debug(
            "Closed %s %s x%d: entry=%.2f exit=%.2f pnl=%.2f",
            pos["side"], fill.symbol, close_qty,
            pos["avg_price"], fill.fill_price, pnl,
        )

        if remaining_qty > 0:
            # Partial close -- reduce the position
            pos["quantity"] = remaining_qty
            pos["total_cost"] = pos["avg_price"] * remaining_qty
        else:
            # Fully closed
            del self.positions[fill.symbol]

        # If there is excess quantity, open a new position in the opposite direction
        if excess_qty > 0:
            new_side = "LONG" if fill.side.upper() == "BUY" else "SHORT"
            self.positions[fill.symbol] = {
                "quantity": excess_qty,
                "avg_price": fill.fill_price,
                "side": new_side,
                "exchange": fill.exchange,
                "total_cost": fill.fill_price * excess_qty,
                "entry_timestamp": fill.timestamp,
                "entry_order_id": fill.order_id,
            }
            # Adjust cash for the new position portion
            if fill.side.upper() == "BUY":
                self.cash -= fill.fill_price * excess_qty
            else:
                self.cash += fill.fill_price * excess_qty

            logger.debug(
                "Reversed to %s: %s x%d @ %.2f",
                new_side, fill.symbol, excess_qty, fill.fill_price,
            )

        return trade
