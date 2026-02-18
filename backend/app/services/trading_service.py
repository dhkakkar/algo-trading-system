import uuid
import logging
from datetime import datetime, timezone
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.trading_session import TradingSession
from app.models.session_run import SessionRun
from app.models.strategy import Strategy
from app.models.order import Order
from app.models.position import Position
from app.models.trade import Trade
from app.models.session_log import SessionLog
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


# ---------------------------------------------------------------------------
# Session Run helpers
# ---------------------------------------------------------------------------

async def create_run(
    db: AsyncSession, session_id: uuid.UUID, initial_capital: float
) -> SessionRun:
    """Create a new SessionRun for the given trading session."""
    # Get next run_number
    result = await db.execute(
        select(func.coalesce(func.max(SessionRun.run_number), 0))
        .where(SessionRun.trading_session_id == session_id)
    )
    next_number = result.scalar() + 1

    run = SessionRun(
        trading_session_id=session_id,
        run_number=next_number,
        status="running",
        initial_capital=initial_capital,
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    return run


async def complete_run(
    db: AsyncSession,
    run_id: uuid.UUID,
    equity_curve: list[dict],
    trades: list[dict],
    final_capital: float,
    error_message: str | None = None,
) -> SessionRun:
    """Compute metrics and finalize a session run."""
    from app.engine.backtest.metrics import calculate_all_metrics

    result = await db.execute(
        select(SessionRun).where(SessionRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise NotFoundException("Session run not found")

    # Serialize equity curve timestamps to ISO strings for JSON storage
    serialized_curve = []
    for pt in equity_curve:
        ts = pt.get("timestamp")
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()
        serialized_curve.append({"timestamp": ts, "equity": pt["equity"]})

    now = datetime.now(timezone.utc)
    run.status = "error" if error_message else "completed"
    run.stopped_at = now
    run.final_capital = final_capital
    run.error_message = error_message

    if len(serialized_curve) >= 2 and trades:
        metrics = calculate_all_metrics(
            serialized_curve, trades,
            run.started_at, now,
        )
        run.total_return = metrics["total_return"]
        run.cagr = metrics["cagr"]
        run.sharpe_ratio = metrics["sharpe_ratio"]
        run.sortino_ratio = metrics["sortino_ratio"]
        run.max_drawdown = metrics["max_drawdown"]
        run.win_rate = metrics["win_rate"]
        run.profit_factor = metrics["profit_factor"]
        run.total_trades = metrics["total_trades"]
        run.avg_trade_pnl = metrics["avg_trade_pnl"]
        run.drawdown_curve = metrics["drawdown_curve"]
    else:
        run.total_trades = len(trades)

    run.equity_curve = serialized_curve
    db.add(run)
    await db.flush()
    await db.refresh(run)
    return run


async def get_session_runs(
    db: AsyncSession, session_id: uuid.UUID
) -> list[SessionRun]:
    """List all runs for a session, newest first."""
    result = await db.execute(
        select(SessionRun)
        .where(SessionRun.trading_session_id == session_id)
        .order_by(SessionRun.run_number.desc())
    )
    return list(result.scalars().all())


async def get_run(
    db: AsyncSession, run_id: uuid.UUID, user_id: uuid.UUID
) -> SessionRun:
    """Get a single run with ownership check."""
    result = await db.execute(
        select(SessionRun).where(SessionRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise NotFoundException("Session run not found")
    # Ownership via parent session
    session_result = await db.execute(
        select(TradingSession).where(TradingSession.id == run.trading_session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session or session.user_id != user_id:
        raise ForbiddenException("Not authorized to access this run")
    return run


async def get_run_orders(
    db: AsyncSession, run_id: uuid.UUID
) -> list[Order]:
    result = await db.execute(
        select(Order)
        .where(Order.session_run_id == run_id)
        .order_by(Order.placed_at.desc())
    )
    return list(result.scalars().all())


async def get_run_trades(
    db: AsyncSession, run_id: uuid.UUID
) -> list[Trade]:
    result = await db.execute(
        select(Trade)
        .where(Trade.session_run_id == run_id)
        .order_by(Trade.created_at.desc())
    )
    return list(result.scalars().all())


async def get_run_logs(
    db: AsyncSession, run_id: uuid.UUID
) -> list[SessionLog]:
    result = await db.execute(
        select(SessionLog)
        .where(SessionLog.session_run_id == run_id)
        .order_by(SessionLog.created_at.asc())
    )
    return list(result.scalars().all())
