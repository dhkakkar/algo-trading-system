"""Paper trading runner — runs strategy code against live market data."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.engine.common.base_runner import BaseRunner
from app.engine.common.events import OrderEvent, FillEvent
from app.engine.paper.simulated_broker import SimulatedBroker
from app.engine.backtest.portfolio import Portfolio
from app.sdk.context import TradingContext
from app.sdk.types import FilledOrder, PositionInfo

logger = logging.getLogger(__name__)


class PaperTradingContext(TradingContext):
    """TradingContext wired to PaperTradingRunner for live simulated trading."""

    def __init__(self, runner: "PaperTradingRunner", params: dict[str, Any] | None = None):
        super().__init__(params=params)
        self._runner = runner

    def get_historical_data(self, symbol: str, exchange: str = "NSE", periods: int = 100, interval: str = "1d"):
        # Return cached historical data from runner
        return self._runner.get_cached_history(symbol, periods)

    def get_current_price(self, symbol: str, exchange: str = "NSE") -> float:
        price = self._runner.broker.get_price(symbol)
        if price is None:
            raise ValueError(f"No live price available for {symbol}")
        return price

    def get_current_bar(self, symbol: str | None = None) -> dict:
        if symbol is None and self._runner._instruments:
            symbol = self._runner._instruments[0] if isinstance(self._runner._instruments[0], str) else self._runner._instruments[0].get("symbol", "")
        if not symbol:
            return {}
        price = self._runner.broker.get_price(symbol)
        return {
            "open": price or 0,
            "high": price or 0,
            "low": price or 0,
            "close": price or 0,
            "volume": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def buy(self, symbol: str, quantity: int, order_type: str = "MARKET", price: float | None = None, exchange: str = "NSE", product: str = "MIS") -> str:
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
        logger.info("Paper BUY queued: %s x%d @ %s", symbol, quantity, price or "MARKET")
        return order_id

    def sell(self, symbol: str, quantity: int, order_type: str = "MARKET", price: float | None = None, exchange: str = "NSE", product: str = "MIS") -> str:
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
        logger.info("Paper SELL queued: %s x%d @ %s", symbol, quantity, price or "MARKET")
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
    3. On each tick, calls strategy.on_data()
    4. Fills orders at LTP through SimulatedBroker
    5. Emits position/P&L updates via callback
    """

    def __init__(self, session_id: str, strategy_code: str, config: dict[str, Any]):
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

        # Try to fill pending orders
        self._process_orders()

        # Call strategy on_data
        if self._strategy_instance and self._context:
            try:
                self._strategy_instance.on_data(self._context)
            except Exception as exc:
                self._logs.append(f"[ERROR] on_data: {type(exc).__name__}: {exc}")
                logger.warning("Paper strategy on_data error: %s", exc)

        # Process any new orders placed during on_data
        self._process_orders()

        # Invoke update callback (for Socket.IO emission)
        if self._tick_callback:
            try:
                result = self._tick_callback(self)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

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
        logger.info("Paper trading session %s started", self.session_id)

    def pause(self):
        self._paused = True
        logger.info("Paper trading session %s paused", self.session_id)

    def resume(self):
        self._paused = False
        logger.info("Paper trading session %s resumed", self.session_id)

    def get_cached_history(self, symbol: str, periods: int):
        """Return cached historical data (populated externally before start)."""
        import pandas as pd
        df = self._historical_cache.get(symbol)
        if df is not None and len(df) > 0:
            return df.tail(periods)
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    def _process_orders(self):
        """Try to fill all pending orders."""
        still_pending = []
        for order in self._order_queue:
            if order.status != "pending":
                continue
            fill = self.broker.try_fill_order(order)
            if fill:
                order.status = "completed"
                self.portfolio.update_on_fill(fill)
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
                logger.info("Paper filled: %s %s x%d @ %.2f", fill.side, fill.symbol, fill.quantity, fill.fill_price)
            else:
                still_pending.append(order)
        self._order_queue = still_pending

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
