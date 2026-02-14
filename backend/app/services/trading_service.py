import uuid
import logging
from datetime import datetime, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.trading_session import TradingSession
from app.models.strategy import Strategy
from app.models.order import Order
from app.models.position import Position
from app.models.trade import Trade
from app.schemas.trading import TradingSessionCreate
from app.exceptions import NotFoundException, ForbiddenException, BadRequestException

logger = logging.getLogger(__name__)

# In-memory registry of active paper trading runners
_active_runners: dict[str, "PaperTradingRunner"] = {}


def get_active_runner(session_id: str):
    return _active_runners.get(session_id)


def register_runner(session_id: str, runner):
    _active_runners[session_id] = runner


def unregister_runner(session_id: str):
    _active_runners.pop(session_id, None)


async def create_session(
    db: AsyncSession, user_id: uuid.UUID, data: TradingSessionCreate
) -> TradingSession:
    # Verify strategy ownership
    result = await db.execute(
        select(Strategy).where(Strategy.id == data.strategy_id)
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise NotFoundException("Strategy not found")
    if strategy.user_id != user_id:
        raise ForbiddenException("Not authorized to use this strategy")

    # Check for existing running sessions with same strategy+mode
    result = await db.execute(
        select(TradingSession).where(
            and_(
                TradingSession.user_id == user_id,
                TradingSession.strategy_id == data.strategy_id,
                TradingSession.mode == data.mode,
                TradingSession.status.in_(["running", "paused"]),
            )
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise BadRequestException(
            f"A {data.mode} trading session for this strategy is already active"
        )

    instruments = data.instruments if data.instruments else strategy.instruments

    session = TradingSession(
        user_id=user_id,
        strategy_id=data.strategy_id,
        strategy_version=strategy.version,
        mode=data.mode,
        status="stopped",
        initial_capital=data.initial_capital,
        parameters=data.parameters if data.parameters else strategy.parameters,
        instruments=instruments,
        timeframe=data.timeframe or strategy.timeframe,
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


async def get_sessions(
    db: AsyncSession, user_id: uuid.UUID, mode: str | None = None
) -> list[TradingSession]:
    query = select(TradingSession).where(TradingSession.user_id == user_id)
    if mode:
        query = query.where(TradingSession.mode == mode)
    query = query.order_by(TradingSession.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_session(
    db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID
) -> TradingSession:
    result = await db.execute(
        select(TradingSession).where(TradingSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise NotFoundException("Trading session not found")
    if session.user_id != user_id:
        raise ForbiddenException("Not authorized to access this session")
    return session


async def update_session_status(
    db: AsyncSession, session_id: uuid.UUID, status: str, **kwargs
) -> TradingSession:
    result = await db.execute(
        select(TradingSession).where(TradingSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise NotFoundException("Trading session not found")

    session.status = status
    if status == "running" and not session.started_at:
        session.started_at = datetime.now(timezone.utc)
    elif status == "stopped":
        session.stopped_at = datetime.now(timezone.utc)

    for key, value in kwargs.items():
        if hasattr(session, key):
            setattr(session, key, value)

    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


async def get_session_orders(
    db: AsyncSession, session_id: uuid.UUID
) -> list[Order]:
    result = await db.execute(
        select(Order)
        .where(Order.trading_session_id == session_id)
        .order_by(Order.placed_at.desc())
    )
    return list(result.scalars().all())


async def get_session_positions(
    db: AsyncSession, session_id: uuid.UUID
) -> list[Position]:
    result = await db.execute(
        select(Position).where(Position.trading_session_id == session_id)
    )
    return list(result.scalars().all())


async def get_session_trades(
    db: AsyncSession, session_id: uuid.UUID
) -> list[Trade]:
    result = await db.execute(
        select(Trade)
        .where(Trade.trading_session_id == session_id)
        .order_by(Trade.created_at.desc())
    )
    return list(result.scalars().all())


async def delete_session(
    db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    session = await get_session(db, session_id, user_id)
    if session.status in ("running", "paused"):
        raise BadRequestException("Cannot delete an active session. Stop it first.")
    await db.delete(session)
