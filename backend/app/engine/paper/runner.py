"""Paper trading runner — runs strategy code against live market data."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from app.engine.common.base_runner import BaseRunner
from app.engine.common.events import OrderEvent, FillEvent
from app.engine.paper.simulated_broker import SimulatedBroker
from app.engine.backtest.portfolio import Portfolio
from app.sdk.context import TradingContext
from app.sdk.types import FilledOrder, PositionInfo
from app.services.notification_service import fire_notification
from app.schemas.notifications import NotificationEventType
from app.services.session_logger import SessionLogger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bar-aggregation helpers
# ---------------------------------------------------------------------------

IST = timezone(timedelta(hours=5, minutes=30))

TIMEFRAME_SECONDS: dict[str, int] = {
    "1m": 60, "3m": 180, "5m": 300, "10m": 600,
    "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400,
}


def _bar_start_time(dt: datetime, tf_seconds: int) -> datetime:
    """Return the start of the bar period that contains *dt*, aligned to IST."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ist = dt.astimezone(IST)
    if tf_seconds >= 86400:
        return ist.replace(hour=0, minute=0, second=0, microsecond=0)
    midnight = ist.replace(hour=0, minute=0, second=0, microsecond=0)
    secs = int((ist - midnight).total_seconds())
    aligned = (secs // tf_seconds) * tf_seconds
    return midnight + timedelta(seconds=aligned)


def _clean_symbol(s: str) -> str:
    """Strip exchange prefix: 'NSE:SBIN' -> 'SBIN'."""
    return s.split(":")[-1] if ":" in s else s


class PaperTradingContext(TradingContext):
    """TradingContext wired to PaperTradingRunner for live simulated trading."""

    def __init__(self, runner: "PaperTradingRunner", params: dict[str, Any] | None = None):
        super().__init__(params=params)
        self._runner = runner

    def _primary_symbol(self) -> str:
        """Resolve the primary instrument symbol (clean, no exchange prefix)."""
        if self._runner._instruments:
            inst = self._runner._instruments[0]
            raw = inst if isinstance(inst, str) else inst.get("symbol", "")
            return _clean_symbol(raw)
        return ""

    def get_historical_data(self, symbol: str, exchange: str = "NSE", periods: int = 100, interval: str = "1d"):
        return self._runner.get_cached_history(_clean_symbol(symbol), periods)

    def get_current_price(self, symbol: str, exchange: str = "NSE") -> float:
        sym = _clean_symbol(symbol)
        price = self._runner.broker.get_price(sym)
        if price is None:
            raise ValueError(f"No live price available for {sym}")
        return price

    def get_current_bar(self, symbol: str | None = None) -> dict:
        sym = _clean_symbol(symbol) if symbol else self._primary_symbol()
        if not sym:
            return {}
        now = datetime.now(IST)
        # Return the real aggregated in-progress bar
        bar = self._runner._current_bars.get(sym)
        if bar:
            return {
                "open": bar["open"],
                "high": bar["high"],
                "low": bar["low"],
                "close": bar["close"],
                "volume": bar["volume"],
                "timestamp": bar.get("bar_start", now),
            }
        # Fallback: no bar yet, use LTP
        price = self._runner.broker.get_price(sym)
        return {
            "open": price or 0,
            "high": price or 0,
            "low": price or 0,
            "close": price or 0,
            "volume": 0,
            "timestamp": now,
        }

    def log(self, message: str) -> None:
        """Override to route strategy logs through the SessionLogger."""
        self._logger.info(message)
        if self._runner.slog:
            self._runner.slog.info(message, source="strategy")

    def _is_time_locked(self) -> bool:
        """Check if the current time falls within any time lock window."""
        locks = getattr(self._runner, "_time_locks", [])
        if not locks:
            return False
        now = datetime.now(IST)
        bar_time = (now.hour, now.minute)
        for (sh, sm), (eh, em) in locks:
            if (sh, sm) <= bar_time < (eh, em):
                return True
        return False

    def buy(self, symbol: str, quantity: int, order_type: str = "MARKET", price: float | None = None, exchange: str = "NSE", product: str = "MIS") -> str:
        if self._is_time_locked():
            now = datetime.now(IST)
            if self._runner.slog:
                self._runner.slog.warning(f"BUY {symbol} blocked — time lock active at {now.strftime('%H:%M')}", source="runner")
            return ""

        order_id = f"PT-{uuid.uuid4().hex[:8]}"
        order = OrderEvent(
            timestamp=datetime.now(timezone.utc),
            symbol=symbol,
            exchange=exchange,
            side="BUY",
            quantity=quantity,
            order_type=order_type.upper(),
            order_id=order_id,
            price=price,
            trigger_price=price if order_type.upper() in ("SL", "SL-M") else None,
            product=product,
            status="pending",
        )
        self._runner._order_queue.append(order)
        if self._runner.slog:
            self._runner.slog.info(f"BUY order queued: {symbol} x{quantity} @ {price or 'MARKET'}", source="runner")
        return order_id

    def sell(self, symbol: str, quantity: int, order_type: str = "MARKET", price: float | None = None, exchange: str = "NSE", product: str = "MIS") -> str:
        if self._is_time_locked():
            now = datetime.now(IST)
            if self._runner.slog:
                self._runner.slog.warning(f"SELL {symbol} blocked — time lock active at {now.strftime('%H:%M')}", source="runner")
            return ""

        order_id = f"PT-{uuid.uuid4().hex[:8]}"
        order = OrderEvent(
            timestamp=datetime.now(timezone.utc),
            symbol=symbol,
            exchange=exchange,
            side="SELL",
            quantity=quantity,
            order_type=order_type.upper(),
            order_id=order_id,
            price=price,
            trigger_price=price if order_type.upper() in ("SL", "SL-M") else None,
            product=product,
            status="pending",
        )
        self._runner._order_queue.append(order)
        if self._runner.slog:
            self._runner.slog.info(f"SELL order queued: {symbol} x{quantity} @ {price or 'MARKET'}", source="runner")
        return order_id

    def cancel_order(self, order_id: str) -> bool:
        for i, order in enumerate(self._runner._order_queue):
            if order.order_id == order_id and order.status == "pending":
                self._runner._order_queue.pop(i)
                return True
        return False

    def get_positions(self) -> list[PositionInfo]:
        positions = self._runner.portfolio.get_all_positions()
        result = []
        for pos in positions:
            symbol = pos["symbol"]
            current_price = self._runner.broker.get_price(symbol) or pos["avg_price"]
            qty = pos["quantity"]
            avg_price = pos["avg_price"]
            if pos["side"] == "LONG":
                unrealized = (current_price - avg_price) * qty
            else:
                unrealized = (avg_price - current_price) * qty
            pnl_pct = (unrealized / (avg_price * qty) * 100) if avg_price * qty != 0 else 0.0
            result.append(PositionInfo(
                symbol=symbol, exchange=pos["exchange"], side=pos["side"],
                quantity=qty, average_entry_price=avg_price,
                current_price=current_price,
                unrealized_pnl=round(unrealized, 2),
                pnl_percent=round(pnl_pct, 4),
            ))
        return result

    def get_position(self, symbol: str) -> PositionInfo | None:
        positions = self.get_positions()
        return next((p for p in positions if p.symbol == symbol), None)

    def get_portfolio_value(self) -> float:
        prices = {s: self._runner.broker.get_price(s) or 0 for s in self._runner._tracked_symbols}
        return self._runner.portfolio.get_portfolio_value(prices)

    def get_cash(self) -> float:
        return self._runner.portfolio.cash

    def get_open_orders(self) -> list:
        return [
            {"order_id": o.order_id, "symbol": o.symbol, "side": o.side,
             "quantity": o.quantity, "order_type": o.order_type, "price": o.price}
            for o in self._runner._order_queue if o.status == "pending"
        ]


class PaperTradingRunner(BaseRunner):
    """
    Runs a user strategy against live market data with simulated execution.

    The runner:
    1. Loads and compiles the strategy code
    2. Subscribes to live ticks for the configured instruments
    3. Aggregates ticks into OHLCV bars based on the session timeframe
    4. On bar completion, calls strategy.on_data() with real bar data
    5. Fills orders at LTP through SimulatedBroker on every tick
    6. Emits position/P&L updates via callback
    """

    def __init__(self, session_id: str, strategy_code: str, config: dict[str, Any],
                 user_id=None, db_session_factory=None):
        self.session_id = session_id
        self._strategy_code = strategy_code
        self._config = config
        self._instruments = config.get("instruments", [])
        self._tracked_symbols: set[str] = set()

        self.broker = SimulatedBroker()
        self.portfolio = Portfolio(float(config.get("initial_capital", 100000)))

        self._strategy_instance: Any = None
        self._context: Optional[PaperTradingContext] = None
        self._order_queue: list[OrderEvent] = []
        self._historical_cache: dict[str, Any] = {}  # symbol -> DataFrame

        self._running = False
        self._paused = False
        self._tick_callback: Optional[Any] = None  # called after each tick processing
        self._logs: list[str] = []
        self._ticker: Optional[Any] = None
        self._user_id = user_id
        self._db_session_factory = db_session_factory
        self.slog = SessionLogger(session_id, db_session_factory)

        # Bar aggregation
        self._timeframe: str = config.get("timeframe", "5m")
        self._tf_seconds: int = TIMEFRAME_SECONDS.get(self._timeframe, 300)
        self._current_bars: dict[str, dict] = {}  # symbol -> {open,high,low,close,volume,bar_start}

        # EOD square-off + time locks from parameters
        params = config.get("parameters", {})
        eod_str = params.get("eod_square_off_time", "")
        if eod_str:
            try:
                h, m = map(int, eod_str.split(":"))
                self._eod_time: tuple[int, int] | None = (h, m)
            except (ValueError, AttributeError):
                self._eod_time = None
        else:
            self._eod_time = None
        self._eod_done_today: str | None = None  # date string of last EOD

        raw_locks = params.get("time_locks", [])
        self._time_locks: list[tuple[tuple[int, int], tuple[int, int]]] = []
        for lock in raw_locks:
            try:
                sh, sm = map(int, lock["start"].split(":"))
                eh, em = map(int, lock["end"].split(":"))
                self._time_locks.append(((sh, sm), (eh, em)))
            except (ValueError, KeyError, AttributeError):
                continue

    # BaseRunner interface
    async def initialize(self, strategy_code: str, params: dict, instruments: list) -> None:
        self._strategy_code = strategy_code
        self._config["parameters"] = params
        self._instruments = instruments

    async def on_market_data(self, data: dict) -> None:
        """Called when new tick data arrives. data = {symbol: price, ...}"""
        if not self._running or self._paused:
            return

        # Update broker prices
        self.broker.update_prices(data)
        self._tracked_symbols.update(data.keys())
        logger.debug("Tick: %s", {k: round(v, 2) for k, v in data.items()})

        # --- Bar aggregation ---
        now = datetime.now(timezone.utc)
        bar_start = _bar_start_time(now, self._tf_seconds)
        bar_completed = False

        for symbol, price in data.items():
            cur = self._current_bars.get(symbol)
            if cur is None:
                # First tick for this symbol — start a new bar
                self._current_bars[symbol] = {
                    "open": price, "high": price, "low": price, "close": price,
                    "volume": 0, "bar_start": bar_start,
                }
            elif bar_start > cur["bar_start"]:
                # New bar period — finalize the previous bar
                self._finalize_bar(symbol, cur)
                bar_completed = True
                self._current_bars[symbol] = {
                    "open": price, "high": price, "low": price, "close": price,
                    "volume": 0, "bar_start": bar_start,
                }
            else:
                # Same bar — update high / low / close
                if price > cur["high"]:
                    cur["high"] = price
                if price < cur["low"]:
                    cur["low"] = price
                cur["close"] = price

        # EOD square-off check
        if self._eod_time:
            ist_now = datetime.now(IST)
            now_time = (ist_now.hour, ist_now.minute)
            today_str = ist_now.strftime("%Y-%m-%d")
            if now_time >= self._eod_time and self._eod_done_today != today_str:
                self._eod_done_today = today_str
                if self.portfolio.positions:
                    prices = {s: self.broker.get_price(s) or 0 for s in self._tracked_symbols}
                    closed = self.portfolio.close_all_positions(prices, ist_now)
                    for pos in closed:
                        sym = pos.get("symbol", "?")
                        pnl = pos.get("pnl", 0)
                        self.slog.info(f"EOD square-off: closed {sym} — P&L: {pnl:.2f}", source="runner")
                        if self._user_id:
                            fire_notification(self._user_id, NotificationEventType.POSITION_CLOSED, {
                                "symbol": sym, "side": pos.get("side", ""),
                                "pnl": pnl, "mode": "paper", "reason": "EOD square-off",
                            })
                    await self._persist_eod_trades(closed)
                if self._order_queue:
                    self.slog.info(f"EOD: cancelled {len(self._order_queue)} pending order(s)", source="runner")
                    self._order_queue.clear()

        # Try to fill pending orders on every tick
        await self._process_orders()

        # Call strategy only when a bar completes (matches backtest behaviour)
        if bar_completed and self._strategy_instance and self._context:
            logger.info("Bar completed — calling on_data (session=%s)", self.session_id)
            try:
                self._strategy_instance.on_data(self._context)
            except Exception as exc:
                self._logs.append(f"[ERROR] on_data: {type(exc).__name__}: {exc}")
                logger.warning("Paper strategy on_data error: %s", exc)
                self.slog.error(f"on_data error: {type(exc).__name__}: {exc}", source="runner")
                if self._user_id:
                    fire_notification(self._user_id, NotificationEventType.SESSION_CRASHED, {
                        "session_id": self.session_id,
                        "error": f"{type(exc).__name__}: {exc}",
                        "mode": "paper",
                    })

            # Process any new orders placed during on_data
            await self._process_orders()

        # Invoke update callback (for Socket.IO emission) on every tick
        if self._tick_callback:
            try:
                result = self._tick_callback(self)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

    def _finalize_bar(self, symbol: str, bar: dict):
        """Append a completed bar to the historical cache DataFrame."""
        import pandas as pd
        ts = bar["bar_start"]
        new_row = pd.DataFrame([{
            "open": bar["open"],
            "high": bar["high"],
            "low": bar["low"],
            "close": bar["close"],
            "volume": bar["volume"],
        }], index=[ts])
        new_row.index.name = "timestamp"
        df = self._historical_cache.get(symbol)
        if df is not None and len(df) > 0:
            self._historical_cache[symbol] = pd.concat([df, new_row])
        else:
            self._historical_cache[symbol] = new_row
        msg = f"Bar {symbol}: O={bar['open']:.2f} H={bar['high']:.2f} L={bar['low']:.2f} C={bar['close']:.2f}"
        logger.info(msg)
        self.slog.info(msg, source="runner")

    async def place_order(self, symbol: str, exchange: str, side: str, quantity: int,
                          order_type: str = "MARKET", price: float | None = None,
                          product: str = "MIS") -> str:
        if side.upper() == "BUY":
            return self._context.buy(symbol, quantity, order_type, price, exchange, product)
        return self._context.sell(symbol, quantity, order_type, price, exchange, product)

    async def get_positions(self) -> list:
        return self.portfolio.get_all_positions()

    async def get_portfolio_value(self) -> float:
        prices = {s: self.broker.get_price(s) or 0 for s in self._tracked_symbols}
        return self.portfolio.get_portfolio_value(prices)

    async def get_cash(self) -> float:
        return self.portfolio.cash

    async def shutdown(self) -> None:
        self._running = False
        self.slog.info("Session stopped", source="system")
        if self._ticker:
            try:
                self._ticker.stop()
            except Exception:
                pass
            self._ticker = None
        if self._strategy_instance and self._context:
            try:
                self._strategy_instance.on_stop(self._context)
            except Exception:
                pass

    # Main lifecycle
    async def start(self, tick_callback=None):
        """Start the paper trading session."""
        self._tick_callback = tick_callback

        # Load strategy using same sandbox as backtest runner
        from app.engine.backtest.runner import BacktestRunner
        temp_runner = BacktestRunner(self.session_id, self._strategy_code, self._config)
        self._strategy_instance = temp_runner._load_strategy(self._strategy_code)

        params = self._config.get("parameters", {})
        self._context = PaperTradingContext(runner=self, params=params)

        # Parse instrument symbols
        for inst in self._instruments:
            if isinstance(inst, str):
                symbol = inst.split(":")[-1] if ":" in inst else inst
            else:
                symbol = inst.get("symbol", "")
            if symbol:
                self._tracked_symbols.add(symbol)

        # Call on_init
        self._strategy_instance.on_init(self._context)
        self._running = True
        self.slog.info(
            f"Session started (mode=paper, timeframe={self._timeframe}, "
            f"instruments={list(self._tracked_symbols)}, "
            f"capital={self._config.get('initial_capital', 100000)})",
            source="system",
        )
        if self._eod_time:
            self.slog.info(f"EOD square-off enabled at {self._eod_time[0]:02d}:{self._eod_time[1]:02d}", source="system")
        if self._time_locks:
            locks_str = ", ".join(f"{s[0]:02d}:{s[1]:02d}-{e[0]:02d}:{e[1]:02d}" for (s, e) in self._time_locks)
            self.slog.info(f"Time locks active: {locks_str}", source="system")
        logger.info("Paper trading session %s started (timeframe=%s, tf_seconds=%d)",
                     self.session_id, self._timeframe, self._tf_seconds)

    def pause(self):
        self._paused = True
        self.slog.info("Session paused", source="system")
        logger.info("Paper trading session %s paused", self.session_id)

    def resume(self):
        self._paused = False
        self.slog.info("Session resumed", source="system")
        logger.info("Paper trading session %s resumed", self.session_id)

    def get_cached_history(self, symbol: str, periods: int):
        """Return cached historical data (populated externally before start)."""
        import pandas as pd
        df = self._historical_cache.get(symbol)
        if df is not None and len(df) > 0:
            return df.tail(periods)
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    async def _process_orders(self):
        """Try to fill all pending orders."""
        still_pending = []
        for order in self._order_queue:
            if order.status != "pending":
                continue
            fill = self.broker.try_fill_order(order)
            if fill:
                order.status = "completed"
                completed_trade = self.portfolio.update_on_fill(fill)

                # Persist order to DB
                await self._persist_fill(order, fill)

                # Persist completed trade if a position was closed
                if completed_trade:
                    await self._persist_trade(completed_trade)

                # Fire notifications
                if self._user_id:
                    fire_notification(self._user_id, NotificationEventType.ORDER_FILLED, {
                        "symbol": fill.symbol, "side": fill.side,
                        "quantity": fill.quantity, "price": fill.fill_price,
                        "order_id": fill.order_id, "mode": "paper",
                    })
                    if order.order_type in ("SL", "SL-M"):
                        fire_notification(self._user_id, NotificationEventType.STOP_LOSS_TRIGGERED, {
                            "symbol": fill.symbol, "side": fill.side,
                            "quantity": fill.quantity, "price": fill.fill_price, "mode": "paper",
                        })
                    if completed_trade:
                        fire_notification(self._user_id, NotificationEventType.POSITION_CLOSED, {
                            "symbol": completed_trade["symbol"],
                            "side": completed_trade["side"],
                            "pnl": completed_trade.get("pnl"),
                            "entry_price": completed_trade.get("entry_price"),
                            "exit_price": completed_trade.get("exit_price"),
                            "mode": "paper",
                        })
                    else:
                        fire_notification(self._user_id, NotificationEventType.POSITION_OPENED, {
                            "symbol": fill.symbol, "side": fill.side,
                            "quantity": fill.quantity, "price": fill.fill_price, "mode": "paper",
                        })

                # Notify strategy
                if self._strategy_instance:
                    try:
                        filled_order = FilledOrder(
                            order_id=fill.order_id, symbol=fill.symbol,
                            exchange=fill.exchange, side=fill.side,
                            quantity=fill.quantity, fill_price=fill.fill_price,
                            timestamp=fill.timestamp,
                        )
                        self._strategy_instance.on_order_fill(self._context, filled_order)
                    except Exception as exc:
                        self._logs.append(f"[ERROR] on_order_fill: {exc}")
                        self.slog.error(f"on_order_fill error: {exc}", source="runner")
                fill_msg = f"FILLED: {fill.side} {fill.symbol} x{fill.quantity} @ {fill.fill_price:.2f}"
                logger.info("Paper %s", fill_msg)
                self.slog.info(fill_msg, source="runner")
            else:
                still_pending.append(order)
        self._order_queue = still_pending

    async def _persist_fill(self, order: OrderEvent, fill: FillEvent):
        """Persist a filled order to the database."""
        if not self._db_session_factory or not self._user_id:
            return
        try:
            from app.models.order import Order as OrderModel
            async with self._db_session_factory() as db:
                db_order = OrderModel(
                    user_id=self._user_id,
                    trading_session_id=uuid.UUID(self.session_id),
                    broker_order_id=fill.order_id,
                    tradingsymbol=fill.symbol,
                    exchange=fill.exchange,
                    transaction_type=fill.side,
                    order_type=order.order_type,
                    product=order.product,
                    quantity=fill.quantity,
                    price=order.price,
                    filled_quantity=fill.quantity,
                    average_price=fill.fill_price,
                    status="COMPLETE",
                    mode="paper",
                    placed_at=order.timestamp,
                    filled_at=fill.timestamp,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(db_order)
                await db.commit()
        except Exception as exc:
            logger.warning("Failed to persist paper order: %s", exc)

    async def _persist_trade(self, trade: dict):
        """Persist a completed trade to the database."""
        if not self._db_session_factory or not self._user_id:
            return
        try:
            from app.models.trade import Trade as TradeModel
            from dateutil.parser import parse as parse_dt

            entry_at = trade.get("entry_at")
            if isinstance(entry_at, str):
                entry_at = parse_dt(entry_at)
            exit_at = trade.get("exit_at")
            if isinstance(exit_at, str):
                exit_at = parse_dt(exit_at)

            async with self._db_session_factory() as db:
                db_trade = TradeModel(
                    user_id=self._user_id,
                    trading_session_id=uuid.UUID(self.session_id),
                    tradingsymbol=trade["symbol"],
                    exchange=trade.get("exchange", "NSE"),
                    side=trade["side"],
                    quantity=int(trade["quantity"]),
                    entry_price=float(trade["entry_price"]),
                    exit_price=float(trade["exit_price"]) if trade.get("exit_price") else None,
                    pnl=float(trade["pnl"]) if trade.get("pnl") is not None else None,
                    pnl_percent=float(trade["pnl_percent"]) if trade.get("pnl_percent") is not None else None,
                    charges=float(trade.get("charges", 0)),
                    net_pnl=float(trade["net_pnl"]) if trade.get("net_pnl") is not None else None,
                    mode="paper",
                    entry_at=entry_at,
                    exit_at=exit_at,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(db_trade)
                await db.commit()
        except Exception as exc:
            logger.warning("Failed to persist paper trade: %s", exc)

    async def _persist_eod_trades(self, closed_trades: list[dict]):
        """Persist EOD square-off trades to the database."""
        for trade in closed_trades:
            await self._persist_trade(trade)

    def get_state_snapshot(self) -> dict:
        """Return current state for Socket.IO emission."""
        prices = {s: self.broker.get_price(s) or 0 for s in self._tracked_symbols}
        positions = self._context.get_positions() if self._context else []
        return {
            "session_id": self.session_id,
            "status": "running" if self._running and not self._paused else ("paused" if self._paused else "stopped"),
            "portfolio_value": round(self.portfolio.get_portfolio_value(prices), 2),
            "cash": round(self.portfolio.cash, 2),
            "total_pnl": round(self.portfolio.get_portfolio_value(prices) - float(self._config.get("initial_capital", 100000)), 2),
            "positions": [
                {
                    "symbol": p.symbol, "exchange": p.exchange, "side": p.side,
                    "quantity": p.quantity, "avg_price": p.average_entry_price,
                    "current_price": p.current_price,
                    "unrealized_pnl": p.unrealized_pnl, "pnl_percent": p.pnl_percent,
                }
                for p in positions
            ],
            "open_orders": len(self._order_queue),
            "total_trades": len(self.portfolio.trades),
            "total_charges": round(self.portfolio.total_charges, 2),
            "prices": {s: prices.get(s, 0) for s in self._tracked_symbols},
        }
