import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.trading import (
    TradingSessionCreate, TradingSessionResponse, TradingSessionListResponse,
    OrderResponse, PositionResponse, TradeResponse,
    SessionRunListResponse, SessionRunResponse,
)
from app.services import trading_service
from app.exceptions import BadRequestException
from app.services.notification_service import fire_notification
from app.schemas.notifications import NotificationEventType

router = APIRouter(prefix="/trading", tags=["Trading"])


@router.get("/sessions", response_model=list[TradingSessionListResponse])
async def list_sessions(
    mode: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sessions = await trading_service.get_sessions(db, current_user.id, mode)
    # Attach strategy names
    from app.models.strategy import Strategy
    strategy_ids = list({s.strategy_id for s in sessions})
    if strategy_ids:
        result = await db.execute(
            select(Strategy.id, Strategy.name).where(Strategy.id.in_(strategy_ids))
        )
        name_map = {row.id: row.name for row in result.all()}
        responses = []
        for s in sessions:
            resp = TradingSessionListResponse.model_validate(s)
            resp.strategy_name = name_map.get(s.strategy_id)
            responses.append(resp)
        return responses
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
    from app.models.strategy import Strategy
    result = await db.execute(
        select(Strategy.name).where(Strategy.id == session.strategy_id)
    )
    strategy_name = result.scalar_one_or_none()
    resp = TradingSessionResponse.model_validate(session)
    resp.strategy_name = strategy_name
    return resp


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
      try:
        # Start paper trading runner
        from app.models.strategy import Strategy
        from sqlalchemy import select

        result = await db.execute(select(Strategy).where(Strategy.id == session.strategy_id))
        strategy = result.scalar_one_or_none()
        if not strategy:
            raise BadRequestException("Strategy not found")

        # Verify Kite Connect is available for live market data
        from app.integrations.kite_connect.client import kite_manager
        kite_client = await kite_manager.get_client(db, str(current_user.id))
        if not kite_client:
            raise BadRequestException(
                "Kite Connect not connected. Paper trading requires a broker connection "
                "for live market data. Go to Settings > Connect Broker."
            )

        from app.engine.paper.runner import PaperTradingRunner
        from app.websocket.server import emit_trading_update
        from app.db.session import async_session_factory

        config = {
            "initial_capital": float(session.initial_capital),
            "instruments": session.instruments,
            "parameters": session.parameters,
            "timeframe": session.timeframe,
        }

        runner = PaperTradingRunner(
            str(session.id), strategy.code, config,
            user_id=current_user.id,
            db_session_factory=async_session_factory,
        )
        runner._kite_client = kite_client  # For on-demand option LTP lookups

        # Pre-populate historical data cache from DB
        import pandas as pd
        from datetime import timedelta
        from app.models.market_data import OHLCVData

        for symbol_str in session.instruments:
            sym = symbol_str.split(":")[-1] if ":" in symbol_str else symbol_str
            exch = symbol_str.split(":")[0] if ":" in symbol_str else "NSE"
            end_dt = datetime.now(timezone.utc)
            start_dt = end_dt - timedelta(days=365)
            hist_result = await db.execute(
                select(OHLCVData).where(
                    OHLCVData.tradingsymbol == sym.upper(),
                    OHLCVData.exchange == exch.upper(),
                    OHLCVData.interval == session.timeframe,
                    OHLCVData.time >= start_dt,
                    OHLCVData.time <= end_dt,
                ).order_by(OHLCVData.time.asc())
            )
            records = list(hist_result.scalars().all())
            if records:
                df = pd.DataFrame([{
                    "open": float(r.open), "high": float(r.high),
                    "low": float(r.low), "close": float(r.close),
                    "volume": int(r.volume),
                } for r in records], index=[r.time for r in records])
                df.index.name = "timestamp"
                runner._historical_cache[sym.upper()] = df

        # Populate option chain cache for derivatives (NFO instruments)
        from app.models.instrument import Instrument
        underlying_names = set()
        for symbol_str in session.instruments:
            sym = symbol_str.split(":")[-1] if ":" in symbol_str else symbol_str
            name_map = {
                "NIFTY 50": "NIFTY", "NIFTY BANK": "BANKNIFTY",
                "NIFTY FIN SERVICE": "FINNIFTY",
            }
            underlying_names.add(name_map.get(sym.upper(), sym.upper()))

        if underlying_names:
            from sqlalchemy import or_
            name_filters = [Instrument.name == u for u in underlying_names]
            opt_result = await db.execute(
                select(Instrument).where(
                    Instrument.exchange == "NFO",
                    Instrument.instrument_type.in_(["CE", "PE"]),
                    or_(*name_filters),
                    Instrument.expiry != None,
                )
            )
            opt_instruments = list(opt_result.scalars().all())
            if opt_instruments:
                runner._option_chain_cache = [
                    {
                        "tradingsymbol": inst.tradingsymbol,
                        "strike": float(inst.strike) if inst.strike else 0,
                        "option_type": inst.instrument_type,  # CE or PE
                        "expiry": inst.expiry,
                        "lot_size": inst.lot_size or 1,
                        "instrument_token": inst.instrument_token,
                    }
                    for inst in opt_instruments
                ]
                expiries = sorted(set(
                    inst.expiry for inst in opt_instruments if inst.expiry
                ))
                runner._expiry_cache = expiries

        async def on_tick_update(r):
            snapshot = r.get_state_snapshot()
            await emit_trading_update(str(current_user.id), "trading_update", snapshot)

        await runner.start(tick_callback=on_tick_update)

        # Create a SessionRun for this start/stop cycle
        run = await trading_service.create_run(db, session.id, float(session.initial_capital))
        runner.run_id = str(run.id)
        runner.slog.run_id = str(run.id)

        trading_service.register_runner(str(session.id), runner)

        # Start the Kite ticker for live data
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
            runner._ticker = ticker

      except BadRequestException:
          raise
      except Exception as exc:
          await trading_service.update_session_status(
              db, session_id, "error", error_message=str(exc)
          )
          raise BadRequestException(f"Failed to start paper trading: {exc}")

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
        from app.db.session import async_session_factory

        config = {
            "initial_capital": float(session.initial_capital),
            "instruments": session.instruments,
            "parameters": session.parameters,
            "timeframe": session.timeframe,
        }

        runner = LiveTradingRunner(
            str(session.id), strategy.code, config, kite_client,
            user_id=current_user.id, db_session_factory=async_session_factory,
        )

        async def on_tick_update(r):
            snapshot = r.get_state_snapshot()
            await emit_trading_update(str(current_user.id), "trading_update", snapshot)

        await runner.start(tick_callback=on_tick_update)

        # Create a SessionRun for this start/stop cycle
        run = await trading_service.create_run(db, session.id, float(session.initial_capital))
        runner.run_id = str(run.id)
        runner.slog.run_id = str(run.id)

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
    fire_notification(current_user.id, NotificationEventType.SESSION_STARTED, {
        "session_id": str(session_id), "mode": session.mode,
    })
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


@router.post("/sessions/{session_id}/close-position")
async def close_position(
    session_id: uuid.UUID,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Close a specific position at market price (paper trading)."""
    session = await trading_service.get_session(db, session_id, current_user.id)
    runner = trading_service.get_active_runner(str(session.id))
    if not runner:
        raise BadRequestException("Session is not active")
    symbol = data.get("symbol")
    if not symbol:
        raise BadRequestException("symbol is required")
    if not hasattr(runner, "close_position"):
        raise BadRequestException("Close position not supported for this session type")
    order_id = runner.close_position(symbol)
    if not order_id:
        raise BadRequestException(f"No open position found for {symbol}")
    return {"message": f"Close order placed for {symbol}", "order_id": order_id}


@router.patch("/sessions/{session_id}/modify-sl-tp")
async def modify_sl_tp(
    session_id: uuid.UUID,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Modify SL and/or TP for an open position (paper trading)."""
    session = await trading_service.get_session(db, session_id, current_user.id)
    runner = trading_service.get_active_runner(str(session.id))
    if not runner:
        raise BadRequestException("Session is not active")
    symbol = data.get("symbol")
    if not symbol:
        raise BadRequestException("symbol is required")
    if not hasattr(runner, "modify_sl_tp"):
        raise BadRequestException("Modify SL/TP not supported for this session type")
    sl_price = data.get("sl_price")
    tp_price = data.get("tp_price")
    if sl_price is not None:
        sl_price = float(sl_price)
    if tp_price is not None:
        tp_price = float(tp_price)
    result = runner.modify_sl_tp(symbol, sl_price=sl_price, tp_price=tp_price)
    if "error" in result:
        raise BadRequestException(result["error"])
    return {"message": "SL/TP updated", **result}


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

        # Complete the SessionRun with metrics
        if runner.run_id:
            try:
                await trading_service.complete_run(
                    db,
                    uuid.UUID(runner.run_id),
                    runner.portfolio.equity_curve,
                    runner.portfolio.trades,
                    final_value or float(session.initial_capital),
                )
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning("Failed to complete run: %s", exc)

        await trading_service.update_session_status(
            db, session_id, "stopped", current_capital=final_value
        )
        trading_service.unregister_runner(str(session.id))
    else:
        await trading_service.update_session_status(db, session_id, "stopped")

    fire_notification(current_user.id, NotificationEventType.SESSION_STOPPED, {
        "session_id": str(session_id), "mode": session.mode,
    })
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
    fire_notification(current_user.id, NotificationEventType.SESSION_PAUSED, {
        "session_id": str(session_id), "mode": session.mode,
    })
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
    fire_notification(current_user.id, NotificationEventType.SESSION_RESUMED, {
        "session_id": str(session_id), "mode": session.mode,
    })
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
    session = await trading_service.get_session(db, session_id, current_user.id)
    runner = trading_service.get_active_runner(str(session_id))
    if not runner:
        # Runner lost (e.g. backend restart) — sync DB status
        if session.status == "running":
            session.status = "stopped"
            db.add(session)
            await db.commit()
        raise BadRequestException("Session is not active")
    return runner.get_state_snapshot()


@router.get("/sessions/{session_id}/logs")
async def get_session_logs(
    session_id: uuid.UUID,
    level: str | None = None,
    limit: int = 200,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get logs for a trading session (from DB, includes historical logs)."""
    from app.models.session_log import SessionLog
    from sqlalchemy import desc

    # Verify user owns the session
    await trading_service.get_session(db, session_id, current_user.id)

    stmt = (
        select(SessionLog)
        .where(SessionLog.trading_session_id == session_id)
    )
    if level:
        stmt = stmt.where(SessionLog.level == level.upper())
    stmt = stmt.order_by(desc(SessionLog.created_at)).limit(limit)

    result = await db.execute(stmt)
    logs = list(result.scalars().all())
    logs.reverse()  # Return in chronological order

    return [
        {
            "id": str(log.id),
            "timestamp": log.created_at.isoformat(),
            "level": log.level,
            "source": log.source,
            "message": log.message,
        }
        for log in logs
    ]


# ---------------------------------------------------------------------------
# Session Run endpoints
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/runs", response_model=list[SessionRunListResponse])
async def list_session_runs(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all runs for a trading session."""
    await trading_service.get_session(db, session_id, current_user.id)
    return await trading_service.get_session_runs(db, session_id)


@router.get("/sessions/{session_id}/runs/{run_id}", response_model=SessionRunResponse)
async def get_session_run(
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full details for a specific run."""
    return await trading_service.get_run(db, run_id, current_user.id)


@router.get("/sessions/{session_id}/runs/{run_id}/trades", response_model=list[TradeResponse])
async def get_run_trades(
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get trades for a specific run."""
    await trading_service.get_run(db, run_id, current_user.id)
    return await trading_service.get_run_trades(db, run_id)


@router.get("/sessions/{session_id}/runs/{run_id}/orders", response_model=list[OrderResponse])
async def get_run_orders(
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get orders for a specific run."""
    await trading_service.get_run(db, run_id, current_user.id)
    return await trading_service.get_run_orders(db, run_id)


@router.get("/sessions/{session_id}/runs/{run_id}/logs")
async def get_run_logs(
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get logs for a specific run."""
    await trading_service.get_run(db, run_id, current_user.id)
    logs = await trading_service.get_run_logs(db, run_id)
    return [
        {
            "id": str(log.id),
            "timestamp": log.created_at.isoformat(),
            "level": log.level,
            "source": log.source,
            "message": log.message,
        }
        for log in logs
    ]
