import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.trading import (
    TradingSessionCreate, TradingSessionResponse, TradingSessionListResponse,
    OrderResponse, PositionResponse, TradeResponse,
)
from app.services import trading_service
from app.exceptions import BadRequestException

router = APIRouter(prefix="/trading", tags=["Trading"])


@router.get("/sessions", response_model=list[TradingSessionListResponse])
async def list_sessions(
    mode: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sessions = await trading_service.get_sessions(db, current_user.id, mode)
    return sessions


@router.post("/sessions", response_model=TradingSessionResponse, status_code=201)
async def create_session(
    data: TradingSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # For live mode, check trading permissions
    if data.mode == "live":
        from app.services import platform_service
        can_trade = await platform_service.can_trade_live(db, current_user)
        if not can_trade["allowed"]:
            raise BadRequestException(f"Live trading not allowed: {can_trade['reason']}")

    session = await trading_service.create_session(db, current_user.id, data)
    return session


@router.get("/sessions/{session_id}", response_model=TradingSessionResponse)
async def get_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await trading_service.get_session(db, session_id, current_user.id)
    return session


@router.post("/sessions/{session_id}/start")
async def start_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await trading_service.get_session(db, session_id, current_user.id)
    if session.status == "running":
        raise BadRequestException("Session is already running")

    if session.mode == "paper":
        # Start paper trading runner
        from app.models.strategy import Strategy
        from sqlalchemy import select

        result = await db.execute(select(Strategy).where(Strategy.id == session.strategy_id))
        strategy = result.scalar_one_or_none()
        if not strategy:
            raise BadRequestException("Strategy not found")

        from app.engine.paper.runner import PaperTradingRunner
        from app.websocket.server import emit_trading_update

        config = {
            "initial_capital": float(session.initial_capital),
            "instruments": session.instruments,
            "parameters": session.parameters,
            "timeframe": session.timeframe,
        }

        runner = PaperTradingRunner(str(session.id), strategy.code, config)

        async def on_tick_update(r):
            snapshot = r.get_state_snapshot()
            await emit_trading_update(str(current_user.id), "trading_update", snapshot)

        await runner.start(tick_callback=on_tick_update)
        trading_service.register_runner(str(session.id), runner)

        # Start the Kite ticker for live data
        from app.integrations.kite_connect.client import kite_manager
        kite_client = await kite_manager.get_client(db, str(current_user.id))

        if kite_client:
            # Look up instrument tokens for subscribed symbols
            from app.models.instrument import Instrument
            tokens_map = []
            for symbol_str in session.instruments:
                sym = symbol_str.split(":")[-1] if ":" in symbol_str else symbol_str
                exch = symbol_str.split(":")[0] if ":" in symbol_str else "NSE"
                result = await db.execute(
                    select(Instrument).where(
                        Instrument.tradingsymbol == sym.upper(),
                        Instrument.exchange == exch.upper(),
                    )
                )
                inst = result.scalar_one_or_none()
                if inst:
                    tokens_map.append({
                        "instrument_token": inst.instrument_token,
                        "tradingsymbol": inst.tradingsymbol,
                    })

            if tokens_map:
                import asyncio
                from app.engine.paper.ticker import KiteTicker

                ticker = KiteTicker(
                    api_key=kite_client.api_key if hasattr(kite_client, 'api_key') else "",
                    access_token=kite_client.access_token if hasattr(kite_client, 'access_token') else "",
                )
                ticker.set_instruments(tokens_map)

                async def on_ticks(prices):
                    await runner.on_market_data(prices)

                ticker.on_tick(on_ticks)
                ticker.start(asyncio.get_event_loop())

    elif session.mode == "live":
        # Start live trading runner
        from app.models.strategy import Strategy
        from sqlalchemy import select

        # Verify live trading is allowed
        from app.services import platform_service
        can_trade = await platform_service.can_trade_live(db, current_user)
        if not can_trade["allowed"]:
            raise BadRequestException(f"Live trading not allowed: {can_trade['reason']}")

        result = await db.execute(select(Strategy).where(Strategy.id == session.strategy_id))
        strategy = result.scalar_one_or_none()
        if not strategy:
            raise BadRequestException("Strategy not found")

        from app.integrations.kite_connect.client import kite_manager
        kite_client = await kite_manager.get_client(db, str(current_user.id))
        if not kite_client:
            raise BadRequestException("Kite Connect not connected. Please connect your broker first.")

        from app.engine.live.runner import LiveTradingRunner
        from app.websocket.server import emit_trading_update

        config = {
            "initial_capital": float(session.initial_capital),
            "instruments": session.instruments,
            "parameters": session.parameters,
            "timeframe": session.timeframe,
        }

        runner = LiveTradingRunner(str(session.id), strategy.code, config, kite_client)

        async def on_tick_update(r):
            snapshot = r.get_state_snapshot()
            await emit_trading_update(str(current_user.id), "trading_update", snapshot)

        await runner.start(tick_callback=on_tick_update)
        trading_service.register_runner(str(session.id), runner)

        # Start the Kite ticker
        from app.models.instrument import Instrument
        from sqlalchemy import select as sel
        tokens_map = []
        for symbol_str in session.instruments:
            sym = symbol_str.split(":")[-1] if ":" in symbol_str else symbol_str
            exch = symbol_str.split(":")[0] if ":" in symbol_str else "NSE"
            result = await db.execute(
                sel(Instrument).where(
                    Instrument.tradingsymbol == sym.upper(),
                    Instrument.exchange == exch.upper(),
                )
            )
            inst = result.scalar_one_or_none()
            if inst:
                tokens_map.append({
                    "instrument_token": inst.instrument_token,
                    "tradingsymbol": inst.tradingsymbol,
                })

        if tokens_map:
            import asyncio
            from app.engine.paper.ticker import KiteTicker

            ticker = KiteTicker(
                api_key=kite_client.api_key if hasattr(kite_client, 'api_key') else "",
                access_token=kite_client.access_token if hasattr(kite_client, 'access_token') else "",
            )
            ticker.set_instruments(tokens_map)

            async def on_live_ticks(prices):
                await runner.on_market_data(prices)

            ticker.on_tick(on_live_ticks)
            ticker.start(asyncio.get_event_loop())

    await trading_service.update_session_status(db, session_id, "running")
    return {"message": "Session started", "status": "running"}


@router.post("/sessions/{session_id}/square-off")
async def square_off_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Emergency square off: close ALL open positions at market price."""
    session = await trading_service.get_session(db, session_id, current_user.id)
    if session.mode != "live":
        raise BadRequestException("Square off is only available for live trading sessions")

    runner = trading_service.get_active_runner(str(session.id))
    if not runner:
        raise BadRequestException("Session is not active")

    if not hasattr(runner, 'square_off_all'):
        raise BadRequestException("Square off not supported for this session type")

    results = await runner.square_off_all()
    await trading_service.update_session_status(db, session_id, "stopped")
    trading_service.unregister_runner(str(session.id))

    return {
        "message": "Emergency square off executed",
        "results": results,
        "status": "stopped",
    }


@router.post("/sessions/{session_id}/stop")
async def stop_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await trading_service.get_session(db, session_id, current_user.id)
    if session.status not in ("running", "paused"):
        raise BadRequestException("Session is not active")

    runner = trading_service.get_active_runner(str(session.id))
    if runner:
        await runner.shutdown()
        # Save final state
        try:
            if hasattr(runner, 'broker'):
                prices = {s: runner.broker.get_price(s) or 0 for s in runner._tracked_symbols}
            else:
                prices = getattr(runner, '_current_prices', {})
            final_value = runner.portfolio.get_portfolio_value(prices)
        except Exception:
            final_value = None
        await trading_service.update_session_status(
            db, session_id, "stopped", current_capital=final_value
        )
        trading_service.unregister_runner(str(session.id))
    else:
        await trading_service.update_session_status(db, session_id, "stopped")

    return {"message": "Session stopped", "status": "stopped"}


@router.post("/sessions/{session_id}/pause")
async def pause_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await trading_service.get_session(db, session_id, current_user.id)
    if session.status != "running":
        raise BadRequestException("Session is not running")

    runner = trading_service.get_active_runner(str(session.id))
    if runner:
        runner.pause()

    await trading_service.update_session_status(db, session_id, "paused")
    return {"message": "Session paused", "status": "paused"}


@router.post("/sessions/{session_id}/resume")
async def resume_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await trading_service.get_session(db, session_id, current_user.id)
    if session.status != "paused":
        raise BadRequestException("Session is not paused")

    runner = trading_service.get_active_runner(str(session.id))
    if runner:
        runner.resume()

    await trading_service.update_session_status(db, session_id, "running")
    return {"message": "Session resumed", "status": "running"}


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await trading_service.delete_session(db, session_id, current_user.id)


@router.get("/sessions/{session_id}/orders", response_model=list[OrderResponse])
async def get_session_orders(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await trading_service.get_session(db, session_id, current_user.id)
    return await trading_service.get_session_orders(db, session_id)


@router.get("/sessions/{session_id}/positions", response_model=list[PositionResponse])
async def get_session_positions(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await trading_service.get_session(db, session_id, current_user.id)
    return await trading_service.get_session_positions(db, session_id)


@router.get("/sessions/{session_id}/trades", response_model=list[TradeResponse])
async def get_session_trades(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await trading_service.get_session(db, session_id, current_user.id)
    return await trading_service.get_session_trades(db, session_id)


@router.get("/sessions/{session_id}/snapshot")
async def get_session_snapshot(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get real-time snapshot of a running session (positions, P&L, prices)."""
    await trading_service.get_session(db, session_id, current_user.id)
    runner = trading_service.get_active_runner(str(session_id))
    if not runner:
        raise BadRequestException("Session is not active")
    return runner.get_state_snapshot()
