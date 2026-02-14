import logging
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.tasks.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)


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
            from datetime import datetime as dt

            start_dt = datetime.combine(backtest.start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
            end_dt = datetime.combine(backtest.end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

            # Map interval names
            interval = backtest.timeframe

            ohlcv_records = []
            for symbol_str in backtest.instruments:
                # symbol_str could be "RELIANCE" or "NSE:RELIANCE"
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

            # Run backtest
            config = {
                "start_date": backtest.start_date,
                "end_date": backtest.end_date,
                "initial_capital": float(backtest.initial_capital),
                "timeframe": backtest.timeframe,
                "instruments": backtest.instruments,
                "parameters": backtest.parameters,
            }

            # Progress callback for Socket.IO updates
            async def progress_callback(current_bar: int, total_bars: int):
                percent = (current_bar / total_bars) * 100
                current_date = ""
                try:
                    if runner.data_handler and runner.data_handler.current_timestamp:
                        ts = runner.data_handler.current_timestamp
                        current_date = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)
                except Exception:
                    pass

                try:
                    from app.websocket.server import emit_backtest_progress
                    await emit_backtest_progress(str(backtest.id), percent, current_date)
                except Exception:
                    pass  # Socket.IO may not be running in Celery worker

            runner = BacktestRunner(str(backtest.id), strategy.code, config)
            results = await runner.run(ohlcv_records, progress_callback=progress_callback)

            # Metrics are nested under "metrics" key in the runner output
            metrics = results.get("metrics", {})

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
                equity_curve=results.get("equity_curve"),
                drawdown_curve=results.get("drawdown_curve"),
            )
            await db.commit()

            # Emit completion via Socket.IO
            try:
                from app.websocket.server import emit_backtest_completed
                await emit_backtest_completed(str(backtest.id), {
                    "total_return": metrics.get("total_return"),
                    "sharpe_ratio": metrics.get("sharpe_ratio"),
                    "total_trades": metrics.get("total_trades"),
                })
            except Exception:
                pass

            logger.info(f"Backtest {backtest_id} completed successfully")

        except Exception as e:
            logger.error(f"Backtest {backtest_id} failed: {e}")
            try:
                await update_backtest_status(
                    db, backtest.id, "failed", error_message=str(e)
                )
                await db.commit()
            except Exception:
                pass
            try:
                from app.websocket.server import emit_backtest_error
                await emit_backtest_error(str(backtest.id), str(e))
            except Exception:
                pass


@celery_app.task(bind=True, name="run_backtest", max_retries=0)
def run_backtest(self, backtest_id: str):
    """Celery task to run a backtest."""
    logger.info(f"Starting backtest {backtest_id}")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run_backtest(backtest_id))
    finally:
        loop.close()
