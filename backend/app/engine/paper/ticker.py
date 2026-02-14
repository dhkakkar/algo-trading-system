"""Kite WebSocket ticker wrapper for live market data streaming."""
import logging
import asyncio
from typing import Callable, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class KiteTicker:
    """
    Manages a Kite Connect WebSocket ticker for live market data.

    Wraps the kiteconnect.KiteTicker to provide:
    - Async-compatible tick callbacks
    - Auto-reconnect
    - Instrument token to symbol mapping
    """

    def __init__(self, api_key: str, access_token: str):
        self._api_key = api_key
        self._access_token = access_token
        self._ticker = None
        self._running = False
        self._subscribed_tokens: list[int] = []
        self._token_to_symbol: dict[int, str] = {}
        self._on_tick_callback: Optional[Callable] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_instruments(self, instruments: list[dict]):
        """
        Set instruments to subscribe to.
        Each dict should have 'instrument_token' and 'tradingsymbol'.
        """
        self._subscribed_tokens = []
        self._token_to_symbol = {}
        for inst in instruments:
            token = inst.get("instrument_token")
            symbol = inst.get("tradingsymbol", "")
            if token:
                self._subscribed_tokens.append(token)
                self._token_to_symbol[token] = symbol

    def on_tick(self, callback: Callable):
        """Register tick callback. Called with dict[symbol, price]."""
        self._on_tick_callback = callback

    def start(self, loop: Optional[asyncio.AbstractEventLoop] = None):
        """Start the ticker in the background."""
        try:
            from kiteconnect import KiteTicker as _KiteTicker
        except ImportError:
            logger.warning("kiteconnect not installed, using mock ticker")
            self._running = True
            return

        self._loop = loop or asyncio.get_event_loop()
        self._ticker = _KiteTicker(self._api_key, self._access_token)

        def _on_ticks(ws, ticks):
            prices = {}
            for tick in ticks:
                token = tick.get("instrument_token")
                symbol = self._token_to_symbol.get(token, str(token))
                ltp = tick.get("last_price", 0)
                prices[symbol] = ltp

            if self._on_tick_callback and prices:
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._invoke_callback(prices), self._loop
                    )

        def _on_connect(ws, response):
            logger.info("Kite ticker connected")
            if self._subscribed_tokens:
                ws.subscribe(self._subscribed_tokens)
                ws.set_mode(ws.MODE_LTP, self._subscribed_tokens)

        def _on_close(ws, code, reason):
            logger.info("Kite ticker closed: %s %s", code, reason)

        def _on_error(ws, code, reason):
            logger.error("Kite ticker error: %s %s", code, reason)

        self._ticker.on_ticks = _on_ticks
        self._ticker.on_connect = _on_connect
        self._ticker.on_close = _on_close
        self._ticker.on_error = _on_error

        self._running = True
        # Ticker runs in its own thread (kiteconnect uses threading internally)
        self._ticker.connect(threaded=True)

    async def _invoke_callback(self, prices: dict[str, float]):
        if self._on_tick_callback:
            result = self._on_tick_callback(prices)
            if asyncio.iscoroutine(result):
                await result

    def stop(self):
        """Stop the ticker."""
        self._running = False
        if self._ticker:
            try:
                self._ticker.close()
            except Exception:
                pass
        logger.info("Kite ticker stopped")

    @property
    def is_running(self) -> bool:
        return self._running
