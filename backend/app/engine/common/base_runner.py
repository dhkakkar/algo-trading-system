"""
Abstract base class for all engine runners (backtest, paper-trade, live).

Every runner must implement these methods so that the TradingContext subclass
can delegate to them uniformly regardless of the execution mode.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class BaseRunner(ABC):
    """Interface contract that all engine runners must satisfy."""

    @abstractmethod
    async def initialize(
        self, strategy_code: str, params: dict, instruments: list
    ) -> None:
        """
        Set up the runner with strategy code, parameters, and the list of
        instruments to trade.
        """
        ...

    @abstractmethod
    async def on_market_data(self, data: dict) -> None:
        """
        Handle incoming market data.

        Args:
            data: Dict mapping symbol to bar dict
                  ``{symbol: {open, high, low, close, volume, timestamp}}``.
        """
        ...

    @abstractmethod
    async def place_order(
        self,
        symbol: str,
        exchange: str,
        side: str,
        quantity: int,
        order_type: str = "MARKET",
        price: Optional[float] = None,
        product: str = "MIS",
    ) -> str:
        """
        Place an order and return an order-id string.
        """
        ...

    @abstractmethod
    async def get_positions(self) -> list:
        """Return all current open positions."""
        ...

    @abstractmethod
    async def get_portfolio_value(self) -> float:
        """Return total portfolio value (cash + open positions at market)."""
        ...

    @abstractmethod
    async def get_cash(self) -> float:
        """Return available cash balance."""
        ...

    @abstractmethod
    async def shutdown(self) -> None:
        """Graceful shutdown -- close connections, flush state, etc."""
        ...
