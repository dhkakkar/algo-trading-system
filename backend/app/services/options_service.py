"""Options chain resolution and strike selection for options trading."""

import logging
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument

logger = logging.getLogger(__name__)

# NIFTY strike interval is 50 points
NIFTY_STRIKE_STEP = 50
BANKNIFTY_STRIKE_STEP = 100


def get_atm_strike(spot_price: float, step: float = NIFTY_STRIKE_STEP) -> float:
    """Return the ATM strike nearest to the spot price."""
    return round(spot_price / step) * step


def offset_strike(atm_strike: float, offset: int, step: float = NIFTY_STRIKE_STEP) -> float:
    """Apply strike offset: 0=ATM, +1=one step OTM, -1=one step ITM."""
    return atm_strike + (offset * step)


async def get_nearest_expiry(
    db: AsyncSession,
    underlying_name: str,
    ref_date: date,
    expiry_type: str = "weekly",
) -> Optional[date]:
    """Find the nearest expiry on or after ref_date for the given underlying.

    expiry_type: "weekly" or "monthly"
    For weekly expiries, we pick the nearest Thursday >= ref_date.
    For monthly, we pick the last Thursday of the month.
    """
    stmt = (
        select(Instrument.expiry)
        .where(
            and_(
                Instrument.name == underlying_name.upper(),
                Instrument.exchange == "NFO",
                Instrument.instrument_type.in_(["CE", "PE"]),
                Instrument.expiry >= ref_date,
            )
        )
        .distinct()
        .order_by(Instrument.expiry.asc())
    )
    result = await db.execute(stmt)
    expiries = [row[0] for row in result.fetchall()]

    if not expiries:
        return None

    if expiry_type == "monthly":
        # Monthly expiry = last expiry in a given month
        # Group by month and pick the last one that's >= ref_date
        month_expiries: dict[tuple[int, int], date] = {}
        for exp in expiries:
            key = (exp.year, exp.month)
            month_expiries[key] = exp  # last one wins since sorted asc
        monthly_dates = sorted(month_expiries.values())
        return monthly_dates[0] if monthly_dates else None

    # Weekly: just return the nearest expiry
    return expiries[0]


async def resolve_option_instrument(
    db: AsyncSession,
    underlying_name: str,
    strike: float,
    option_type: str,  # "CE" or "PE"
    expiry: date,
) -> Optional[Instrument]:
    """Look up the exact NFO instrument for a given strike/type/expiry."""
    result = await db.execute(
        select(Instrument).where(
            and_(
                Instrument.name == underlying_name.upper(),
                Instrument.exchange == "NFO",
                Instrument.instrument_type == option_type.upper(),
                Instrument.strike == strike,
                Instrument.expiry == expiry,
            )
        )
    )
    return result.scalar_one_or_none()


async def get_available_strikes(
    db: AsyncSession,
    underlying_name: str,
    expiry: date,
    option_type: str = "CE",
) -> list[float]:
    """Return all available strikes for a given underlying/expiry/type."""
    result = await db.execute(
        select(Instrument.strike)
        .where(
            and_(
                Instrument.name == underlying_name.upper(),
                Instrument.exchange == "NFO",
                Instrument.instrument_type == option_type.upper(),
                Instrument.expiry == expiry,
                Instrument.strike.isnot(None),
            )
        )
        .order_by(Instrument.strike.asc())
    )
    return [float(row[0]) for row in result.fetchall()]


def underlying_name_from_symbol(symbol: str) -> str:
    """Extract the underlying name for options queries.

    'NIFTY 50' -> 'NIFTY'
    'NIFTY' -> 'NIFTY'
    'BANKNIFTY' -> 'BANKNIFTY'
    """
    s = symbol.upper().strip()
    if s == "NIFTY 50":
        return "NIFTY"
    return s.split()[0]


def strike_step_for_underlying(underlying_name: str) -> float:
    """Return the strike step size for a given underlying."""
    name = underlying_name.upper()
    if name == "BANKNIFTY":
        return BANKNIFTY_STRIKE_STEP
    return NIFTY_STRIKE_STEP
