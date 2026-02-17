"""Live trading runner — executes strategy with real orders via Kite Connect."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.engine.common.base_runner import BaseRunner
from app.engine.common.events import OrderEvent
from app.engine.live.risk_manager import RiskManager
from app.engine.live.kite_executor import KiteExecutor
from app.engine.paper.runner import PaperTradingContext
from app.engine.backtest.portfolio import Portfolio
from app.sdk.context import TradingContext
from app.sdk.types import FilledOrder, PositionInfo
from app.services.notification_service import fire_notification
from app.schemas.notifications import NotificationEventType
from app.services.session_logger import SessionLogger

logger = logging.getLogger(__name__)


class LiveTradingContext(TradingContext):
    """TradingContext for live trading — validates through risk manager before placing."""

    def __init__(self, runner: "LiveTradingRunner", params: dict[str, Any] | None = None):
        super().__init__(params=params)
        self._runner = runner

    def get_historical_data(self, symbol: str, exchange: str = "NSE", periods: int = 100, interval: str = "1d"):
        return self._runner.get_cached_history(symbol, periods)

    def get_current_price(self, symbol: str, exchange: str = "NSE") -> float:
        price = self._runner._current_prices.get(symbol)
        if price is None:
            raise ValueError(f"No live price available for {symbol}")
        return price

    def get_current_bar(self, symbol: str | None = None) -> dict:
        if symbol is None and self._runner._instruments:
            inst = self._runner._instruments[0]
            symbol = inst if isinstance(inst, str) else inst.get("symbol", "")
        if not symbol:
            return {}
        price = self._runner._current_prices.get(symbol, 0)
        return {
            "open": price, "high": price, "low": price, "close": price,
            "volume": 0, "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def log(self, message: str) -> None:
        """Override to route strategy logs through the SessionLogger."""
        self._logger.info(message)
        if self._runner.slog:
            self._runner.slog.info(message, source="strategy")

    def buy(self, symbol: str, quantity: int, order_type: str = "MARKET",
            price: float | None = None, exchange: str = "NSE", product: str = "MIS") -> str:
        # Risk check
        positions = self._runner.portfolio.get_all_positions()
        allowed, reason = self._runner.risk_manager.validate_order(
            symbol, "BUY", quantity, price or self._runner._current_prices.get(symbol),
            order_type, positions,
        )
        if not allowed:
            self._runner._logs.append(f"[RISK] BUY {symbol} x{quantity} REJECTED: {reason}")
            self._runner.slog.warning(f"RISK REJECTED: BUY {symbol} x{quantity} — {reason}", source="runner")
            return f"REJECTED-{reason[:20]}"

        # Place real order
        result = self._runner.executor.place_order(
            symbol=symbol, exchange=exchange, side="BUY",
            quantity=quantity, order_type=order_type, price=price, product=product,
        )

        order_id = result.get("order_id") or f"LIVE-{uuid.uuid4().hex[:8]}"
        if result.get("status") == "placed":
            self._runner._pending_broker_orders[order_id] = {
                "symbol": symbol, "exchange": exchange, "side": "BUY",
                "quantity": quantity, "order_type": order_type, "price": price,
            }
            self._runner.slog.info(f"BUY order placed: {symbol} x{quantity} @ {price or 'MARKET'} -> {order_id}", source="runner")
        else:
            self._runner._logs.append(f"[ERROR] BUY {symbol} failed: {result.get('error')}")
            self._runner.slog.error(f"BUY {symbol} x{quantity} FAILED: {result.get('error')}", source="runner")

        return order_id

    def sell(self, symbol: str, quantity: int, order_type: str = "MARKET",
             price: float | None = None, exchange: str = "NSE", product: str = "MIS") -> str:
        positions = self._runner.portfolio.get_all_positions()
        allowed, reason = self._runner.risk_manager.validate_order(
            symbol, "SELL", quantity, price or self._runner._current_prices.get(symbol),
            order_type, positions,
        )
        if not allowed:
            self._runner._logs.append(f"[RISK] SELL {symbol} x{quantity} REJECTED: {reason}")
            self._runner.slog.warning(f"RISK REJECTED: SELL {symbol} x{quantity} — {reason}", source="runner")
            return f"REJECTED-{reason[:20]}"

        result = self._runner.executor.place_order(
            symbol=symbol, exchange=exchange, side="SELL",
            quantity=quantity, order_type=order_type, price=price, product=product,
        )

        order_id = result.get("order_id") or f"LIVE-{uuid.uuid4().hex[:8]}"
        if result.get("status") == "placed":
            self._runner._pending_broker_orders[order_id] = {
                "symbol": symbol, "exchange": exchange, "side": "SELL",
                "quantity": quantity, "order_type": order_type, "price": price,
            }
            self._runner.slog.info(f"SELL order placed: {symbol} x{quantity} @ {price or 'MARKET'} -> {order_id}", source="runner")
        else:
            self._runner._logs.append(f"[ERROR] SELL {symbol} failed: {result.get('error')}")
            self._runner.slog.error(f"SELL {symbol} x{quantity} FAILED: {result.get('error')}", source="runner")

        return order_id

    def cancel_order(self, order_id: str) -> bool:
        result = self._runner.executor.cancel_order(order_id)
        return result.get("status") == "cancelled"

    def get_positions(self) -> list[PositionInfo]:
        positions = self._runner.portfolio.get_all_positions()
        result = []
        for pos in positions:
            symbol = pos["symbol"]
            current_price = self._runner._current_prices.get(symbol, pos["avg_price"])
            qty = pos["quantity"]
            avg_price = pos["avg_price"]
            unrealized = (current_price - avg_price) * qty if pos["side"] == "LONG" else (avg_price - current_price) * qty
            pnl_pct = (unrealized / (avg_price * qty) * 100) if avg_price * qty != 0 else 0.0
            result.append(PositionInfo(
                symbol=symbol, exchange=pos["exchange"], side=pos["side"],
                quantity=qty, average_entry_price=avg_price,
                current_price=current_price,
                unrealized_pnl=round(unrealized, 2), pnl_percent=round(pnl_pct, 4),
            ))
        return result

    def get_position(self, symbol: str) -> PositionInfo | None:
        return next((p for p in self.get_positions() if p.symbol == symbol), None)

    def get_portfolio_value(self) -> float:
        prices = self._runner._current_prices
        return self._runner.portfolio.get_portfolio_value(prices)

    def get_cash(self) -> float:
        return self._runner.portfolio.cash

    def get_open_orders(self) -> list:
        return [
            {"order_id": oid, **info}
            for oid, info in self._runner._pending_broker_orders.items()
        ]


class LiveTradingRunner(BaseRunner):
    """
    Runs a strategy with REAL order execution via Kite Connect.

    Lifecycle:
    1. Start with Kite client + strategy code
    2. Subscribe to live ticks
    3. On each tick: update prices, check order statuses, call strategy.on_data()
    4. All orders go through RiskManager before KiteExecutor
    """

    def __init__(self, session_id: str, strategy_code: str, config: dict[str, Any],
                 kite_client: Any, user_id=None, db_session_factory=None):
        self.session_id = session_id
        self._strategy_code = strategy_code
        self._config = config
        self._instruments = config.get("instruments", [])
        self._user_id = user_id

        self.executor = KiteExecutor(kite_client)
        self.risk_manager = RiskManager(config.get("risk_config", {}))
        self.portfolio = Portfolio(float(config.get("initial_capital", 100000)))

        self._strategy_instance: Any = None
        self._context: Optional[LiveTradingContext] = None
        self._current_prices: dict[str, float] = {}
        self._tracked_symbols: set[str] = set()
        self._pending_broker_orders: dict[str, dict] = {}  # broker_order_id -> order info
        self._historical_cache: dict[str, Any] = {}

        self._running = False
        self._paused = False
        self._tick_callback: Optional[Any] = None
        self._logs: list[str] = []
        self.slog = SessionLogger(session_id, db_session_factory)

    async def initialize(self, strategy_code: str, params: dict, instruments: list) -> None:
        self._strategy_code = strategy_code
        self._config["parameters"] = params
        self._instruments = instruments

    async def on_market_data(self, data: dict) -> None:
        if not self._running or self._paused:
            return

        self._current_prices.update(data)
        self._tracked_symbols.update(data.keys())

        # Check pending order statuses
        await self._check_order_statuses()

        # Call strategy
        if self._strategy_instance and self._context:
            try:
                self._strategy_instance.on_data(self._context)
            except Exception as exc:
                self._logs.append(f"[ERROR] on_data: {type(exc).__name__}: {exc}")
                logger.warning("Live strategy on_data error: %s", exc)
                self.slog.error(f"on_data error: {type(exc).__name__}: {exc}", source="runner")
                if self._user_id:
                    fire_notification(self._user_id, NotificationEventType.SESSION_CRASHED, {
                        "session_id": self.session_id,
                        "error": f"{type(exc).__name__}: {exc}",
                        "mode": "live",
                    })

        # Update risk manager
        self.risk_manager.update_position_count(len(self.portfolio.get_all_positions()))

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
        return self.portfolio.get_portfolio_value(self._current_prices)

    async def get_cash(self) -> float:
        return self.portfolio.cash

    async def shutdown(self) -> None:
        self._running = False
        self.slog.info("Session stopped", source="system")
        if self._strategy_instance and self._context:
            try:
                self._strategy_instance.on_stop(self._context)
            except Exception:
                pass

    async def start(self, tick_callback=None):
        self._tick_callback = tick_callback

        from app.engine.backtest.runner import BacktestRunner
        temp = BacktestRunner(self.session_id, self._strategy_code, self._config)
        self._strategy_instance = temp._load_strategy(self._strategy_code)

        params = self._config.get("parameters", {})
        self._context = LiveTradingContext(runner=self, params=params)

        for inst in self._instruments:
            symbol = inst.split(":")[-1] if isinstance(inst, str) and ":" in inst else (inst if isinstance(inst, str) else inst.get("symbol", ""))
            if symbol:
                self._tracked_symbols.add(symbol)

        self._strategy_instance.on_init(self._context)
        self._running = True
        self.risk_manager.reset_daily()
        self.slog.info(
            f"Session started (mode=live, instruments={list(self._tracked_symbols)}, "
            f"capital={self._config.get('initial_capital', 100000)})",
            source="system",
        )
        logger.info("Live trading session %s started", self.session_id)

    def pause(self):
        self._paused = True
        self.slog.info("Session paused", source="system")

    def resume(self):
        self._paused = False
        self.slog.info("Session resumed", source="system")

    async def square_off_all(self) -> list[dict]:
        """Emergency: close all positions via market orders."""
        results = self.executor.square_off_all()
        self._running = False
        logger.warning("Emergency square off executed for session %s", self.session_id)
        return results

    def get_cached_history(self, symbol: str, periods: int):
        import pandas as pd
        df = self._historical_cache.get(symbol)
        if df is not None and len(df) > 0:
            return df.tail(periods)
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    async def _check_order_statuses(self):
        """Poll Kite for pending order statuses and process fills."""
        completed_ids = []
        for order_id, info in self._pending_broker_orders.items():
            status = self.executor.get_order_status(order_id)
            if not status:
                continue

            kite_status = status.get("status", "").upper()
            if kite_status == "COMPLETE":
                from app.engine.common.events import FillEvent
                fill = FillEvent(
                    timestamp=datetime.now(timezone.utc),
                    symbol=info["symbol"],
                    exchange=info["exchange"],
                    side=info["side"],
                    quantity=status.get("filled_quantity", info["quantity"]),
                    fill_price=float(status.get("average_price", 0)),
                    commission=0,  # Kite charges separately
                    order_id=order_id,
                )
                completed_trade = self.portfolio.update_on_fill(fill)
                completed_ids.append(order_id)

                # Fire notifications
                if self._user_id:
                    fire_notification(self._user_id, NotificationEventType.ORDER_FILLED, {
                        "symbol": info["symbol"], "side": info["side"],
                        "quantity": fill.quantity, "price": fill.fill_price,
                        "order_id": order_id, "mode": "live",
                    })
                    if info.get("order_type", "").upper() in ("SL", "SL-M"):
                        fire_notification(self._user_id, NotificationEventType.STOP_LOSS_TRIGGERED, {
                            "symbol": info["symbol"], "side": info["side"],
                            "quantity": fill.quantity, "price": fill.fill_price, "mode": "live",
                        })
                    if completed_trade:
                        fire_notification(self._user_id, NotificationEventType.POSITION_CLOSED, {
                            "symbol": completed_trade["symbol"],
                            "side": completed_trade["side"],
                            "pnl": completed_trade.get("pnl"),
                            "entry_price": completed_trade.get("entry_price"),
                            "exit_price": completed_trade.get("exit_price"),
                            "mode": "live",
                        })
                    else:
                        fire_notification(self._user_id, NotificationEventType.POSITION_OPENED, {
                            "symbol": info["symbol"], "side": info["side"],
                            "quantity": fill.quantity, "price": fill.fill_price, "mode": "live",
                        })

                self.slog.info(
                    f"FILLED: {info['side']} {info['symbol']} x{fill.quantity} @ {fill.fill_price:.2f}",
                    source="runner",
                )
                if self._strategy_instance and self._context:
                    try:
                        filled = FilledOrder(
                            order_id=order_id, symbol=info["symbol"],
                            exchange=info["exchange"], side=info["side"],
                            quantity=fill.quantity, fill_price=fill.fill_price,
                            timestamp=fill.timestamp,
                        )
                        self._strategy_instance.on_order_fill(self._context, filled)
                    except Exception as exc:
                        self._logs.append(f"[ERROR] on_order_fill: {exc}")
                        self.slog.error(f"on_order_fill error: {exc}", source="runner")

            elif kite_status in ("REJECTED", "CANCELLED"):
                completed_ids.append(order_id)
                reject_msg = f"{info['side']} {info['symbol']} {kite_status}: {status.get('status_message', '')}"
                self._logs.append(f"[ORDER] {reject_msg}")
                self.slog.warning(f"ORDER {reject_msg}", source="runner")
                if self._user_id:
                    fire_notification(self._user_id, NotificationEventType.ORDER_REJECTED, {
                        "symbol": info["symbol"], "side": info["side"],
                        "quantity": info["quantity"],
                        "reason": status.get("status_message", kite_status),
                        "mode": "live",
                    })

        for oid in completed_ids:
            self._pending_broker_orders.pop(oid, None)

    def get_state_snapshot(self) -> dict:
        positions = self._context.get_positions() if self._context else []
        return {
            "session_id": self.session_id,
            "status": "running" if self._running and not self._paused else ("paused" if self._paused else "stopped"),
            "portfolio_value": round(self.portfolio.get_portfolio_value(self._current_prices), 2),
            "cash": round(self.portfolio.cash, 2),
            "total_pnl": round(self.portfolio.get_portfolio_value(self._current_prices) - float(self._config.get("initial_capital", 100000)), 2),
            "positions": [
                {"symbol": p.symbol, "exchange": p.exchange, "side": p.side,
                 "quantity": p.quantity, "avg_price": p.average_entry_price,
                 "current_price": p.current_price,
                 "unrealized_pnl": p.unrealized_pnl, "pnl_percent": p.pnl_percent}
                for p in positions
            ],
            "open_orders": len(self._pending_broker_orders),
            "total_trades": len(self.portfolio.trades),
            "total_charges": round(self.portfolio.total_charges, 2),
            "prices": dict(self._current_prices),
        }
