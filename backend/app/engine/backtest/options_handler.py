"""Options data handler for backtesting.

Pre-loads options instrument metadata and OHLCV data so that:
  1. Strategy code can query option chains via ctx helpers.
  2. The backtest runner can look up options OHLCV for fill simulation
     when the strategy places orders on NFO instruments.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional

from app.core.timezone import IST

logger = logging.getLogger(__name__)


def _to_ist(ts: datetime) -> datetime:
    from datetime import timezone
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(IST)


class OptionsHandler:
    """Manages pre-loaded options data during a backtest run.

    Stores instrument metadata and OHLCV data loaded at backtest start.
    Provides lookup methods used by:
      - BacktestContext SDK helpers (get_atm_strike, get_option_chain, etc.)
      - BacktestRunner fill simulation (get_option_bar for NFO orders)
    """

    def __init__(self) -> None:
        self.underlying_symbol: str = ""
        self.underlying_name: str = ""
        self.strike_step: float = 50.0

        # Maps: (expiry_date, strike, option_type) -> {tradingsymbol, instrument_token, lot_size}
        self._instrument_map: dict[tuple[date, float, str], dict] = {}
        # Maps: tradingsymbol -> DataFrame of OHLCV data
        self._options_ohlcv: dict[str, Any] = {}
        # Available expiry dates sorted
        self._expiry_dates: list[date] = []
        # Available strikes per expiry
        self._strikes_by_expiry: dict[date, list[float]] = {}

    def set_underlying(self, instruments: list, strike_step: float = 50.0):
        """Set the underlying instrument info from backtest config."""
        from app.services.options_service import underlying_name_from_symbol
        if instruments:
            inst = instruments[0]
            sym = inst if isinstance(inst, str) else inst.get("symbol", "")
            self.underlying_symbol = sym.split(":")[-1] if ":" in sym else sym
            self.underlying_name = underlying_name_from_symbol(self.underlying_symbol)
        self.strike_step = strike_step

    def load_instruments(self, instruments: list[dict]):
        """Load option instrument metadata for strike/expiry resolution.

        instruments: list of dicts with keys:
            tradingsymbol, strike, expiry, instrument_type, instrument_token, lot_size
        """
        expiry_set: set[date] = set()
        strikes_by_expiry: dict[date, set[float]] = {}

        for inst in instruments:
            exp = inst["expiry"]
            strike = float(inst["strike"])
            otype = inst["instrument_type"]  # "CE" or "PE"
            key = (exp, strike, otype)
            self._instrument_map[key] = {
                "tradingsymbol": inst["tradingsymbol"],
                "instrument_token": inst["instrument_token"],
                "lot_size": inst.get("lot_size", 25),
            }
            expiry_set.add(exp)
            strikes_by_expiry.setdefault(exp, set()).add(strike)

        self._expiry_dates = sorted(expiry_set)
        self._strikes_by_expiry = {
            exp: sorted(strikes) for exp, strikes in strikes_by_expiry.items()
        }

        logger.info(
            "OptionsHandler loaded: %d instruments, %d expiries, underlying=%s",
            len(self._instrument_map), len(self._expiry_dates), self.underlying_name,
        )

    def load_ohlcv(self, options_data: dict[str, Any]):
        """Load options OHLCV DataFrames.

        options_data: {tradingsymbol: DataFrame} where DataFrame has
        OHLCV columns indexed by timestamp.
        """
        self._options_ohlcv = options_data
        logger.info("OptionsHandler loaded OHLCV for %d option symbols", len(options_data))

    def get_active_expiry(self, bar_date: date) -> Optional[date]:
        """Find the nearest expiry that is >= bar_date."""
        for exp in self._expiry_dates:
            if exp >= bar_date:
                return exp
        return None

    def get_option_chain(self, expiry: Optional[date] = None, bar_date: Optional[date] = None) -> list[dict]:
        """Return all available option instruments for a given expiry.

        If expiry is None, uses the nearest active expiry for bar_date.
        Returns list of dicts with: tradingsymbol, strike, option_type, expiry, lot_size.
        """
        if expiry is None and bar_date is not None:
            expiry = self.get_active_expiry(bar_date)
        if expiry is None:
            return []

        result = []
        for (exp, strike, otype), inst in self._instrument_map.items():
            if exp == expiry:
                result.append({
                    "tradingsymbol": inst["tradingsymbol"],
                    "strike": strike,
                    "option_type": otype,
                    "expiry": exp,
                    "lot_size": inst.get("lot_size", 25),
                    "instrument_token": inst["instrument_token"],
                })
        return sorted(result, key=lambda x: (x["strike"], x["option_type"]))

    def get_option_bar(self, tradingsymbol: str, bar_timestamp: datetime) -> Optional[dict]:
        """Get full OHLCV bar for an option at a given timestamp."""
        df = self._options_ohlcv.get(tradingsymbol)
        if df is None or df.empty:
            return None

        if bar_timestamp in df.index:
            row = df.loc[bar_timestamp]
            return {
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": int(row["volume"]),
                "timestamp": bar_timestamp,
            }

        # Look for the nearest bar before this timestamp, but only within
        # a reasonable window (30 min).  Returning a bar from hours or days
        # ago would produce wildly incorrect fill prices.
        mask = df.index <= bar_timestamp
        if mask.any():
            nearest = df.index[mask][-1]
            gap = bar_timestamp - nearest
            if gap > timedelta(minutes=30):
                logger.warning(
                    "get_option_bar(%s, %s): nearest bar is %s (gap=%s), too stale — skipping",
                    tradingsymbol, bar_timestamp, nearest, gap,
                )
                return None
            row = df.loc[nearest]
            return {
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": int(row["volume"]),
                "timestamp": nearest,
            }

        return None
