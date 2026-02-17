import logging
import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.tasks.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)

# Module-level ref so progress callback can update Celery task state
_current_celery_task = None


def get_async_session():
    """Create a standalone async session for Celery workers."""
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_size=5)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _run_backtest(backtest_id: str):
    """Async implementation of backtest execution."""
    from app.models.backtest import Backtest
    from app.models.strategy import Strategy
    from app.models.market_data import OHLCVData
    from app.services.backtest_service import update_backtest_status
    from app.engine.backtest.runner import BacktestRunner

    session_factory = get_async_session()

    async with session_factory() as db:
        try:
            # Load backtest
            result = await db.execute(
                select(Backtest).where(Backtest.id == backtest_id)
            )
            backtest = result.scalar_one_or_none()
            if not backtest:
                logger.error(f"Backtest {backtest_id} not found")
                return

            # Mark as running
            await update_backtest_status(db, backtest.id, "running")
            await db.commit()

            # Load strategy code
            result = await db.execute(
                select(Strategy).where(Strategy.id == backtest.strategy_id)
            )
            strategy = result.scalar_one_or_none()
            if not strategy:
                await update_backtest_status(
                    db, backtest.id, "failed", error_message="Strategy not found"
                )
                await db.commit()
                return

            # Load OHLCV data for all instruments
            start_dt = datetime.combine(backtest.start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
            end_dt = datetime.combine(backtest.end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

            interval = backtest.timeframe

            ohlcv_records = []
            for symbol_str in backtest.instruments:
                parts = symbol_str.split(":") if ":" in symbol_str else ["NSE", symbol_str]
                exchange = parts[0] if len(parts) > 1 else "NSE"
                symbol = parts[-1]

                result = await db.execute(
                    select(OHLCVData).where(
                        and_(
                            OHLCVData.tradingsymbol == symbol.upper(),
                            OHLCVData.exchange == exchange.upper(),
                            OHLCVData.interval == interval,
                            OHLCVData.time >= start_dt,
                            OHLCVData.time <= end_dt,
                        )
                    ).order_by(OHLCVData.time.asc())
                )
                records = list(result.scalars().all())
                ohlcv_records.extend(records)

            if not ohlcv_records:
                await update_backtest_status(
                    db, backtest.id, "failed",
                    error_message="No market data found for the specified instruments and date range"
                )
                await db.commit()
                return

            # --- Auto-detect index underlyings and pre-fetch options data ---
            params = backtest.parameters or {}
            options_handler = None

            # Detect if any instrument is an index that commonly trades options
            _INDEX_UNDERLYINGS = {"NIFTY 50", "NIFTY", "BANKNIFTY"}
            _needs_options = any(
                (s.split(":")[-1] if ":" in s else s).upper() in _INDEX_UNDERLYINGS
                for s in backtest.instruments
            )

            if _needs_options:
                from app.models.instrument import Instrument
                from app.engine.backtest.options_handler import OptionsHandler
                from app.services.options_service import (
                    underlying_name_from_symbol, strike_step_for_underlying,
                    get_atm_strike,
                )
                from app.services.market_data_service import fetch_and_store_from_kite
                import pandas as pd

                options_handler = OptionsHandler()
                raw_sym = backtest.instruments[0]
                clean_sym = raw_sym.split(":")[-1] if ":" in raw_sym else raw_sym
                underlying_name = underlying_name_from_symbol(clean_sym)
                step = strike_step_for_underlying(underlying_name)
                options_handler.set_underlying(backtest.instruments, strike_step=step)

                # Try to get Kite client for fetching missing data
                kite_client = None
                try:
                    from app.integrations.kite_connect.client import kite_manager
                    kite_client = await kite_manager.get_client(db, str(backtest.user_id))
                except Exception as exc:
                    logger.warning("Could not get Kite client for options data: %s", exc)

                # Load option instruments from DB
                opt_instruments_result = await db.execute(
                    select(Instrument).where(
                        and_(
                            Instrument.name == underlying_name,
                            Instrument.exchange == "NFO",
                            Instrument.instrument_type.in_(["CE", "PE"]),
                            Instrument.expiry >= backtest.start_date,
                            Instrument.expiry <= backtest.end_date + timedelta(days=7),
                            Instrument.strike.isnot(None),
                        )
                    )
                )
                opt_instruments = list(opt_instruments_result.scalars().all())

                if not opt_instruments:
                    logger.info("No option instruments found for %s — options data unavailable", underlying_name)
                    options_handler = None
                else:
                    # Filter to relevant strikes based on underlying price range
                    spot_prices = [float(r.close) for r in ohlcv_records if hasattr(r, "close")]
                    min_spot = min(spot_prices) if spot_prices else 23000
                    max_spot = max(spot_prices) if spot_prices else 23000
                    min_strike = get_atm_strike(min_spot, step) - (5 * step)
                    max_strike = get_atm_strike(max_spot, step) + (5 * step)

                    relevant_instruments = [
                        inst for inst in opt_instruments
                        if inst.strike is not None
                        and float(inst.strike) >= min_strike
                        and float(inst.strike) <= max_strike
                    ]

                    inst_dicts = [
                        {
                            "tradingsymbol": inst.tradingsymbol,
                            "strike": float(inst.strike),
                            "expiry": inst.expiry,
                            "instrument_type": inst.instrument_type,
                            "instrument_token": inst.instrument_token,
                            "lot_size": inst.lot_size,
                        }
                        for inst in relevant_instruments
                    ]
                    options_handler.load_instruments(inst_dicts)

                    # Fetch options OHLCV data
                    kite_interval = {"1m": "minute", "3m": "3minute", "5m": "5minute",
                                     "10m": "10minute", "15m": "15minute", "30m": "30minute",
                                     "1h": "60minute", "1d": "day"}.get(backtest.timeframe, "5minute")

                    options_ohlcv: dict[str, pd.DataFrame] = {}
                    tokens_to_fetch: list[tuple[int, str, str]] = []

                    for inst in relevant_instruments:
                        tsymbol = inst.tradingsymbol
                        existing = await db.execute(
                            select(OHLCVData).where(
                                and_(
                                    OHLCVData.instrument_token == inst.instrument_token,
                                    OHLCVData.interval == interval,
                                    OHLCVData.time >= start_dt,
                                    OHLCVData.time <= end_dt,
                                )
                            ).order_by(OHLCVData.time.asc()).limit(1)
                        )
                        if existing.scalar_one_or_none():
                            data_result = await db.execute(
                                select(OHLCVData).where(
                                    and_(
                                        OHLCVData.instrument_token == inst.instrument_token,
                                        OHLCVData.interval == interval,
                                        OHLCVData.time >= start_dt,
                                        OHLCVData.time <= end_dt,
                                    )
                                ).order_by(OHLCVData.time.asc())
                            )
                            records = list(data_result.scalars().all())
                            if records:
                                rows = [{
                                    "open": float(r.open), "high": float(r.high),
                                    "low": float(r.low), "close": float(r.close),
                                    "volume": int(r.volume), "timestamp": r.time,
                                } for r in records]
                                df = pd.DataFrame(rows).set_index("timestamp").sort_index()
                                options_ohlcv[tsymbol] = df
                        else:
                            tokens_to_fetch.append((inst.instrument_token, tsymbol, "NFO"))

                    # Fetch missing data from Kite
                    if tokens_to_fetch and kite_client:
                        logger.info("Fetching options OHLCV for %d instruments from Kite", len(tokens_to_fetch))
                        for token, tsymbol, exchange in tokens_to_fetch:
                            try:
                                count = await fetch_and_store_from_kite(
                                    db, kite_client, token, tsymbol, exchange,
                                    backtest.start_date, backtest.end_date, kite_interval,
                                )
                                if count > 0:
                                    data_result = await db.execute(
                                        select(OHLCVData).where(
                                            and_(
                                                OHLCVData.instrument_token == token,
                                                OHLCVData.interval == interval,
                                                OHLCVData.time >= start_dt,
                                                OHLCVData.time <= end_dt,
                                            )
                                        ).order_by(OHLCVData.time.asc())
                                    )
                                    records = list(data_result.scalars().all())
                                    if records:
                                        rows = [{
                                            "open": float(r.open), "high": float(r.high),
                                            "low": float(r.low), "close": float(r.close),
                                            "volume": int(r.volume), "timestamp": r.time,
                                        } for r in records]
                                        df = pd.DataFrame(rows).set_index("timestamp").sort_index()
                                        options_ohlcv[tsymbol] = df
                                await db.commit()
                            except Exception as exc:
                                logger.warning("Failed to fetch options data for %s: %s", tsymbol, exc)

                    options_handler.load_ohlcv(options_ohlcv)
                    logger.info("Options data ready: %d symbols with OHLCV", len(options_ohlcv))

            # Run backtest
            config = {
                "start_date": backtest.start_date,
                "end_date": backtest.end_date,
                "initial_capital": float(backtest.initial_capital),
                "timeframe": backtest.timeframe,
                "instruments": backtest.instruments,
                "parameters": params,
                "slippage_percent": float(params.get("slippage_percent", 0.05)),
                "commission_type": params.get("commission_type", "zerodha"),
                "flat_commission": float(params.get("flat_commission", 0.0)),
                "fill_at": params.get("fill_at", "next_open"),
            }

            # Progress callback — updates Celery task state (stored in Redis)
            _last_update = {"percent": 0}

            async def progress_callback(current_bar: int, total_bars: int):
                percent = (current_bar / total_bars) * 100
                # Throttle: only update every 2% or on final bar
                if percent - _last_update["percent"] < 2 and current_bar < total_bars:
                    return
                _last_update["percent"] = percent

                current_date = ""
                try:
                    if runner.data_handler and runner.data_handler.current_timestamp:
                        ts = runner.data_handler.current_timestamp
                        current_date = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)
                except Exception:
                    pass

                if _current_celery_task:
                    try:
                        _current_celery_task.update_state(
                            state="PROGRESS",
                            meta={
                                "percent": round(percent, 1),
                                "current_date": current_date,
                                "backtest_id": backtest_id,
                            },
                        )
                    except Exception:
                        pass

            runner = BacktestRunner(str(backtest.id), strategy.code, config,
                                    options_handler=options_handler)
            results = await runner.run(ohlcv_records, progress_callback=progress_callback)

            # Metrics are nested under "metrics" key in the runner output
            metrics = results.get("metrics", {})

            # Transform equity_curve
            raw_equity = results.get("equity_curve") or []
            equity_curve = []
            for pt in raw_equity:
                ts = pt.get("timestamp", "")
                equity_curve.append({"date": str(ts), "value": pt.get("equity", 0)})

            # Transform drawdown_curve
            raw_drawdown = results.get("drawdown_curve") or []
            drawdown_curve = []
            for pt in raw_drawdown:
                ts = pt.get("timestamp", "")
                drawdown_curve.append({"date": str(ts), "drawdown": pt.get("drawdown_percent", 0)})

            # Store results
            await update_backtest_status(
                db, backtest.id, "completed",
                total_return=metrics.get("total_return"),
                cagr=metrics.get("cagr"),
                sharpe_ratio=metrics.get("sharpe_ratio"),
                sortino_ratio=metrics.get("sortino_ratio"),
                max_drawdown=metrics.get("max_drawdown"),
                win_rate=metrics.get("win_rate"),
                profit_factor=metrics.get("profit_factor"),
                total_trades=metrics.get("total_trades"),
                avg_trade_pnl=metrics.get("avg_trade_pnl"),
                equity_curve=equity_curve,
                drawdown_curve=drawdown_curve,
                logs=results.get("logs", []),
            )

            # Save trades to Trade table
            from app.models.trade import Trade as TradeModel
            from dateutil.parser import parse as parse_dt

            raw_trades = results.get("trades") or []
            trade_records = []
            for t in raw_trades:
                entry_at = t.get("entry_at")
                if isinstance(entry_at, str):
                    entry_at = parse_dt(entry_at)
                exit_at = t.get("exit_at")
                if isinstance(exit_at, str):
                    exit_at = parse_dt(exit_at)

                trade_records.append(TradeModel(
                    user_id=backtest.user_id,
                    backtest_id=backtest.id,
                    tradingsymbol=t.get("symbol", ""),
                    exchange=t.get("exchange", "NSE"),
                    side=t.get("side", "LONG"),
                    quantity=int(t.get("quantity", 0)),
                    entry_price=float(t.get("entry_price", 0)),
                    exit_price=float(t.get("exit_price", 0)) if t.get("exit_price") is not None else None,
                    pnl=float(t.get("pnl", 0)) if t.get("pnl") is not None else None,
                    pnl_percent=float(t.get("pnl_percent", 0)) if t.get("pnl_percent") is not None else None,
                    charges=float(t.get("charges", 0)),
                    net_pnl=float(t.get("net_pnl", 0)) if t.get("net_pnl") is not None else None,
                    mode="backtest",
                    entry_at=entry_at,
                    exit_at=exit_at,
                    created_at=datetime.now(timezone.utc),
                ))
            if trade_records:
                db.add_all(trade_records)

            await db.commit()
            logger.info(f"Backtest {backtest_id} completed successfully")

        except Exception as e:
            logger.error(f"Backtest {backtest_id} failed: {e}")
            try:
                await db.rollback()
                await update_backtest_status(
                    db, backtest.id, "failed", error_message=str(e)
                )
                await db.commit()
            except Exception:
                pass


@celery_app.task(bind=True, name="run_backtest", max_retries=0)
def run_backtest(self, backtest_id: str):
    """Celery task to run a backtest."""
    global _current_celery_task
    _current_celery_task = self
    logger.info(f"Starting backtest {backtest_id}")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run_backtest(backtest_id))
    finally:
        _current_celery_task = None
        loop.close()
