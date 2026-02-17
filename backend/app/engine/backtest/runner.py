"""
Backtest runner -- the core engine that replays historical data through a
user-defined strategy.

This module contains two main classes:

- **BacktestRunner**: Orchestrates the event loop, manages data, execution,
  and portfolio state, and produces the final results dict.

- **BacktestContext**: A concrete subclass of ``TradingContext`` that wires
  ``ctx.buy()``, ``ctx.sell()``, ``ctx.get_historical_data()``, etc. to the
  runner's internal components.  All methods are *synchronous* because user
  strategy code calls them synchronously from ``on_data()``.
"""

from __future__ import annotations

import logging
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.core.timezone import IST

from app.engine.backtest.data_handler import HistoricalDataHandler
from app.engine.backtest.execution_handler import SimulatedExecutionHandler
from app.engine.backtest.metrics import calculate_all_metrics
from app.engine.backtest.portfolio import Portfolio
from app.engine.common.base_runner import BaseRunner
from app.engine.common.events import FillEvent, OrderEvent
from app.sdk.context import TradingContext
from app.sdk.types import FilledOrder, PositionInfo

logger = logging.getLogger(__name__)


# ======================================================================
# BacktestContext -- synchronous bridge from strategy to runner
# ======================================================================

class BacktestContext(TradingContext):
    """
    ``TradingContext`` implementation for backtesting.

    Every method that a user strategy calls (``ctx.buy()``,
    ``ctx.get_historical_data()``, etc.) is routed through this class to
    the owning :class:`BacktestRunner`.

    All methods are **synchronous** -- they execute immediately and return
    results.  The runner handles any async DB persistence *outside* of the
    strategy callbacks.

    Args:
        runner: The ``BacktestRunner`` instance that owns this context.
        params: Strategy parameters dict passed to the strategy at init time.
    """

    def __init__(
        self,
        runner: "BacktestRunner",
        params: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(params=params)
        self._runner: "BacktestRunner" = runner

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    def get_historical_data(
        self,
        symbol: str,
        exchange: str = "NSE",
        periods: int = 100,
        interval: str = "1d",
    ):
        """Return up to *periods* historical bars for *symbol*."""
        return self._runner.data_handler.get_historical(symbol, periods)

    def get_current_price(self, symbol: str, exchange: str = "NSE") -> float:
        """Return the close price of the current bar for *symbol*."""
        return self._runner.data_handler.get_current_price(symbol)

    def get_current_bar(self, symbol: str | None = None) -> dict:
        """Return the current OHLCV bar as a dict."""
        if symbol is None and self._runner._instruments:
            symbol = self._runner._instruments[0].get("symbol")
        return self._runner.data_handler.get_current_bar(symbol)

    # ------------------------------------------------------------------
    # Order management
    # ------------------------------------------------------------------

    def _is_time_locked(self) -> bool:
        """Check if the current bar falls within any time lock window (IST)."""
        locks = getattr(self._runner, "_time_locks", [])
        if not locks:
            return False
        ts = self._runner.data_handler.current_timestamp
        if not ts or not hasattr(ts, "hour"):
            return False
        # Convert to IST for comparison
        ts_ist = _to_ist(ts)
        bar_time = (ts_ist.hour, ts_ist.minute)
        for (sh, sm), (eh, em) in locks:
            if (sh, sm) <= bar_time < (eh, em):
                return True
        return False

    def _resolve_options_order(self, symbol: str, quantity: int, side: str) -> tuple[str, int, str, str, float | None]:
        """When options_mode is on, translate an underlying signal into an options order.

        Returns (resolved_symbol, resolved_qty, resolved_side, resolved_exchange, override_price).
        For a BUY signal on underlying: buy ATM CE
        For a SELL signal on underlying: buy ATM PE
        If options_handler can't resolve, falls back to the original order.
        """
        oh = self._runner.options_handler
        if not oh or not oh.enabled:
            return symbol, quantity, side, "NSE", None

        ts = self._runner.data_handler.current_timestamp
        if not ts:
            return symbol, quantity, side, "NSE", None

        spot = self._runner.data_handler.get_current_price(symbol)
        option = oh.resolve_option(spot, ts, side)
        if not option:
            self._runner._add_log("WARNING", f"Options resolve failed for {side} {symbol} @ spot {spot:.2f} — using spot", "runner")
            return symbol, quantity, side, "NSE", None

        opt_symbol = option["tradingsymbol"]
        lot_size = option["lot_size"]
        opt_price = option["option_price"]
        # Always BUY the option (buy CE for long, buy PE for short)
        resolved_qty = lot_size * max(quantity, 1)

        self._runner._add_log(
            "INFO",
            f"Options: {side} signal → BUY {opt_symbol} (strike={option['strike']}, "
            f"expiry={option['expiry']}, price={opt_price:.2f}, qty={resolved_qty})",
            "runner",
        )
        return opt_symbol, resolved_qty, "BUY", "NFO", opt_price

    def buy(
        self,
        symbol: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float | None = None,
        exchange: str = "NSE",
        product: str = "MIS",
    ) -> str:
        """
        Place a BUY order.

        The order is queued and will be executed on the next bar (for
        ``fill_at="next_open"``) or at the current bar's close (for
        ``fill_at="current_close"``).

        Returns a unique order-id string.
        """
        if self._is_time_locked():
            ts = self._runner.data_handler.current_timestamp
            self._runner._add_log("WARNING", f"BUY {symbol} blocked — time lock active at {ts.strftime('%H:%M') if ts else '?'}", "runner")
            return ""

        # Options mode: close any held PE (from previous short), then buy CE
        oh = self._runner.options_handler
        if oh and oh.enabled:
            # If we hold a PE option (from a previous SELL signal), close it first
            if oh._held_option and oh._held_option.get("option_type") == "PE":
                self._close_held_option()
            # Now open a CE position
            opt_sym, opt_qty, opt_side, opt_exchange, opt_price = self._resolve_options_order(symbol, quantity, "BUY")
            if opt_exchange == "NFO":
                return self._place_order(opt_sym, opt_qty, opt_side, order_type, opt_price, opt_exchange, "NRML", option_type="CE")
            # Fallback to spot
        return self._place_order(symbol, quantity, "BUY", order_type, price, exchange, product)

    def sell(
        self,
        symbol: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float | None = None,
        exchange: str = "NSE",
        product: str = "MIS",
    ) -> str:
        """
        Place a SELL order.

        Returns a unique order-id string.
        """
        if self._is_time_locked():
            ts = self._runner.data_handler.current_timestamp
            self._runner._add_log("WARNING", f"SELL {symbol} blocked — time lock active at {ts.strftime('%H:%M') if ts else '?'}", "runner")
            return ""

        # Options mode: close any held CE (from previous long), then buy PE
        oh = self._runner.options_handler
        if oh and oh.enabled:
            # If we hold a CE option (from a previous BUY signal), close it first
            if oh._held_option and oh._held_option.get("option_type") == "CE":
                self._close_held_option()
            # Now open a PE position
            opt_sym, opt_qty, opt_side, opt_exchange, opt_price = self._resolve_options_order(symbol, quantity, "SELL")
            if opt_exchange == "NFO":
                return self._place_order(opt_sym, opt_qty, opt_side, order_type, opt_price, opt_exchange, "NRML", option_type="PE")
            # Fallback to spot
        return self._place_order(symbol, quantity, "SELL", order_type, price, exchange, product)

    def _close_held_option(self):
        """Close a previously opened options position by selling it."""
        oh = self._runner.options_handler
        if not oh or not oh._held_option:
            return
        held = oh._held_option
        opt_sym = held["tradingsymbol"]
        opt_qty = held["quantity"]
        self._runner._add_log("INFO", f"Options: closing held {held.get('option_type', '?')} {opt_sym} x{opt_qty}", "runner")
        self._place_order(opt_sym, opt_qty, "SELL", "MARKET", None, "NFO", "NRML")
        oh._held_option = None

    def _place_order(
        self,
        symbol: str,
        quantity: int,
        side: str,
        order_type: str = "MARKET",
        price: float | None = None,
        exchange: str = "NSE",
        product: str = "MIS",
        option_type: str | None = None,
    ) -> str:
        """Internal: queue an order event."""
        order_id = f"BT-{self._runner.backtest_id[:8]}-{len(self._runner._order_queue)}"

        order = OrderEvent(
            timestamp=self._runner.data_handler.current_timestamp or datetime.now(timezone.utc),
            symbol=symbol,
            exchange=exchange,
            side=side,
            quantity=quantity,
            order_type=order_type.upper(),
            order_id=order_id,
            price=price,
            trigger_price=price if order_type.upper() in ("SL", "SL-M") else None,
            product=product,
            status="pending",
        )

        self._runner._order_queue.append(order)
        self._runner.portfolio.orders.append({
            "order_id": order_id,
            "symbol": symbol,
            "exchange": exchange,
            "side": side,
            "quantity": quantity,
            "order_type": order_type,
            "price": price,
            "product": product,
            "status": "pending",
            "timestamp": order.timestamp.isoformat()
            if isinstance(order.timestamp, datetime)
            else str(order.timestamp),
        })

        # Track held option
        oh = self._runner.options_handler
        if oh and oh.enabled and option_type and side == "BUY":
            oh._held_option = {
                "tradingsymbol": symbol,
                "option_type": option_type,
                "quantity": quantity,
                "entry_price": price,
            }

        self._runner._add_log("INFO", f"{side} order queued: {symbol} x{quantity} @ {price or 'MARKET'} ({order_type})", "strategy")
        logger.debug("%s order queued: %s x%d @ %s (%s)", side, symbol, quantity, price or "MARKET", order_id)
        return order_id

    def cancel_order(self, order_id: str) -> bool:
        """
        Cancel a pending order by removing it from the queue.

        Returns ``True`` if the order was found and cancelled.
        """
        for i, order in enumerate(self._runner._order_queue):
            if order.order_id == order_id and order.status == "pending":
                order.status = "cancelled"
                self._runner._order_queue.pop(i)
                # Update the order record
                for rec in self._runner.portfolio.orders:
                    if rec["order_id"] == order_id:
                        rec["status"] = "cancelled"
                        break
                logger.debug("Order cancelled: %s", order_id)
                return True
        return False

    # ------------------------------------------------------------------
    # Position & portfolio queries
    # ------------------------------------------------------------------

    def get_positions(self) -> list[PositionInfo]:
        """Return all open positions as PositionInfo instances."""
        positions = self._runner.portfolio.get_all_positions()
        current_prices = self._runner.data_handler.get_current_prices()

        result = []
        for pos in positions:
            symbol = pos["symbol"]
            current_price = current_prices.get(symbol, pos["avg_price"])
            qty = pos["quantity"]
            avg_price = pos["avg_price"]

            if pos["side"] == "LONG":
                unrealized = (current_price - avg_price) * qty
            else:
                unrealized = (avg_price - current_price) * qty

            pnl_pct = (unrealized / (avg_price * qty) * 100) if avg_price * qty != 0 else 0.0

            result.append(PositionInfo(
                symbol=symbol,
                exchange=pos["exchange"],
                side=pos["side"],
                quantity=qty,
                average_entry_price=avg_price,
                current_price=current_price,
                unrealized_pnl=round(unrealized, 2),
                pnl_percent=round(pnl_pct, 4),
            ))

        return result

    def get_position(self, symbol: str) -> PositionInfo | None:
        """Return the position for *symbol*, or ``None`` if flat."""
        pos = self._runner.portfolio.get_position(symbol)
        if pos is None:
            return None

        current_prices = self._runner.data_handler.get_current_prices()
        current_price = current_prices.get(symbol, pos["avg_price"])
        qty = pos["quantity"]
        avg_price = pos["avg_price"]

        if pos["side"] == "LONG":
            unrealized = (current_price - avg_price) * qty
        else:
            unrealized = (avg_price - current_price) * qty

        pnl_pct = (unrealized / (avg_price * qty) * 100) if avg_price * qty != 0 else 0.0

        return PositionInfo(
            symbol=symbol,
            exchange=pos["exchange"],
            side=pos["side"],
            quantity=qty,
            average_entry_price=avg_price,
            current_price=current_price,
            unrealized_pnl=round(unrealized, 2),
            pnl_percent=round(pnl_pct, 4),
        )

    def get_portfolio_value(self) -> float:
        """Return total portfolio value (cash + positions at market)."""
        current_prices = self._runner.data_handler.get_current_prices()
        return self._runner.portfolio.get_portfolio_value(current_prices)

    def get_cash(self) -> float:
        """Return available cash balance."""
        return self._runner.portfolio.cash

    def get_open_orders(self) -> list:
        """Return currently pending orders."""
        return [
            {
                "order_id": o.order_id,
                "symbol": o.symbol,
                "exchange": o.exchange,
                "side": o.side,
                "quantity": o.quantity,
                "order_type": o.order_type,
                "price": o.price,
                "status": o.status,
            }
            for o in self._runner._order_queue
            if o.status == "pending"
        ]


# ======================================================================
# BacktestRunner -- main event loop
# ======================================================================

class BacktestRunner(BaseRunner):
    """
    Orchestrates a complete backtest run.

    Lifecycle:
        1. Construct with config dict.
        2. Call :meth:`run` with OHLCV data.
        3. Receive results dict.

    The runner is single-use: create a new instance for each backtest.

    Args:
        backtest_id: Unique identifier for this backtest run.
        strategy_code: Python source code of the strategy.
        config: Configuration dict with keys:
            - ``start_date``: Backtest start date (date or str).
            - ``end_date``: Backtest end date (date or str).
            - ``initial_capital``: Starting capital in INR.
            - ``timeframe``: Bar interval (``"1d"``, ``"5m"``, etc.).
            - ``instruments``: List of instrument dicts with ``symbol``
              and ``exchange`` keys.
            - ``parameters``: Strategy parameter dict to pass to on_init.
            - ``slippage_percent``: Optional, default 0.05.
            - ``fill_at``: Optional, ``"next_open"`` or ``"current_close"``.
    """

    def __init__(
        self,
        backtest_id: str,
        strategy_code: str,
        config: dict[str, Any],
        options_handler: Optional[Any] = None,
    ) -> None:
        self.backtest_id = backtest_id
        self._strategy_code = strategy_code
        self._config = config
        self._instruments = config.get("instruments", [])

        # Components
        self.data_handler: Optional[HistoricalDataHandler] = None
        self.execution_handler = SimulatedExecutionHandler(
            slippage_percent=config.get("slippage_percent", 0.05),
            fill_at=config.get("fill_at", "next_open"),
            commission_type=config.get("commission_type", "zerodha"),
            flat_commission=config.get("flat_commission", 0.0),
        )
        self.portfolio = Portfolio(float(config.get("initial_capital", 100000)))

        # Options handler (None when options_mode is off)
        self.options_handler = options_handler

        # Strategy
        self._strategy_instance: Any = None
        self._context: Optional[BacktestContext] = None

        # Order queue (populated by context.buy()/sell(), consumed by runner)
        self._order_queue: list[OrderEvent] = []

        # Pending orders that could not be filled and carry forward
        self._pending_orders: list[OrderEvent] = []

        # Structured logs collected during the run
        self._logs: list[dict] = []

    # ------------------------------------------------------------------
    # Structured logging helper
    # ------------------------------------------------------------------

    def _add_log(self, level: str, message: str, source: str = "system"):
        """Append a structured log entry."""
        ts = self.data_handler.current_timestamp if self.data_handler else datetime.now(timezone.utc)
        self._logs.append({
            "level": level,
            "source": source,
            "message": message,
            "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts),
        })

    # ------------------------------------------------------------------
    # BaseRunner interface (async wrappers)
    # ------------------------------------------------------------------

    async def initialize(
        self, strategy_code: str, params: dict, instruments: list
    ) -> None:
        """Initialize runner (used by base class interface)."""
        self._strategy_code = strategy_code
        self._config["parameters"] = params
        self._instruments = instruments

    async def on_market_data(self, data: dict) -> None:
        """Not used directly -- the run() loop drives iteration."""
        pass

    async def place_order(
        self,
        symbol: str,
        exchange: str,
        side: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float | None = None,
        product: str = "MIS",
    ) -> str:
        """Async wrapper -- delegates to context.buy()/sell()."""
        if side.upper() == "BUY":
            return self._context.buy(symbol, quantity, order_type, price, exchange, product)
        else:
            return self._context.sell(symbol, quantity, order_type, price, exchange, product)

    async def get_positions(self) -> list:
        return self.portfolio.get_all_positions()

    async def get_portfolio_value(self) -> float:
        prices = self.data_handler.get_current_prices() if self.data_handler else {}
        return self.portfolio.get_portfolio_value(prices)

    async def get_cash(self) -> float:
        return self.portfolio.cash

    async def shutdown(self) -> None:
        """Cleanup (no-op for backtesting)."""
        pass

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run(
        self,
        ohlcv_data: list,
        progress_callback: Optional[Callable[[int, int], Any]] = None,
    ) -> dict[str, Any]:
        """
        Execute the full backtest.

        Args:
            ohlcv_data: List of OHLCVData model instances (or dicts).
            progress_callback: Optional callable ``(current_bar, total_bars)``
                invoked periodically to report progress.  Can be sync or async.

        Returns:
            A results dict containing:
              - ``status``: ``"completed"`` or ``"failed"``
              - ``metrics``: Performance metrics dict
              - ``equity_curve``: List of equity snapshots
              - ``trades``: List of completed trade dicts
              - ``orders``: List of all order dicts
              - ``error``: Error message if failed (absent on success)
              - ``logs``: Strategy log messages
        """
        try:
            return await self._run_internal(ohlcv_data, progress_callback)
        except Exception as exc:
            logger.exception("Backtest %s failed: %s", self.backtest_id, exc)
            self._add_log("ERROR", f"Backtest failed: {type(exc).__name__}: {exc}", "runner")
            return {
                "status": "failed",
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
                "metrics": {},
                "equity_curve": self.portfolio.equity_curve,
                "trades": self.portfolio.trades,
                "orders": self.portfolio.orders,
                "logs": self._logs,
            }

    async def _run_internal(
        self,
        ohlcv_data: list,
        progress_callback: Optional[Callable] = None,
    ) -> dict[str, Any]:
        """Internal backtest loop (may raise)."""
        # ----------------------------------------------------------
        # 1. Load and compile the user strategy
        # ----------------------------------------------------------
        strategy_instance = self._load_strategy(self._strategy_code)
        self._strategy_instance = strategy_instance

        # ----------------------------------------------------------
        # 2. Initialize the data handler
        # ----------------------------------------------------------
        self.data_handler = HistoricalDataHandler(
            ohlcv_records=ohlcv_data,
            instruments=self._instruments,
            timeframe=self._config.get("timeframe", "1d"),
        )

        total_bars = self.data_handler.total_bars
        if total_bars == 0:
            self._add_log("WARNING", "No data available for the specified instruments and date range.", "runner")
            return {
                "status": "completed",
                "metrics": {},
                "equity_curve": [],
                "trades": [],
                "orders": [],
                "logs": self._logs,
                "warning": "No OHLCV data found",
            }

        # ----------------------------------------------------------
        # 3. Create the backtest context
        # ----------------------------------------------------------
        params = self._config.get("parameters", {})
        self._context = BacktestContext(runner=self, params=params)

        instruments_str = ", ".join(
            i.get("symbol", i) if isinstance(i, dict) else str(i) for i in self._instruments
        )
        self._add_log("INFO", f"Backtest started — {total_bars} bars, instruments: {instruments_str}, "
                       f"capital: {self._config.get('initial_capital', 100000)}, "
                       f"timeframe: {self._config.get('timeframe', '1d')}", "runner")

        if self.options_handler and self.options_handler.enabled:
            self._add_log("INFO", f"Options mode: BUY CE on long, BUY PE on short "
                          f"(underlying={self.options_handler.underlying_name}, "
                          f"expiry_type={self.options_handler.expiry_type}, "
                          f"strike_offset={self.options_handler.strike_offset}, "
                          f"lot_size={self.options_handler.lot_size})", "runner")

        # Capture log messages from the strategy (print() and ctx.log())
        log_handler = _ListLogHandler(self._logs, data_handler=self.data_handler)
        self._context._logger.addHandler(log_handler)
        self._context._logger.setLevel(logging.DEBUG)

        # ----------------------------------------------------------
        # 4. Call strategy.on_init()
        # ----------------------------------------------------------
        try:
            strategy_instance.on_init(self._context)
            self._add_log("INFO", "Strategy on_init() completed", "runner")
        except Exception as exc:
            self._add_log("ERROR", f"on_init() raised: {type(exc).__name__}: {exc}", "strategy")
            raise

        # ----------------------------------------------------------
        # 5. Main event loop: iterate over bars
        # ----------------------------------------------------------
        progress_interval = max(1, total_bars // 100)  # report ~100 times

        # Intraday EOD square-off config
        timeframe = self._config.get("timeframe", "1d")
        is_intraday_tf = timeframe not in ("1d", "1D", "day", "1w", "1W", "week")
        _last_eod_date = None  # track which day we already squared off

        # Parse EOD square-off time from parameters (default 15:10)
        eod_time_str = params.get("eod_square_off_time", "")
        if eod_time_str and is_intraday_tf:
            try:
                h, m = map(int, eod_time_str.split(":"))
                eod_time = (h, m)
            except (ValueError, AttributeError):
                eod_time = (15, 10)
            self._add_log("INFO", f"EOD square-off enabled at {eod_time_str}", "runner")
        elif is_intraday_tf:
            eod_time = None  # disabled when empty string
        else:
            eod_time = None

        # Parse time locks from parameters
        raw_time_locks = params.get("time_locks", [])
        time_locks: list[tuple[tuple[int, int], tuple[int, int]]] = []
        for lock in raw_time_locks:
            try:
                sh, sm = map(int, lock["start"].split(":"))
                eh, em = map(int, lock["end"].split(":"))
                time_locks.append(((sh, sm), (eh, em)))
            except (ValueError, KeyError, AttributeError):
                continue
        if time_locks and is_intraday_tf:
            locks_str = ", ".join(f"{l['start']}-{l['end']}" for l in raw_time_locks if "start" in l and "end" in l)
            self._add_log("INFO", f"Time locks active: {locks_str}", "runner")
        self._time_locks = time_locks if is_intraday_tf else []

        for bar_index, (timestamp, bar_data) in enumerate(self.data_handler):

            # 5a. Process pending orders from the *previous* bar
            #     (orders placed during previous on_data get filled now)
            self._process_pending_orders(bar_index)

            # 5a-ii. Intraday EOD square-off
            if eod_time and hasattr(timestamp, "hour"):
                ts_ist = _to_ist(timestamp)
                bar_time = (ts_ist.hour, ts_ist.minute)
                bar_date = ts_ist.date()
                if bar_time >= eod_time and bar_date != _last_eod_date:
                    if self.portfolio.positions:
                        prices = self.data_handler.get_current_prices()
                        closed = self.portfolio.close_all_positions(prices, timestamp)
                        _last_eod_date = bar_date
                        for pos in closed:
                            sym = pos.get("symbol", "?")
                            pnl = pos.get("pnl", 0)
                            self._add_log(
                                "INFO",
                                f"EOD square-off: closed {sym} at {eod_time_str or '15:10'} — P&L: {pnl:.2f}",
                                "runner",
                            )
                    else:
                        if bar_date != _last_eod_date:
                            _last_eod_date = bar_date
                    # Cancel any pending orders
                    if self._pending_orders:
                        self._add_log("INFO", f"EOD: cancelled {len(self._pending_orders)} pending order(s)", "runner")
                        self._pending_orders.clear()

            # 5b. Call strategy.on_data()
            try:
                strategy_instance.on_data(self._context)
            except Exception as exc:
                self._add_log(
                    "ERROR",
                    f"on_data raised at bar {bar_index} ({timestamp}): {type(exc).__name__}: {exc}",
                    "strategy",
                )
                logger.warning(
                    "Strategy on_data error at bar %d: %s", bar_index, exc,
                )
                # Continue -- don't abort the entire backtest for a single bar error

            # 5c. Move newly placed orders to pending queue for next-bar execution
            self._stage_new_orders()

            # 5d. Record equity curve point
            current_prices = self.data_handler.get_current_prices()
            self.portfolio.record_equity(timestamp, current_prices)

            # 5e. Progress callback
            if progress_callback and (bar_index % progress_interval == 0 or bar_index == total_bars - 1):
                result = progress_callback(bar_index + 1, total_bars)
                # Support async callbacks
                if hasattr(result, "__await__"):
                    await result

        # ----------------------------------------------------------
        # 6. Close all open positions at the end
        # ----------------------------------------------------------
        final_prices = self.data_handler.get_current_prices()
        final_ts = self.data_handler.current_timestamp or datetime.now(timezone.utc)
        closed = self.portfolio.close_all_positions(final_prices, final_ts)
        if closed:
            for pos in closed:
                symbol = pos.get("symbol", "?")
                pnl = pos.get("pnl", 0)
                self._add_log("INFO", f"Force-closed position {symbol} at end of backtest — P&L: {pnl:.2f}", "runner")
            logger.info(
                "Force-closed %d positions at end of backtest", len(closed),
            )

        # Final equity point after closing positions
        self.portfolio.record_equity(final_ts, final_prices)

        # ----------------------------------------------------------
        # 7. Call strategy.on_stop()
        # ----------------------------------------------------------
        try:
            strategy_instance.on_stop(self._context)
            self._add_log("INFO", "Strategy on_stop() completed", "runner")
        except Exception as exc:
            self._add_log("ERROR", f"on_stop raised: {type(exc).__name__}: {exc}", "strategy")

        # ----------------------------------------------------------
        # 8. Calculate metrics
        # ----------------------------------------------------------
        start_date = self._config.get("start_date", datetime.now(timezone.utc))
        end_date = self._config.get("end_date", datetime.now(timezone.utc))

        metrics = calculate_all_metrics(
            equity_curve=self.portfolio.equity_curve,
            trades=self.portfolio.trades,
            start_date=start_date,
            end_date=end_date,
        )

        # Summary log
        total_trades = metrics.get("total_trades", 0)
        total_ret = metrics.get("total_return", 0)
        sharpe = metrics.get("sharpe_ratio", 0)
        max_dd = metrics.get("max_drawdown", 0)
        self._add_log(
            "INFO",
            f"Backtest completed — {total_trades} trades, "
            f"return: {total_ret * 100:.2f}%, Sharpe: {sharpe:.2f}, "
            f"max DD: {max_dd * 100:.2f}%",
            "runner",
        )

        # Clean up log handler
        self._context._logger.removeHandler(log_handler)

        return {
            "status": "completed",
            "metrics": metrics,
            "equity_curve": self.portfolio.equity_curve,
            "drawdown_curve": metrics.get("drawdown_curve", []),
            "trades": self.portfolio.trades,
            "orders": self.portfolio.orders,
            "total_charges": round(self.portfolio.total_charges, 2),
            "final_capital": round(
                self.portfolio.get_portfolio_value(final_prices), 2,
            ),
            "logs": self._logs,
        }

    # ------------------------------------------------------------------
    # Strategy loading
    # ------------------------------------------------------------------

    def _load_strategy(self, code: str) -> Any:
        """
        Compile and instantiate the user strategy from source code.

        The code is executed in a restricted namespace that includes:
          - ``Strategy`` base class
          - ``TradingContext``
          - Common builtins (math, datetime, etc.)

        The *last* class found that extends ``Strategy`` is instantiated.
        """
        from app.sdk.strategy_base import Strategy

        # Build a safe namespace
        namespace: dict[str, Any] = {
            "Strategy": Strategy,
            "__builtins__": {
                # Required for class definitions
                "__build_class__": __builtins__["__build_class__"] if isinstance(__builtins__, dict) else __builtins__.__build_class__,
                # Allow safe built-ins
                "abs": abs,
                "all": all,
                "any": any,
                "bool": bool,
                "dict": dict,
                "enumerate": enumerate,
                "filter": filter,
                "float": float,
                "hasattr": hasattr,
                "int": int,
                "isinstance": isinstance,
                "len": len,
                "list": list,
                "map": map,
                "max": max,
                "min": min,
                "print": lambda *args, **kw: self._add_log(
                    "INFO", " ".join(str(a) for a in args), "strategy"
                ),
                "range": range,
                "reversed": reversed,
                "round": round,
                "set": set,
                "sorted": sorted,
                "str": str,
                "sum": sum,
                "tuple": tuple,
                "type": type,
                "zip": zip,
                "None": None,
                "True": True,
                "False": False,
                "Exception": Exception,
                "ValueError": ValueError,
                "TypeError": TypeError,
                "KeyError": KeyError,
                "IndexError": IndexError,
                "AttributeError": AttributeError,
                "ZeroDivisionError": ZeroDivisionError,
                "StopIteration": StopIteration,
                "property": property,
                "staticmethod": staticmethod,
                "classmethod": classmethod,
                "super": super,
                "getattr": getattr,
                "setattr": setattr,
                "delattr": delattr,
                "__name__": "__strategy__",
                "__import__": _safe_import,
            },
        }

        # Compile and execute
        compiled = compile(code, "<strategy>", "exec")
        exec(compiled, namespace)

        # Find the user's Strategy subclass
        strategy_cls = None
        for obj in namespace.values():
            if (
                isinstance(obj, type)
                and issubclass(obj, Strategy)
                and obj is not Strategy
            ):
                strategy_cls = obj

        if strategy_cls is None:
            raise ValueError(
                "No Strategy subclass found in the provided code. "
                "Your strategy must define a class that extends Strategy."
            )

        return strategy_cls()

    # ------------------------------------------------------------------
    # Order processing
    # ------------------------------------------------------------------

    def _stage_new_orders(self) -> None:
        """
        Move orders placed during the current ``on_data()`` call into the
        pending queue for execution on the next bar.
        """
        if self._order_queue:
            self._pending_orders.extend(self._order_queue)
            self._order_queue.clear()

    def _process_pending_orders(self, current_bar_index: int) -> None:
        """
        Attempt to fill all pending orders.

        For ``fill_at="next_open"``: orders placed on bar N are filled
        at bar N+1's open.  The ``current_bar_index`` here *is* bar N+1,
        so we pass it as the "next bar" to the execution handler.

        For ``fill_at="current_close"``: orders are filled at the bar on
        which they were placed, so by the time we reach here they need
        the *previous* bar as current and this bar as next -- but in
        practice, the execution handler already handled this.
        """
        if not self._pending_orders:
            return

        still_pending: list[OrderEvent] = []

        for order in self._pending_orders:
            if order.status != "pending":
                continue

            # Get the bar data needed for execution
            # For options orders, use options OHLCV; for regular, use data handler
            current_bar = None
            if self.options_handler and self.options_handler.enabled and order.exchange == "NFO":
                ts = self.data_handler.current_timestamp
                if ts:
                    current_bar = self.options_handler.get_option_bar(order.symbol, ts)
            if current_bar is None:
                current_bar = self.data_handler.get_current_bar(order.symbol)

            # For fill_at="next_open", the "current bar" for the execution
            # handler is the bar where the order was placed, and the "next bar"
            # is the bar we are on now.
            if self.execution_handler.fill_at == "next_open":
                # The order was placed on a previous bar; the current bar IS the next bar
                # We pass order_bar as current and this bar as next
                # But we don't have order_bar stored, so we use current as "next"
                fill = self.execution_handler.execute_order(
                    order=order,
                    current_bar=current_bar,  # acts as the bar before this one
                    next_bar=current_bar,      # this bar is "next" for the order
                )
            else:
                fill = self.execution_handler.execute_order(
                    order=order,
                    current_bar=current_bar,
                    next_bar=None,
                )

            if fill is not None:
                order.status = "completed"
                # Update order record
                for rec in self.portfolio.orders:
                    if rec["order_id"] == order.order_id:
                        rec["status"] = "completed"
                        rec["fill_price"] = fill.fill_price
                        rec["commission"] = fill.commission
                        break

                # Update portfolio
                completed_trade = self.portfolio.update_on_fill(fill)

                self._add_log(
                    "INFO",
                    f"Order filled: {fill.side} {fill.symbol} x{fill.quantity} @ {fill.fill_price:.2f} "
                    f"(commission: {fill.commission:.2f})",
                    "runner",
                )

                if completed_trade is not None:
                    pnl = completed_trade.get("pnl", 0)
                    net_pnl = completed_trade.get("net_pnl", 0)
                    self._add_log(
                        "INFO",
                        f"Trade closed: {fill.symbol} — P&L: {pnl:.2f}, Net P&L: {net_pnl:.2f}",
                        "runner",
                    )

                # Notify strategy of the fill
                if completed_trade is not None:
                    try:
                        filled_order = FilledOrder(
                            order_id=fill.order_id,
                            symbol=fill.symbol,
                            exchange=fill.exchange,
                            side=fill.side,
                            quantity=fill.quantity,
                            fill_price=fill.fill_price,
                            timestamp=fill.timestamp,
                        )
                        self._strategy_instance.on_order_fill(self._context, filled_order)
                    except Exception as exc:
                        self._add_log("ERROR", f"on_order_fill raised: {type(exc).__name__}: {exc}", "strategy")

                logger.debug(
                    "Filled %s %s x%d @ %.2f (commission=%.2f)",
                    fill.side, fill.symbol, fill.quantity,
                    fill.fill_price, fill.commission,
                )
            else:
                # Order not filled -- carry forward for limit/SL orders
                if order.order_type.upper() in ("LIMIT", "SL", "SL-M"):
                    still_pending.append(order)
                else:
                    # Market orders that couldn't fill (shouldn't happen normally)
                    order.status = "rejected"
                    for rec in self.portfolio.orders:
                        if rec["order_id"] == order.order_id:
                            rec["status"] = "rejected"
                            break
                    self._add_log("WARNING", f"Market order for {order.symbol} rejected — could not fill at bar {current_bar_index}", "runner")
                    logger.warning(
                        "Market order for %s could not be filled at bar %d",
                        order.symbol, current_bar_index,
                    )

        self._pending_orders = still_pending


# ======================================================================
# Helpers
# ======================================================================

def _to_ist(ts: datetime) -> datetime:
    """Convert a datetime to IST. If naive, assume UTC."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(IST)


def _safe_import(name: str, *args, **kwargs):
    """
    Restricted import function for user strategy code.

    Only allows importing a whitelist of safe modules.
    """
    allowed = {
        "math",
        "datetime",
        "collections",
        "itertools",
        "functools",
        "decimal",
        "statistics",
        "dataclasses",
        "typing",
        "enum",
        "copy",
        "json",
        "re",
    }

    # Allow importing numpy and pandas (needed for indicators)
    allowed.update({"numpy", "np", "pandas", "pd"})

    # Extract the top-level module name
    top_level = name.split(".")[0]

    if top_level not in allowed:
        raise ImportError(
            f"Importing '{name}' is not allowed in strategy code. "
            f"Allowed modules: {', '.join(sorted(allowed))}"
        )

    return __import__(name, *args, **kwargs)


class _ListLogHandler(logging.Handler):
    """A logging handler that appends structured log entries to a list."""

    def __init__(self, log_list: list[dict], data_handler=None) -> None:
        super().__init__()
        self._logs = log_list
        self._data_handler = data_handler

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            level_map = {logging.DEBUG: "INFO", logging.INFO: "INFO", logging.WARNING: "WARNING", logging.ERROR: "ERROR"}
            ts = (self._data_handler.current_timestamp
                  if self._data_handler and self._data_handler.current_timestamp
                  else datetime.now(timezone.utc))
            self._logs.append({
                "level": level_map.get(record.levelno, "INFO"),
                "source": "strategy",
                "message": msg,
                "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts),
            })
        except Exception:
            pass
