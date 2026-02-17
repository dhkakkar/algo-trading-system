import logging
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.market_data import InstrumentResponse, OHLCVResponse
from app.services import market_data_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market-data", tags=["Market Data"])


@router.get("/instruments", response_model=list[InstrumentResponse])
async def search_instruments(
    query: str = Query(..., min_length=1),
    exchange: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    instruments = await market_data_service.search_instruments(db, query, exchange)
    return instruments


@router.get("/instruments/{instrument_token}", response_model=InstrumentResponse)
async def get_instrument(
    instrument_token: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    instrument = await market_data_service.get_instrument(db, instrument_token)
    return instrument


@router.get("/ohlcv", response_model=list[OHLCVResponse])
async def get_ohlcv(
    symbol: str = Query(...),
    exchange: str = Query(default="NSE"),
    from_date: date = Query(...),
    to_date: date = Query(...),
    interval: str = Query(default="1d"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Map our interval codes to Kite interval names
    kite_interval_map = {
        "1m": "minute", "3m": "3minute", "5m": "5minute",
        "10m": "10minute", "15m": "15minute", "30m": "30minute",
        "1h": "60minute", "1d": "day",
    }

    data = await market_data_service.get_ohlcv(
        db, symbol, exchange, from_date, to_date, interval
    )

    # Check if recent data is missing and auto-fetch from Kite
    today = date.today()
    is_intraday = interval != "1d"
    need_fetch = False
    fetch_from = from_date

    if data:
        last_time = data[-1].time
        last_date = last_time.date() if hasattr(last_time, 'date') else last_time
        gap_days = (today - last_date).days

        if gap_days >= 1:
            # Data is from a previous day — fetch from next day onward
            need_fetch = True
            fetch_from = last_date + timedelta(days=1)
        elif is_intraday:
            # Same day but intraday — re-fetch today if data is stale (>5 min old)
            now_utc = datetime.now(timezone.utc)
            if hasattr(last_time, 'tzinfo') and last_time.tzinfo:
                age_seconds = (now_utc - last_time).total_seconds()
            else:
                age_seconds = (now_utc - last_time.replace(tzinfo=timezone.utc)).total_seconds()
            if age_seconds > 300:  # more than 5 minutes old
                need_fetch = True
                fetch_from = today
    else:
        # No data at all — fetch the full range
        need_fetch = True
        fetch_from = from_date

    if need_fetch:
        kite_interval = kite_interval_map.get(interval)
        if kite_interval:
            try:
                from app.integrations.kite_connect.client import kite_manager
                kite_client = await kite_manager.get_client(db, str(current_user.id))
                if kite_client:
                    instrument = await market_data_service.find_instrument(
                        db, symbol, exchange
                    )
                    if instrument:
                        await market_data_service.fetch_and_store_from_kite(
                            db, kite_client, instrument.instrument_token,
                            symbol, exchange, fetch_from, today, kite_interval,
                        )
                        await db.commit()
                        # Re-query with fresh data
                        data = await market_data_service.get_ohlcv(
                            db, symbol, exchange, from_date, to_date, interval
                        )
            except Exception as e:
                logger.warning("Auto-fetch from Kite failed: %s", e)

    return data
