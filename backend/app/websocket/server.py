import logging
import socketio
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Create Socket.IO async server
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_origin_list,
    logger=False,
    engineio_logger=False,
)

# Create ASGI app
socket_app = socketio.ASGIApp(sio, socketio_path="socket.io")


# ── Connection handlers ──

@sio.event
async def connect(sid, environ, auth):
    """Handle new WebSocket connections."""
    logger.info(f"Client connected: {sid}")
    # TODO: validate JWT from auth dict in Phase 4
    await sio.emit("connected", {"message": "Connected to AlgoTrader"}, room=sid)


@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")


# ── Backtest namespace ──

@sio.on("subscribe_backtest")
async def subscribe_backtest(sid, data):
    """Subscribe to backtest progress updates."""
    try:
        backtest_id = data.get("backtest_id")
        if backtest_id:
            room = f"backtest_{backtest_id}"
            sio.enter_room(sid, room)
            logger.info(f"Client {sid} subscribed to backtest {backtest_id}")
    except Exception as e:
        logger.error(f"Error in subscribe_backtest for {sid}: {e}", exc_info=True)
        await sio.emit("error", {"message": "Failed to subscribe to backtest updates"}, room=sid)


@sio.on("unsubscribe_backtest")
async def unsubscribe_backtest(sid, data):
    try:
        backtest_id = data.get("backtest_id")
        if backtest_id:
            room = f"backtest_{backtest_id}"
            sio.leave_room(sid, room)
    except Exception as e:
        logger.error(f"Error in unsubscribe_backtest for {sid}: {e}", exc_info=True)


# ── Trading namespace ──

@sio.on("subscribe_trading")
async def subscribe_trading(sid, data):
    """Subscribe to trading session updates for a user."""
    try:
        user_id = data.get("user_id")
        if user_id:
            room = f"user_{user_id}"
            sio.enter_room(sid, room)
            logger.info(f"Client {sid} subscribed to trading updates for user {user_id}")
    except Exception as e:
        logger.error(f"Error in subscribe_trading for {sid}: {e}", exc_info=True)
        await sio.emit("error", {"message": "Failed to subscribe to trading updates"}, room=sid)


@sio.on("unsubscribe_trading")
async def unsubscribe_trading(sid, data):
    try:
        user_id = data.get("user_id")
        if user_id:
            room = f"user_{user_id}"
            sio.leave_room(sid, room)
    except Exception as e:
        logger.error(f"Error in unsubscribe_trading for {sid}: {e}", exc_info=True)


@sio.on("subscribe_session")
async def subscribe_session(sid, data):
    """Subscribe to a specific trading session's updates."""
    try:
        session_id = data.get("session_id")
        if session_id:
            room = f"session_{session_id}"
            sio.enter_room(sid, room)
            logger.info(f"Client {sid} subscribed to session {session_id}")
    except Exception as e:
        logger.error(f"Error in subscribe_session for {sid}: {e}", exc_info=True)
        await sio.emit("error", {"message": "Failed to subscribe to session updates"}, room=sid)


@sio.on("unsubscribe_session")
async def unsubscribe_session(sid, data):
    try:
        session_id = data.get("session_id")
        if session_id:
            room = f"session_{session_id}"
            sio.leave_room(sid, room)
    except Exception as e:
        logger.error(f"Error in unsubscribe_session for {sid}: {e}", exc_info=True)


# ── Helper functions for emitting events ──

async def emit_backtest_progress(backtest_id: str, percent: float, current_date: str):
    """Emit backtest progress to subscribed clients."""
    try:
        await sio.emit(
            "backtest_progress",
            {"backtest_id": backtest_id, "percent": percent, "current_date": current_date},
            room=f"backtest_{backtest_id}",
        )
    except Exception as e:
        logger.error(f"Error emitting backtest_progress for {backtest_id}: {e}", exc_info=True)


async def emit_backtest_completed(backtest_id: str, summary: dict):
    """Emit backtest completion to subscribed clients."""
    try:
        await sio.emit(
            "backtest_completed",
            {"backtest_id": backtest_id, "status": "completed", "summary": summary},
            room=f"backtest_{backtest_id}",
        )
    except Exception as e:
        logger.error(f"Error emitting backtest_completed for {backtest_id}: {e}", exc_info=True)


async def emit_backtest_error(backtest_id: str, error: str):
    """Emit backtest error to subscribed clients."""
    try:
        await sio.emit(
            "backtest_error",
            {"backtest_id": backtest_id, "status": "failed", "error": error},
            room=f"backtest_{backtest_id}",
        )
    except Exception as e:
        logger.error(f"Error emitting backtest_error for {backtest_id}: {e}", exc_info=True)


async def emit_trading_update(user_id: str, event_type: str, data: dict):
    """Emit trading updates (positions, orders, P&L) to a specific user."""
    try:
        await sio.emit(
            event_type,
            data,
            room=f"user_{user_id}",
        )
    except Exception as e:
        logger.error(f"Error emitting {event_type} for user {user_id}: {e}", exc_info=True)


async def emit_session_update(session_id: str, data: dict):
    """Emit trading session snapshot to clients watching a specific session."""
    try:
        await sio.emit(
            "session_update",
            data,
            room=f"session_{session_id}",
        )
    except Exception as e:
        logger.error(f"Error emitting session_update for {session_id}: {e}", exc_info=True)


async def emit_order_update(user_id: str, order_data: dict):
    """Emit order fill/status change to user."""
    try:
        await sio.emit(
            "order_update",
            order_data,
            room=f"user_{user_id}",
        )
    except Exception as e:
        logger.error(f"Error emitting order_update for user {user_id}: {e}", exc_info=True)
