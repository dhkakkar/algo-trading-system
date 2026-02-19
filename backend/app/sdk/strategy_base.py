from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.sdk.context import TradingContext
    from app.sdk.types import FilledOrder


class Strategy:
    """
    Base class for all user-defined trading strategies.

    Users must extend this class and implement at least the on_data() method.

    Example:
        class MyStrategy(Strategy):
            def on_init(self, ctx):
                self.period = ctx.get_param("period", 20)

            def on_data(self, ctx):
                data = ctx.get_historical_data("RELIANCE", periods=self.period)
                sma = ctx.sma(data["close"], self.period)
                if ctx.crossover(data["close"], sma):
                    ctx.buy("RELIANCE", quantity=10)
    """

    def on_init(self, ctx: "TradingContext") -> None:
        """Called once when the strategy starts. Use for initialization."""
        pass

    def on_data(self, ctx: "TradingContext") -> None:
        """Called on each new bar/tick. Implement your strategy logic here."""
        raise NotImplementedError("You must implement on_data()")

    def on_order_fill(self, ctx: "TradingContext", order: "FilledOrder") -> None:
        """Called when an order is filled. Optional."""
        pass

    def on_order_reject(self, ctx: "TradingContext", order: "FilledOrder") -> None:
        """Called when an order is rejected (e.g. missing OHLCV data). Optional."""
        pass

    def on_tick(self, ctx: "TradingContext", symbol: str, price: float) -> None:
        """Called on every tick in paper/live trading. Optional.

        Use for tick-level logic such as breakout detection.  Not called
        during backtesting (only bar data is available there).
        """
        pass

    def on_stop(self, ctx: "TradingContext") -> None:
        """Called when the strategy stops. Use for cleanup. Optional."""
        pass
