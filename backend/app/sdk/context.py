"""
TradingContext -- the primary interface provided to user strategies.

An instance of this class is passed to every Strategy callback (on_init,
on_data, on_order_fill, on_stop).  It provides access to market data, order
management, position tracking, portfolio info, and technical indicators.

Method bodies are intentionally left as ``raise NotImplementedError`` or
``pass`` stubs.  Concrete implementations will be supplied by the execution
engine (backtest, paper-trade, or live) in Phase 3, which will subclass
``TradingContext`` and wire up real data feeds and broker APIs.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from app.sdk import indicators as ind
from app.sdk.types import PositionInfo


class TradingContext:
    """
    The runtime context handed to a user strategy on every callback.

    Attributes:
        _params: Strategy parameters supplied at deployment / backtest time.
        _logger: Python logger used by :meth:`log`.
    """

    def __init__(
        self,
        params: dict[str, Any] | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._params: dict[str, Any] = params or {}
        self._logger: logging.Logger = logger or logging.getLogger("strategy")

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    def get_historical_data(
        self,
        symbol: str,
        exchange: str = "NSE",
        periods: int = 100,
        interval: str = "1d",
    ) -> pd.DataFrame:
        """
        Fetch historical OHLCV data for *symbol*.

        Args:
            symbol: Instrument symbol (e.g. ``"RELIANCE"``).
            exchange: Exchange segment (``"NSE"``, ``"BSE"``, ``"NFO"``).
            periods: Number of bars to return.
            interval: Bar interval -- ``"1m"``, ``"5m"``, ``"15m"``,
                      ``"1h"``, ``"1d"``, etc.

        Returns:
            DataFrame with columns ``["open", "high", "low", "close", "volume"]``
            indexed by datetime.
        """
        raise NotImplementedError(
            "get_historical_data() must be implemented by the execution engine"
        )

    def get_current_price(self, symbol: str, exchange: str = "NSE") -> float:
        """
        Return the latest traded price for *symbol*.

        Args:
            symbol: Instrument symbol.
            exchange: Exchange segment.

        Returns:
            Last traded price as a float.
        """
        raise NotImplementedError(
            "get_current_price() must be implemented by the execution engine"
        )

    def get_current_bar(self, symbol: str | None = None) -> dict:
        """
        Return the current (latest) OHLCV bar as a dict.

        If *symbol* is ``None`` the engine should return the bar for the
        strategy's primary symbol.

        Args:
            symbol: Optional symbol override.

        Returns:
            Dict with keys ``open, high, low, close, volume, timestamp``.
        """
        raise NotImplementedError(
            "get_current_bar() must be implemented by the execution engine"
        )

    # ------------------------------------------------------------------
    # Order management
    # ------------------------------------------------------------------

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
        Place a **buy** order.

        Args:
            symbol: Instrument symbol.
            quantity: Number of shares / lots.
            order_type: ``"MARKET"``, ``"LIMIT"``, ``"SL"``, or ``"SL-M"``.
            price: Limit / trigger price (required for non-MARKET orders).
            exchange: Exchange segment.
            product: Product type (``"CNC"``, ``"MIS"``, ``"NRML"``).

        Returns:
            A unique order-id string.
        """
        raise NotImplementedError(
            "buy() must be implemented by the execution engine"
        )

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
        Place a **sell** order.

        Args:
            symbol: Instrument symbol.
            quantity: Number of shares / lots.
            order_type: ``"MARKET"``, ``"LIMIT"``, ``"SL"``, or ``"SL-M"``.
            price: Limit / trigger price (required for non-MARKET orders).
            exchange: Exchange segment.
            product: Product type (``"CNC"``, ``"MIS"``, ``"NRML"``).

        Returns:
            A unique order-id string.
        """
        raise NotImplementedError(
            "sell() must be implemented by the execution engine"
        )

    def cancel_order(self, order_id: str) -> bool:
        """
        Cancel an open order.

        Args:
            order_id: The order-id returned by :meth:`buy` or :meth:`sell`.

        Returns:
            True if the cancellation was accepted; False otherwise.
        """
        raise NotImplementedError(
            "cancel_order() must be implemented by the execution engine"
        )

    # ------------------------------------------------------------------
    # Position & portfolio queries
    # ------------------------------------------------------------------

    def get_positions(self) -> list[PositionInfo]:
        """
        Return all current open positions.

        Returns:
            List of :class:`PositionInfo` dataclass instances.
        """
        raise NotImplementedError(
            "get_positions() must be implemented by the execution engine"
        )

    def get_position(self, symbol: str) -> PositionInfo | None:
        """
        Return the position for *symbol*, or ``None`` if flat.

        Args:
            symbol: Instrument symbol.

        Returns:
            A :class:`PositionInfo` instance or ``None``.
        """
        raise NotImplementedError(
            "get_position() must be implemented by the execution engine"
        )

    def get_portfolio_value(self) -> float:
        """
        Return the total portfolio value (cash + positions at market).

        Returns:
            Portfolio value as a float.
        """
        raise NotImplementedError(
            "get_portfolio_value() must be implemented by the execution engine"
        )

    def get_cash(self) -> float:
        """
        Return the available cash balance.

        Returns:
            Cash balance as a float.
        """
        raise NotImplementedError(
            "get_cash() must be implemented by the execution engine"
        )

    def get_open_orders(self) -> list:
        """
        Return a list of currently open (pending) orders.

        Returns:
            List of order dicts / objects.
        """
        raise NotImplementedError(
            "get_open_orders() must be implemented by the execution engine"
        )

    # ------------------------------------------------------------------
    # Options helpers
    # ------------------------------------------------------------------

    def get_atm_strike(self, underlying: str, spot_price: float) -> float:
        """
        Return the ATM (at-the-money) strike nearest to *spot_price*.

        Args:
            underlying: Underlying symbol (e.g. ``"NIFTY 50"``, ``"BANKNIFTY"``).
            spot_price: Current spot price of the underlying.

        Returns:
            The nearest ATM strike as a float.
        """
        raise NotImplementedError(
            "get_atm_strike() must be implemented by the execution engine"
        )

    def get_nearest_expiry(self, underlying: str, ref_date: Any = None) -> Any:
        """
        Return the nearest options expiry date on or after *ref_date*.

        Args:
            underlying: Underlying symbol (e.g. ``"NIFTY 50"``).
            ref_date: Reference date (defaults to the current bar date).

        Returns:
            A ``datetime.date`` or ``None`` if no expiry is found.
        """
        raise NotImplementedError(
            "get_nearest_expiry() must be implemented by the execution engine"
        )

    def get_option_chain(self, underlying: str, expiry: Any = None) -> list[dict]:
        """
        Return available option instruments for *underlying* at *expiry*.

        Args:
            underlying: Underlying symbol (e.g. ``"NIFTY 50"``).
            expiry: Expiry date (defaults to nearest active expiry).

        Returns:
            List of dicts with keys: ``tradingsymbol``, ``strike``,
            ``option_type`` (CE/PE), ``expiry``, ``lot_size``.
        """
        raise NotImplementedError(
            "get_option_chain() must be implemented by the execution engine"
        )

    def get_option_price(self, tradingsymbol: str) -> float | None:
        """Return the current close price of an option by trading symbol.

        Returns ``None`` if the data is not available.
        """
        raise NotImplementedError(
            "get_option_price() must be implemented by the execution engine"
        )

    def get_option_high(self, tradingsymbol: str) -> float | None:
        """Return the current bar's high price of an option.

        Useful for intra-bar stop-loss checks (worst case for option sellers).
        Returns ``None`` if the data is not available.  Falls back to
        :meth:`get_option_price` in engines that don't support bar OHLC.
        """
        return self.get_option_price(tradingsymbol)

    def get_bar_ist_time(self) -> tuple:
        """Return ``(hour, minute)`` of the current bar in IST.

        Useful for time-based logic in strategies trading on Indian markets.
        """
        raise NotImplementedError(
            "get_bar_ist_time() must be implemented by the execution engine"
        )

    # ------------------------------------------------------------------
    # Parameters & logging
    # ------------------------------------------------------------------

    def get_param(self, key: str, default: Any = None) -> Any:
        """
        Retrieve a strategy parameter by *key*.

        Parameters are supplied when deploying or back-testing a strategy
        (e.g. ``{"period": 20, "threshold": 0.05}``).

        Args:
            key: Parameter name.
            default: Value to return if *key* is not present.

        Returns:
            The parameter value, or *default*.
        """
        return self._params.get(key, default)

    def log(self, message: str) -> None:
        """
        Write a log message.

        Messages are recorded by the engine and can be displayed in the UI
        or written to a file.

        Args:
            message: Free-form log message.
        """
        self._logger.info(message)

    # ------------------------------------------------------------------
    # Technical indicator convenience wrappers
    # ------------------------------------------------------------------
    # These delegate to the pure functions in ``app.sdk.indicators`` so that
    # users can call ``ctx.sma(...)`` without importing the module themselves.

    @staticmethod
    def sma(data: pd.Series, period: int) -> pd.Series:
        """Simple Moving Average. See :func:`indicators.sma`."""
        return ind.sma(data, period)

    @staticmethod
    def ema(data: pd.Series, period: int) -> pd.Series:
        """Exponential Moving Average. See :func:`indicators.ema`."""
        return ind.ema(data, period)

    @staticmethod
    def rsi(data: pd.Series, period: int = 14) -> pd.Series:
        """Relative Strength Index. See :func:`indicators.rsi`."""
        return ind.rsi(data, period)

    @staticmethod
    def macd(
        data: pd.Series,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9,
    ) -> tuple[pd.Series, pd.Series, pd.Series]:
        """MACD. See :func:`indicators.macd`."""
        return ind.macd(data, fast, slow, signal)

    @staticmethod
    def bollinger_bands(
        data: pd.Series,
        period: int = 20,
        std_dev: float = 2.0,
    ) -> tuple[pd.Series, pd.Series, pd.Series]:
        """Bollinger Bands. See :func:`indicators.bollinger_bands`."""
        return ind.bollinger_bands(data, period, std_dev)

    @staticmethod
    def atr(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 14,
    ) -> pd.Series:
        """Average True Range. See :func:`indicators.atr`."""
        return ind.atr(high, low, close, period)

    @staticmethod
    def vwap(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        volume: pd.Series,
    ) -> pd.Series:
        """Volume Weighted Average Price. See :func:`indicators.vwap`."""
        return ind.vwap(high, low, close, volume)

    @staticmethod
    def supertrend(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 10,
        multiplier: float = 3.0,
    ) -> pd.Series:
        """SuperTrend indicator. See :func:`indicators.supertrend`."""
        return ind.supertrend(high, low, close, period, multiplier)

    @staticmethod
    def crossover(series_a: pd.Series, series_b: pd.Series) -> bool:
        """Check if *a* just crossed above *b*. See :func:`indicators.crossover`."""
        return ind.crossover(series_a, series_b)

    @staticmethod
    def crossunder(series_a: pd.Series, series_b: pd.Series) -> bool:
        """Check if *a* just crossed below *b*. See :func:`indicators.crossunder`."""
        return ind.crossunder(series_a, series_b)
