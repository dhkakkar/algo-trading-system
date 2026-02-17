"""Options execution handler for backtesting.

Translates underlying instrument signals (buy/sell on NIFTY 50) into options
orders (buy ATM CE / buy ATM PE) and manages per-bar strike resolution using
pre-loaded options OHLCV data.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional

from app.core.timezone import IST

logger = logging.getLogger(__name__)


def _to_ist(ts: datetime) -> datetime:
    from datetime import timezone
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(IST)


class OptionsHandler:
    """Manages options resolution during a backtest run.

    When options_mode is enabled, buy/sell calls on the underlying are
    intercepted and translated:
      - buy("NIFTY 50", qty)  → buy ATM CE option at option price
      - sell("NIFTY 50", qty) → buy ATM PE option at option price

    The handler pre-loads options instrument mapping and OHLCV data so that
    during bar iteration, it can quickly resolve the correct option and price.
    """

    def __init__(self, config: dict[str, Any]):
        params = config.get("parameters", {})
        self.enabled = bool(params.get("options_mode", False))

        if not self.enabled:
            return

        self.underlying_symbol: str = ""  # Will be set from instruments
        self.underlying_name: str = ""    # e.g. "NIFTY"
        self.expiry_type: str = params.get("options_expiry_type", "weekly")
        self.strike_offset: int = int(params.get("options_strike_offset", 0))
        self.lot_size: int = int(params.get("options_lot_size", 25))
        self.strike_step: float = 50.0  # default NIFTY, updated at init

        # Pre-loaded data (populated by load_options_data)
        # Maps: (expiry_date, strike, option_type) -> {tradingsymbol, instrument_token}
        self._instrument_map: dict[tuple[date, float, str], dict] = {}
        # Maps: tradingsymbol -> DataFrame of OHLCV data
        self._options_ohlcv: dict[str, Any] = {}
        # Available expiry dates sorted
        self._expiry_dates: list[date] = []
        # Available strikes per expiry
        self._strikes_by_expiry: dict[date, list[float]] = {}

        # Current option positions being tracked
        # When we "buy CE" we track it here so we can "sell CE" to close
        self._held_option: Optional[dict] = None  # {tradingsymbol, side, qty, entry_price}

    def set_underlying(self, instruments: list, strike_step: float = 50.0):
        """Set the underlying instrument info from backtest config."""
        if not self.enabled:
            return
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
        if not self.enabled:
            return

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
                "lot_size": inst.get("lot_size", self.lot_size),
            }
            expiry_set.add(exp)
            strikes_by_expiry.setdefault(exp, set()).add(strike)

        self._expiry_dates = sorted(expiry_set)
        self._strikes_by_expiry = {
            exp: sorted(strikes) for exp, strikes in strikes_by_expiry.items()
        }

        if self._expiry_dates:
            self.lot_size = next(iter(self._instrument_map.values())).get("lot_size", self.lot_size)

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
        """Find the current active expiry for a given bar date.

        Returns the nearest expiry that is >= bar_date.
        """
        for exp in self._expiry_dates:
            if exp >= bar_date:
                return exp
        return None

    def resolve_option(
        self, spot_price: float, bar_timestamp: datetime, side: str
    ) -> Optional[dict]:
        """Resolve which option to trade given a signal.

        Args:
            spot_price: Current underlying price
            bar_timestamp: Current bar timestamp
            side: "BUY" (long signal → buy CE) or "SELL" (short signal → buy PE)

        Returns:
            dict with: tradingsymbol, option_type, strike, expiry, lot_size, option_price
            or None if unable to resolve
        """
        if not self.enabled:
            return None

        bar_date = _to_ist(bar_timestamp).date()
        expiry = self.get_active_expiry(bar_date)
        if not expiry:
            logger.warning("No active expiry found for date %s", bar_date)
            return None

        # Determine option type based on signal
        option_type = "CE" if side == "BUY" else "PE"

        # Calculate ATM strike with offset
        from app.services.options_service import get_atm_strike, offset_strike
        atm = get_atm_strike(spot_price, self.strike_step)
        target_strike = offset_strike(atm, self.strike_offset, self.strike_step)

        # Find nearest available strike
        available = self._strikes_by_expiry.get(expiry, [])
        if not available:
            logger.warning("No strikes available for expiry %s", expiry)
            return None

        # Snap to nearest available strike
        actual_strike = min(available, key=lambda s: abs(s - target_strike))

        # Look up the instrument
        key = (expiry, actual_strike, option_type)
        inst = self._instrument_map.get(key)
        if not inst:
            logger.warning("No instrument found for %s %s %s", expiry, actual_strike, option_type)
            return None

        # Get current option price from OHLCV
        tsymbol = inst["tradingsymbol"]
        option_price = self._get_option_price(tsymbol, bar_timestamp)
        if option_price is None:
            logger.warning("No option price for %s at %s", tsymbol, bar_timestamp)
            return None

        return {
            "tradingsymbol": tsymbol,
            "option_type": option_type,
            "strike": actual_strike,
            "expiry": expiry,
            "lot_size": inst.get("lot_size", self.lot_size),
            "option_price": option_price,
            "instrument_token": inst["instrument_token"],
        }

    def _get_option_price(self, tradingsymbol: str, bar_timestamp: datetime) -> Optional[float]:
        """Get the close price for an option at a given timestamp."""
        import pandas as pd

        df = self._options_ohlcv.get(tradingsymbol)
        if df is None or df.empty:
            return None

        # Find the closest bar at or before this timestamp
        if bar_timestamp in df.index:
            return float(df.loc[bar_timestamp, "close"])

        # Look for the nearest bar before this timestamp
        mask = df.index <= bar_timestamp
        if mask.any():
            nearest = df.index[mask][-1]
            return float(df.loc[nearest, "close"])

        return None

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
        return None
