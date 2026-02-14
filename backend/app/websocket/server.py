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
    backtest_id = data.get("backtest_id")
    if backtest_id:
        room = f"backtest_{backtest_id}"
        sio.enter_room(sid, room)
        logger.info(f"Client {sid} subscribed to backtest {backtest_id}")


@sio.on("unsubscribe_backtest")
async def unsubscribe_backtest(sid, data):
    backtest_id = data.get("backtest_id")
    if backtest_id:
        room = f"backtest_{backtest_id}"
        sio.leave_room(sid, room)


# ── Trading namespace ──

@sio.on("subscribe_trading")
async def subscribe_trading(sid, data):
    """Subscribe to trading session updates for a user."""
    user_id = data.get("user_id")
    if user_id:
        room = f"user_{user_id}"
        sio.enter_room(sid, room)
        logger.info(f"Client {sid} subscribed to trading updates for user {user_id}")


@sio.on("unsubscribe_trading")
async def unsubscribe_trading(sid, data):
    user_id = data.get("user_id")
    if user_id:
        room = f"user_{user_id}"
        sio.leave_room(sid, room)


@sio.on("subscribe_session")
async def subscribe_session(sid, data):
    """Subscribe to a specific trading session's updates."""
    session_id = data.get("session_id")
    if session_id:
        room = f"session_{session_id}"
        sio.enter_room(sid, room)
        logger.info(f"Client {sid} subscribed to session {session_id}")


@sio.on("unsubscribe_session")
async def unsubscribe_session(sid, data):
    session_id = data.get("session_id")
    if session_id:
        room = f"session_{session_id}"
        sio.leave_room(sid, room)


# ── Helper functions for emitting events ──

async def emit_backtest_progress(backtest_id: str, percent: float, current_date: str):
    """Emit backtest progress to subscribed clients."""
    await sio.emit(
        "backtest_progress",
        {"backtest_id": backtest_id, "percent": percent, "current_date": current_date},
        room=f"backtest_{backtest_id}",
    )


async def emit_backtest_completed(backtest_id: str, summary: dict):
    """Emit backtest completion to subscribed clients."""
    await sio.emit(
        "backtest_completed",
        {"backtest_id": backtest_id, "status": "completed", "summary": summary},
        room=f"backtest_{backtest_id}",
    )


async def emit_backtest_error(backtest_id: str, error: str):
    """Emit backtest error to subscribed clients."""
    await sio.emit(
        "backtest_error",
        {"backtest_id": backtest_id, "status": "failed", "error": error},
        room=f"backtest_{backtest_id}",
    )


async def emit_trading_update(user_id: str, event_type: str, data: dict):
    """Emit trading updates (positions, orders, P&L) to a specific user."""
    await sio.emit(
        event_type,
        data,
        room=f"user_{user_id}",
    )


async def emit_session_update(session_id: str, data: dict):
    """Emit trading session snapshot to clients watching a specific session."""
    await sio.emit(
        "session_update",
        data,
        room=f"session_{session_id}",
    )


async def emit_order_update(user_id: str, order_data: dict):
    """Emit order fill/status change to user."""
    await sio.emit(
        "order_update",
        order_data,
        room=f"user_{user_id}",
    )
