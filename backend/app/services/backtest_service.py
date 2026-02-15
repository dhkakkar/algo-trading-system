import uuid
import logging
from datetime import datetime, timezone
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.backtest import Backtest
from app.models.strategy import Strategy
from app.schemas.backtest import BacktestCreate
from app.exceptions import NotFoundException, ForbiddenException, BadRequestException

logger = logging.getLogger(__name__)


async def create_backtest(
    db: AsyncSession, user_id: uuid.UUID, data: BacktestCreate
) -> Backtest:
    # Verify strategy ownership
    result = await db.execute(
        select(Strategy).where(Strategy.id == data.strategy_id)
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise NotFoundException("Strategy not found")
    if strategy.user_id != user_id:
        raise ForbiddenException("Not authorized to access this strategy")

    if data.start_date >= data.end_date:
        raise BadRequestException("start_date must be before end_date")

    # Use strategy's instruments if none specified
    instruments = data.instruments if data.instruments else strategy.instruments

    backtest = Backtest(
        user_id=user_id,
        strategy_id=data.strategy_id,
        strategy_version=strategy.version,
        status="pending",
        start_date=data.start_date,
        end_date=data.end_date,
        initial_capital=data.initial_capital,
        timeframe=data.timeframe or strategy.timeframe,
        parameters=data.parameters if data.parameters else strategy.parameters,
        instruments=instruments,
    )
    db.add(backtest)
    await db.flush()
    await db.refresh(backtest)

    return backtest


async def get_backtests(db: AsyncSession, user_id: uuid.UUID) -> list[Backtest]:
    result = await db.execute(
        select(Backtest)
        .where(Backtest.user_id == user_id)
        .order_by(Backtest.created_at.desc())
    )
    return list(result.scalars().all())


async def get_backtest(
    db: AsyncSession, backtest_id: uuid.UUID, user_id: uuid.UUID
) -> Backtest:
    result = await db.execute(
        select(Backtest).where(Backtest.id == backtest_id)
    )
    backtest = result.scalar_one_or_none()
    if not backtest:
        raise NotFoundException("Backtest not found")
    if backtest.user_id != user_id:
        raise ForbiddenException("Not authorized to access this backtest")
    return backtest


async def update_backtest_status(
    db: AsyncSession, backtest_id: uuid.UUID, status: str, **kwargs
) -> Backtest:
    result = await db.execute(
        select(Backtest).where(Backtest.id == backtest_id)
    )
    backtest = result.scalar_one_or_none()
    if not backtest:
        raise NotFoundException("Backtest not found")

    backtest.status = status

    if status == "running":
        backtest.started_at = datetime.now(timezone.utc)
    elif status in ("completed", "failed"):
        backtest.completed_at = datetime.now(timezone.utc)

    for key, value in kwargs.items():
        if hasattr(backtest, key):
            setattr(backtest, key, value)

    db.add(backtest)
    await db.flush()
    await db.refresh(backtest)
    return backtest


async def delete_backtest(
    db: AsyncSession, backtest_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    from app.models.trade import Trade
    backtest = await get_backtest(db, backtest_id, user_id)
    # Delete associated trades first (FK constraint)
    await db.execute(sa_delete(Trade).where(Trade.backtest_id == backtest_id))
    await db.delete(backtest)
