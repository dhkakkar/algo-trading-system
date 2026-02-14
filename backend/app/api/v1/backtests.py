import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.backtest import BacktestCreate, BacktestResponse, BacktestListResponse, BacktestTradeResponse
from app.services import backtest_service

router = APIRouter(prefix="/backtests", tags=["Backtests"])


@router.get("/", response_model=list[BacktestListResponse])
async def list_backtests(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    backtests = await backtest_service.get_backtests(db, current_user.id)
    return backtests


@router.post("/", response_model=BacktestResponse, status_code=201)
async def create_backtest(
    data: BacktestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    backtest = await backtest_service.create_backtest(db, current_user.id, data)

    # Queue the backtest as a Celery task
    from app.tasks.backtest_tasks import run_backtest

    task = run_backtest.delay(str(backtest.id))
    backtest.celery_task_id = task.id
    db.add(backtest)

    return backtest


@router.get("/{backtest_id}", response_model=BacktestResponse)
async def get_backtest(
    backtest_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    backtest = await backtest_service.get_backtest(db, backtest_id, current_user.id)
    return backtest


@router.delete("/{backtest_id}", status_code=204)
async def delete_backtest(
    backtest_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await backtest_service.delete_backtest(db, backtest_id, current_user.id)


@router.get("/{backtest_id}/trades", response_model=list[BacktestTradeResponse])
async def get_backtest_trades(
    backtest_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get trade log for a completed backtest."""
    backtest = await backtest_service.get_backtest(db, backtest_id, current_user.id)

    # Trades are stored in the equity_curve JSONB or as part of the backtest results
    # For now, query the orders table for this backtest
    from sqlalchemy import select
    from app.models.trade import Trade

    result = await db.execute(
        select(Trade).where(Trade.backtest_id == backtest_id).order_by(Trade.created_at.asc())
    )
    trades = list(result.scalars().all())

    return [
        BacktestTradeResponse(
            symbol=t.tradingsymbol,
            exchange=t.exchange,
            side=t.side,
            quantity=t.quantity,
            entry_price=float(t.entry_price),
            exit_price=float(t.exit_price) if t.exit_price else None,
            pnl=float(t.pnl) if t.pnl else None,
            pnl_percent=float(t.pnl_percent) if t.pnl_percent else None,
            charges=float(t.charges) if t.charges else 0.0,
            net_pnl=float(t.net_pnl) if t.net_pnl else None,
            entry_at=t.entry_at.isoformat() if t.entry_at else "",
            exit_at=t.exit_at.isoformat() if t.exit_at else None,
        )
        for t in trades
    ]


@router.post("/{backtest_id}/cancel")
async def cancel_backtest(
    backtest_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    backtest = await backtest_service.get_backtest(db, backtest_id, current_user.id)
    if backtest.status == "running" and backtest.celery_task_id:
        from app.tasks.celery_app import celery_app

        celery_app.control.revoke(backtest.celery_task_id, terminate=True)
        await backtest_service.update_backtest_status(
            db, backtest_id, "failed", error_message="Cancelled by user"
        )
    return {"message": "Backtest cancelled"}
