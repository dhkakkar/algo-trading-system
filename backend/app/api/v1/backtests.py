import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.backtest import BacktestCreate, BacktestResponse, BacktestListResponse, BacktestTradeResponse
from app.services import backtest_service

router = APIRouter(prefix="/backtests", tags=["Backtests"])


@router.get("", response_model=list[BacktestListResponse])
async def list_backtests(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from app.models.strategy import Strategy

    backtests = await backtest_service.get_backtests(db, current_user.id)
    strategy_ids = list({b.strategy_id for b in backtests})
    name_map: dict = {}
    if strategy_ids:
        result = await db.execute(
            select(Strategy.id, Strategy.name).where(Strategy.id.in_(strategy_ids))
        )
        name_map = {row.id: row.name for row in result.all()}
    responses = []
    for b in backtests:
        resp = BacktestListResponse.model_validate(b)
        resp.strategy_name = name_map.get(b.strategy_id)
        responses.append(resp)
    return responses


@router.post("", response_model=BacktestResponse, status_code=201)
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
    from sqlalchemy import select
    from app.models.strategy import Strategy

    backtest = await backtest_service.get_backtest(db, backtest_id, current_user.id)

    # Fetch strategy name
    result = await db.execute(
        select(Strategy.name).where(Strategy.id == backtest.strategy_id)
    )
    strategy_name = result.scalar_one_or_none()

    response = BacktestResponse.model_validate(backtest)
    response.strategy_name = strategy_name
    return response


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


@router.get("/{backtest_id}/logs")
async def get_backtest_logs(
    backtest_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get execution logs for a backtest."""
    backtest = await backtest_service.get_backtest(db, backtest_id, current_user.id)
    return backtest.logs or []


@router.get("/{backtest_id}/progress")
async def get_backtest_progress(
    backtest_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get real-time progress of a running backtest from Celery task state."""
    backtest = await backtest_service.get_backtest(db, backtest_id, current_user.id)
    if backtest.status not in ("pending", "running"):
        return {"status": backtest.status, "percent": 100 if backtest.status == "completed" else 0}

    if backtest.celery_task_id:
        from celery.result import AsyncResult
        from app.tasks.celery_app import celery_app as app
        result = AsyncResult(backtest.celery_task_id, app=app)
        if result.state == "PROGRESS" and isinstance(result.info, dict):
            return {
                "status": "running",
                "percent": result.info.get("percent", 0),
                "current_date": result.info.get("current_date", ""),
            }
        elif result.state == "STARTED":
            return {"status": "running", "percent": 0}

    return {"status": backtest.status, "percent": 0}


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
