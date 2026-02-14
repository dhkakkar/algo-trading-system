import logging
from datetime import date, datetime, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.market_data import OHLCVData
from app.models.instrument import Instrument
from app.exceptions import NotFoundException

logger = logging.getLogger(__name__)


async def search_instruments(
    db: AsyncSession, query: str, exchange: str | None = None
) -> list[Instrument]:
    stmt = select(Instrument).where(
        Instrument.tradingsymbol.ilike(f"%{query}%")
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
    """Store OHLCV records fetched from Kite. Returns count of records stored."""
    count = 0
    for record in records:
        data = OHLCVData(
            time=record["date"],
            instrument_token=instrument_token,
            tradingsymbol=symbol,
            exchange=exchange,
            open=record["open"],
            high=record["high"],
            low=record["low"],
            close=record["close"],
            volume=record["volume"],
            interval=interval,
        )
        db.add(data)
        count += 1

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
    """Fetch historical data from Kite Connect and store in DB."""
    try:
        data = kite_client.historical_data(
            instrument_token=instrument_token,
            from_date=from_date,
            to_date=to_date,
            interval=interval,
        )
        # Map Kite interval names to our interval codes
        interval_map = {
            "minute": "1m", "3minute": "3m", "5minute": "5m",
            "10minute": "10m", "15minute": "15m", "30minute": "30m",
            "60minute": "1h", "day": "1d",
        }
        db_interval = interval_map.get(interval, interval)
        return await store_ohlcv(db, data, symbol, exchange, instrument_token, db_interval)
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
            expiry = inst.get("expiry")
            if expiry and not isinstance(expiry, date):
                expiry = None
            rows.append(
                Instrument(
                    instrument_token=inst["instrument_token"],
                    exchange_token=inst.get("exchange_token"),
                    tradingsymbol=inst["tradingsymbol"],
                    name=inst.get("name") or "",
                    exchange=inst["exchange"],
                    segment=inst.get("segment") or "",
                    instrument_type=inst.get("instrument_type") or "",
                    lot_size=inst.get("lot_size", 1),
                    tick_size=inst.get("tick_size"),
                    expiry=expiry,
                    strike=inst.get("strike"),
                    last_updated=now,
                )
            )
        db.add_all(rows)
        await db.flush()
        count += len(rows)

    logger.info(f"Refreshed {count} instruments from Kite")
    return count
