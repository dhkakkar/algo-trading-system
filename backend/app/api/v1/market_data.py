from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.market_data import InstrumentResponse, OHLCVResponse
from app.services import market_data_service

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
    data = await market_data_service.get_ohlcv(
        db, symbol, exchange, from_date, to_date, interval
    )
    return data
