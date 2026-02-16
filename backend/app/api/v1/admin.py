from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services import platform_service
from app.exceptions import ForbiddenException, BadRequestException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/admin", tags=["Admin"])


class TradingModeRequest(BaseModel):
    mode: str = Field(..., pattern=r"^(test|live)$")


class PlatformStatusResponse(BaseModel):
    platform_trading_mode: str
    total_users: int
    users_in_live_mode: int
    users_in_test_mode: int


class UserTradingModeResponse(BaseModel):
    user_id: str
    email: str
    trading_mode: str
    platform_trading_mode: str
    can_trade_live: bool
    reason: str | None = None


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    if not user.is_superadmin:
        raise ForbiddenException("Super admin access required")
    return user


@router.get("/platform/status", response_model=PlatformStatusResponse)
async def get_platform_status(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    settings = await platform_service.get_platform_settings(db)
    result = await db.execute(select(User).where(User.is_active == True))
    users = list(result.scalars().all())

    return PlatformStatusResponse(
        platform_trading_mode=settings.trading_mode,
        total_users=len(users),
        users_in_live_mode=sum(1 for u in users if u.trading_mode == "live"),
        users_in_test_mode=sum(1 for u in users if u.trading_mode == "test"),
    )


@router.post("/platform/trading-mode")
async def set_platform_trading_mode(
    data: TradingModeRequest,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Set platform-wide trading mode. When set to 'test', NO client can place live trades."""
    settings = await platform_service.set_platform_trading_mode(db, admin, data.mode)

    # When switching to TEST mode, force-stop all running live trading sessions
    stopped_sessions = 0
    if data.mode == "test":
        from app.models.trading_session import TradingSession
        from app.services import trading_service

        result = await db.execute(
            select(TradingSession).where(
                TradingSession.mode == "live",
                TradingSession.status.in_(["running", "paused"]),
            )
        )
        live_sessions = list(result.scalars().all())
        for session in live_sessions:
            runner = trading_service.get_active_runner(str(session.id))
            if runner:
                await runner.shutdown()
                trading_service.unregister_runner(str(session.id))
            await trading_service.update_session_status(db, session.id, "stopped")
            stopped_sessions += 1

    msg = f"Platform trading mode set to '{settings.trading_mode}'"
    if stopped_sessions > 0:
        msg += f". Stopped {stopped_sessions} live trading session(s)."

    return {
        "message": msg,
        "trading_mode": settings.trading_mode,
        "stopped_sessions": stopped_sessions,
    }


@router.post("/users/{user_id}/trading-mode")
async def set_user_trading_mode_admin(
    user_id: str,
    data: TradingModeRequest,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Admin override: set a specific client's trading mode."""
    import uuid
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    target_user = result.scalar_one_or_none()
    if not target_user:
        from app.exceptions import NotFoundException
        raise NotFoundException("User not found")

    updated = await platform_service.set_user_trading_mode(db, target_user, data.mode)
    return {
        "message": f"User {updated.email} trading mode set to '{updated.trading_mode}'",
        "user_id": str(updated.id),
        "trading_mode": updated.trading_mode,
    }


@router.get("/users", response_model=list[UserTradingModeResponse])
async def list_users_with_trading_mode(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """List all users with their trading mode and live trading eligibility."""
    settings = await platform_service.get_platform_settings(db)
    result = await db.execute(select(User).where(User.is_active == True))
    users = list(result.scalars().all())

    response = []
    for user in users:
        live_check = await platform_service.can_trade_live(db, user)
        response.append(UserTradingModeResponse(
            user_id=str(user.id),
            email=user.email,
            trading_mode=user.trading_mode,
            platform_trading_mode=settings.trading_mode,
            can_trade_live=live_check["allowed"],
            reason=live_check["reason"],
        ))
    return response


@router.post("/instruments/refresh")
async def refresh_instruments(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Refresh instrument list from Kite Connect (requires admin's Kite connection)."""
    from app.integrations.kite_connect.client import kite_manager
    from app.services import market_data_service

    kite_client = await kite_manager.get_client(db, str(admin.id))
    if not kite_client:
        from app.exceptions import BadRequestException
        raise BadRequestException(
            "Connect your Kite account first. Go to Settings > Connect Broker."
        )

    count = await market_data_service.refresh_instruments_from_kite(db, kite_client)
    return {"message": f"Refreshed {count} instruments from Kite Connect", "count": count}


class FetchHistoricalRequest(BaseModel):
    symbol: str = Field(..., min_length=1, examples=["RELIANCE"])
    exchange: str = Field(default="NSE", examples=["NSE"])
    from_date: date
    to_date: date
    interval: str = Field(default="day", examples=["day", "minute", "5minute", "15minute"])


@router.post("/fetch-historical")
async def fetch_historical_data(
    data: FetchHistoricalRequest,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Fetch historical OHLCV data from Kite and store in DB."""
    import asyncio
    from app.integrations.kite_connect.client import kite_manager
    from app.services import market_data_service
    from app.models.instrument import Instrument

    kite_client = await kite_manager.get_client(db, str(admin.id))
    if not kite_client:
        raise BadRequestException("Connect your Kite account first.")

    # Find instrument token
    result = await db.execute(
        select(Instrument).where(
            Instrument.tradingsymbol == data.symbol.upper(),
            Instrument.exchange == data.exchange.upper(),
        ).limit(1)
    )
    instrument = result.scalar_one_or_none()
    if not instrument:
        raise BadRequestException(
            f"Instrument {data.exchange}:{data.symbol} not found. Load instruments first."
        )

    count = await market_data_service.fetch_and_store_from_kite(
        db, kite_client,
        instrument_token=instrument.instrument_token,
        symbol=data.symbol.upper(),
        exchange=data.exchange.upper(),
        from_date=data.from_date,
        to_date=data.to_date,
        interval=data.interval,
    )
    return {
        "message": f"Fetched {count} OHLCV records for {data.exchange}:{data.symbol}",
        "count": count,
        "instrument_token": instrument.instrument_token,
    }


@router.post("/seed-test-data")
async def seed_test_data(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Generate 1 year of dummy OHLCV data for SBIN (NSE) for quick backtest testing."""
    import random
    from datetime import datetime, timedelta, timezone as tz
    from app.models.market_data import OHLCVData
    from app.models.instrument import Instrument

    symbol = "SBIN"
    exchange = "NSE"

    # Find or create instrument
    result = await db.execute(
        select(Instrument).where(
            Instrument.tradingsymbol == symbol,
            Instrument.exchange == exchange,
        ).limit(1)
    )
    instrument = result.scalar_one_or_none()
    token = instrument.instrument_token if instrument else 779521

    # Generate 1 year of daily data
    random.seed(42)
    start = datetime(2025, 1, 1, tzinfo=tz.utc)
    price = 800.0
    records = []

    for day_offset in range(365):
        dt = start + timedelta(days=day_offset)
        if dt.weekday() >= 5:  # skip weekends
            continue

        change_pct = random.gauss(0.0005, 0.018)
        open_price = round(price, 2)
        close_price = round(price * (1 + change_pct), 2)
        high_price = round(max(open_price, close_price) * (1 + abs(random.gauss(0, 0.008))), 2)
        low_price = round(min(open_price, close_price) * (1 - abs(random.gauss(0, 0.008))), 2)
        volume = random.randint(5_000_000, 30_000_000)

        records.append(OHLCVData(
            time=dt.replace(hour=9, minute=15),
            instrument_token=token,
            interval="1d",
            tradingsymbol=symbol,
            exchange=exchange,
            open=open_price,
            high=high_price,
            low=low_price,
            close=close_price,
            volume=volume,
        ))
        price = close_price

    # Delete existing test data and insert
    from sqlalchemy import delete, and_
    await db.execute(
        delete(OHLCVData).where(
            and_(
                OHLCVData.tradingsymbol == symbol,
                OHLCVData.exchange == exchange,
                OHLCVData.interval == "1d",
            )
        )
    )
    db.add_all(records)
    await db.flush()

    return {
        "message": f"Seeded {len(records)} daily OHLCV records for {exchange}:{symbol} (Jan 2025 - Dec 2025)",
        "count": len(records),
        "symbol": symbol,
        "exchange": exchange,
        "instrument_token": token,
        "date_range": "2025-01-01 to 2025-12-31",
    }
