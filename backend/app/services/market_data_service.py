import logging
from datetime import date, datetime, timezone
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.market_data import OHLCVData
from app.models.instrument import Instrument
from app.exceptions import NotFoundException

logger = logging.getLogger(__name__)


async def search_instruments(
    db: AsyncSession, query: str, exchange: str | None = None
) -> list[Instrument]:
    stmt = select(Instrument).where(
        or_(
            Instrument.tradingsymbol.ilike(f"%{query}%"),
            Instrument.name.ilike(f"%{query}%"),
        )
    )
    if exchange:
        stmt = stmt.where(Instrument.exchange == exchange.upper())
    stmt = stmt.limit(50)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_instrument(db: AsyncSession, instrument_token: int) -> Instrument:
    result = await db.execute(
        select(Instrument).where(Instrument.instrument_token == instrument_token)
    )
    instrument = result.scalar_one_or_none()
    if not instrument:
        raise NotFoundException("Instrument not found")
    return instrument


async def get_ohlcv(
    db: AsyncSession,
    symbol: str,
    exchange: str,
    from_date: date,
    to_date: date,
    interval: str = "1d",
) -> list[OHLCVData]:
    result = await db.execute(
        select(OHLCVData)
        .where(
            and_(
                OHLCVData.tradingsymbol == symbol.upper(),
                OHLCVData.exchange == exchange.upper(),
                OHLCVData.interval == interval,
                OHLCVData.time >= datetime.combine(from_date, datetime.min.time()).replace(tzinfo=timezone.utc),
                OHLCVData.time <= datetime.combine(to_date, datetime.max.time()).replace(tzinfo=timezone.utc),
            )
        )
        .order_by(OHLCVData.time.asc())
    )
    return list(result.scalars().all())


async def store_ohlcv(
    db: AsyncSession,
    records: list[dict],
    symbol: str,
    exchange: str,
    instrument_token: int,
    interval: str,
) -> int:
    """Store OHLCV records fetched from Kite. Uses upsert to handle duplicates."""
    from sqlalchemy.dialects.postgresql import insert

    if not records:
        return 0

    BATCH_SIZE = 500
    count = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        values = [
            {
                "time": r["date"],
                "instrument_token": instrument_token,
                "interval": interval,
                "tradingsymbol": symbol,
                "exchange": exchange,
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
            }
            for r in batch
        ]

        stmt = insert(OHLCVData).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["time", "instrument_token", "interval"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
            },
        )
        await db.execute(stmt)
        count += len(batch)

    await db.flush()
    return count


async def fetch_and_store_from_kite(
    db: AsyncSession,
    kite_client,
    instrument_token: int,
    symbol: str,
    exchange: str,
    from_date: date,
    to_date: date,
    interval: str = "day",
) -> int:
    """Fetch historical data from Kite Connect and store in DB.

    Automatically chunks large date ranges based on Kite API limits:
      minute: 60 days, 3/5/10/15/30minute: 100 days,
      60minute: 400 days, day: 2000 days
    """
    import asyncio
    from datetime import timedelta

    # Kite API max days per request by interval
    max_days = {
        "minute": 60, "3minute": 100, "5minute": 100,
        "10minute": 100, "15minute": 100, "30minute": 100,
        "60minute": 400, "day": 2000,
    }
    chunk_days = max_days.get(interval, 2000)

    # Map Kite interval names to our interval codes
    interval_map = {
        "minute": "1m", "3minute": "3m", "5minute": "5m",
        "10minute": "10m", "15minute": "15m", "30minute": "30m",
        "60minute": "1h", "day": "1d",
    }
    db_interval = interval_map.get(interval, interval)

    total_count = 0
    chunk_start = from_date

    try:
        while chunk_start <= to_date:
            chunk_end = min(chunk_start + timedelta(days=chunk_days - 1), to_date)

            data = await asyncio.to_thread(
                kite_client.historical_data,
                instrument_token=instrument_token,
                from_date=chunk_start,
                to_date=chunk_end,
                interval=interval,
            )

            if data:
                count = await store_ohlcv(db, data, symbol, exchange, instrument_token, db_interval)
                total_count += count

            chunk_start = chunk_end + timedelta(days=1)

        return total_count
    except Exception as e:
        logger.error(f"Error fetching data from Kite: {e}")
        raise


async def refresh_instruments_from_kite(db: AsyncSession, kite_client) -> int:
    """Download and store the full Zerodha instrument list using bulk operations."""
    import asyncio
    from sqlalchemy import delete

    # kite_client.instruments() is sync (uses requests), so run in thread
    instruments = await asyncio.to_thread(kite_client.instruments)
    now = datetime.now(timezone.utc)

    # Delete all existing instruments and bulk-insert fresh data
    await db.execute(delete(Instrument))

    BATCH_SIZE = 2000
    count = 0

    for i in range(0, len(instruments), BATCH_SIZE):
        batch = instruments[i : i + BATCH_SIZE]
        rows = []
        for inst in batch:
            expiry = inst.get("expiry") or None
            if expiry and not isinstance(expiry, date):
                expiry = None
            # Kite returns some numeric fields as strings — cast them
            exchange_token = inst.get("exchange_token")
            try:
                exchange_token = int(exchange_token) if exchange_token else None
            except (ValueError, TypeError):
                exchange_token = None
            tick_size = inst.get("tick_size")
            try:
                tick_size = float(tick_size) if tick_size else None
            except (ValueError, TypeError):
                tick_size = None
            strike = inst.get("strike")
            try:
                strike = float(strike) if strike else None
            except (ValueError, TypeError):
                strike = None
            rows.append(
                Instrument(
                    instrument_token=int(inst["instrument_token"]),
                    exchange_token=exchange_token,
                    tradingsymbol=str(inst["tradingsymbol"]),
                    name=str(inst.get("name") or ""),
                    exchange=str(inst["exchange"]),
                    segment=str(inst.get("segment") or ""),
                    instrument_type=str(inst.get("instrument_type") or ""),
                    lot_size=int(inst.get("lot_size", 1)),
                    tick_size=tick_size,
                    expiry=expiry,
                    strike=strike,
                    last_updated=now,
                )
            )
        db.add_all(rows)
        await db.flush()
        count += len(rows)

    logger.info(f"Refreshed {count} instruments from Kite")
    return count
