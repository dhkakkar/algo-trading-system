"""
Historical data handler for backtesting.

Loads OHLCVData records into per-symbol pandas DataFrames and provides
bar-by-bar iteration plus look-back queries for indicator calculation.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Iterator

import pandas as pd

logger = logging.getLogger(__name__)


class HistoricalDataHandler:
    """
    Manages OHLCV data for the backtest engine.

    Responsibilities:
      - Convert raw OHLCVData model instances into per-symbol DataFrames.
      - Provide an iterator that yields ``(timestamp, bar_data_dict)`` tuples
        where ``bar_data_dict`` maps each symbol to its OHLCV bar.
      - Allow the runner to query historical bars up to the current position
        (look-ahead bias prevention).

    Args:
        ohlcv_records: List of OHLCVData model instances (or dicts with the
            same fields: ``tradingsymbol``, ``exchange``, ``time``, ``open``,
            ``high``, ``low``, ``close``, ``volume``).
        instruments: List of instrument dicts, each with at least
            ``{"symbol": ..., "exchange": ...}``.
        timeframe: Bar interval string (e.g. ``"1d"``, ``"5m"``).
    """

    def __init__(
        self,
        ohlcv_records: list,
        instruments: list[dict[str, str]],
        timeframe: str = "1d",
    ) -> None:
        self._instruments = instruments
        self._timeframe = timeframe
        self._current_index: int = -1  # not yet started

        # Per-symbol DataFrames keyed by (symbol, exchange)
        self._dataframes: dict[tuple[str, str], pd.DataFrame] = {}

        # Sorted list of all unique timestamps across all symbols
        self._timestamps: list[datetime] = []

        # Build internal data structures
        self._build_dataframes(ohlcv_records)

    # ------------------------------------------------------------------
    # Construction helpers
    # ------------------------------------------------------------------

    def _build_dataframes(self, records: list) -> None:
        """Parse OHLCVData records into per-symbol DataFrames."""
        # Collect rows per (symbol, exchange)
        grouped: dict[tuple[str, str], list[dict]] = {}
        all_timestamps: set[datetime] = set()

        for rec in records:
            # Support both ORM model instances and plain dicts
            if isinstance(rec, dict):
                symbol = rec["tradingsymbol"]
                exchange = rec["exchange"]
                row = {
                    "open": float(rec["open"]),
                    "high": float(rec["high"]),
                    "low": float(rec["low"]),
                    "close": float(rec["close"]),
                    "volume": int(rec["volume"]),
                    "timestamp": rec["time"],
                }
            else:
                symbol = rec.tradingsymbol
                exchange = rec.exchange
                row = {
                    "open": float(rec.open),
                    "high": float(rec.high),
                    "low": float(rec.low),
                    "close": float(rec.close),
                    "volume": int(rec.volume),
                    "timestamp": rec.time,
                }

            key = (symbol, exchange)
            grouped.setdefault(key, []).append(row)
            all_timestamps.add(row["timestamp"])

        # Build sorted DataFrames
        for key, rows in grouped.items():
            df = pd.DataFrame(rows)
            df = df.set_index("timestamp").sort_index()
            # Ensure consistent column order
            df = df[["open", "high", "low", "close", "volume"]]
            # Drop duplicate timestamps if any, keep last
            df = df[~df.index.duplicated(keep="last")]
            self._dataframes[key] = df

        # Sorted master timestamp list
        self._timestamps = sorted(all_timestamps)

        logger.info(
            "HistoricalDataHandler built: %d symbols, %d total bars",
            len(self._dataframes),
            len(self._timestamps),
        )

    # ------------------------------------------------------------------
    # Iteration
    # ------------------------------------------------------------------

    @property
    def total_bars(self) -> int:
        """Total number of time steps available."""
        return len(self._timestamps)

    @property
    def current_timestamp(self) -> datetime | None:
        """The timestamp at the current iteration index."""
        if 0 <= self._current_index < len(self._timestamps):
            return self._timestamps[self._current_index]
        return None

    def __iter__(self) -> Iterator[tuple[datetime, dict[str, dict]]]:
        """
        Yield ``(timestamp, data)`` for each bar in chronological order.

        ``data`` is a dict keyed by symbol (str) whose values are dicts::

            {"open": ..., "high": ..., "low": ..., "close": ..., "volume": ...}

        Only symbols that have data for this timestamp are included.
        """
        for idx in range(len(self._timestamps)):
            self._current_index = idx
            ts = self._timestamps[idx]
            bar_data: dict[str, dict] = {}
            for (symbol, exchange), df in self._dataframes.items():
                if ts in df.index:
                    row = df.loc[ts]
                    bar_data[symbol] = {
                        "open": float(row["open"]),
                        "high": float(row["high"]),
                        "low": float(row["low"]),
                        "close": float(row["close"]),
                        "volume": int(row["volume"]),
                        "timestamp": ts,
                        "exchange": exchange,
                    }
            if bar_data:
                yield ts, bar_data

    # ------------------------------------------------------------------
    # Look-back queries (no look-ahead bias)
    # ------------------------------------------------------------------

    def get_historical(self, symbol: str, periods: int = 100) -> pd.DataFrame:
        """
        Return up to the last *periods* bars for *symbol*, ending at the
        current bar (inclusive).  Prevents look-ahead bias by slicing up to
        ``current_index + 1``.

        Returns a DataFrame with columns ``[open, high, low, close, volume]``
        indexed by datetime.  Returns an empty DataFrame if the symbol is
        unknown or no data is available yet.
        """
        df = self._find_df(symbol)
        if df is None or self._current_index < 0:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

        current_ts = self._timestamps[self._current_index]

        # Slice up to and including the current timestamp
        historical = df.loc[df.index <= current_ts]

        # Return only the last N rows
        if len(historical) > periods:
            historical = historical.iloc[-periods:]

        return historical.copy()

    def get_current_bar(self, symbol: str | None = None) -> dict:
        """
        Return the current bar as a dict for *symbol*.

        If *symbol* is ``None``, returns the bar for the first instrument.
        Returns an empty dict if no data available.
        """
        if symbol is None:
            if self._instruments:
                symbol = self._instruments[0].get("symbol", "")
            else:
                return {}

        df = self._find_df(symbol)
        if df is None or self._current_index < 0:
            return {}

        current_ts = self._timestamps[self._current_index]
        if current_ts not in df.index:
            return {}

        row = df.loc[current_ts]
        exchange = self._find_exchange(symbol)
        return {
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": int(row["volume"]),
            "timestamp": current_ts,
            "exchange": exchange,
        }

    def get_current_price(self, symbol: str) -> float:
        """Return the close price of the current bar for *symbol*."""
        bar = self.get_current_bar(symbol)
        if not bar:
            raise ValueError(
                f"No current price available for {symbol} at index {self._current_index}"
            )
        return bar["close"]

    def get_current_prices(self) -> dict[str, float]:
        """Return ``{symbol: close_price}`` for all symbols at the current bar."""
        if self._current_index < 0:
            return {}

        current_ts = self._timestamps[self._current_index]
        prices: dict[str, float] = {}

        for (symbol, _exchange), df in self._dataframes.items():
            if current_ts in df.index:
                prices[symbol] = float(df.loc[current_ts, "close"])

        return prices

    def get_bar_at(self, symbol: str, index: int) -> dict | None:
        """
        Return the bar at absolute *index* for *symbol*.

        Used by the execution handler to look up the next bar for fill
        simulation.  Returns ``None`` if the index is out of range.
        """
        if index < 0 or index >= len(self._timestamps):
            return None

        df = self._find_df(symbol)
        if df is None:
            return None

        ts = self._timestamps[index]
        if ts not in df.index:
            return None

        row = df.loc[ts]
        exchange = self._find_exchange(symbol)
        return {
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": int(row["volume"]),
            "timestamp": ts,
            "exchange": exchange,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _find_df(self, symbol: str) -> pd.DataFrame | None:
        """Look up the DataFrame for *symbol* across all exchanges."""
        for (sym, _exch), df in self._dataframes.items():
            if sym == symbol:
                return df
        return None

    def _find_exchange(self, symbol: str) -> str:
        """Look up the exchange for *symbol*."""
        for sym, exch in self._dataframes.keys():
            if sym == symbol:
                return exch
        return "NSE"
