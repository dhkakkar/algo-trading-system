"""Async session logger — persists per-session log entries to the DB.

Usage:
    from app.services.session_logger import SessionLogger

    slog = SessionLogger(session_id, db_session_factory)
    slog.info("Strategy initialized", source="strategy")
    slog.warning("Order rejected", source="runner")
    slog.error("on_data crashed", source="runner")
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

logger = logging.getLogger(__name__)


class SessionLogger:
    """Fire-and-forget async logger that writes to the session_logs table."""

    def __init__(self, session_id: str, db_session_factory=None):
        self.session_id = session_id
        self._db_factory = db_session_factory
        self._buffer: list[dict] = []
        self._python_logger = logging.getLogger(f"session.{session_id[:8]}")

    def _log(self, level: str, message: str, source: str = "system"):
        """Buffer a log entry and schedule async DB write."""
        self._python_logger.log(
            getattr(logging, level.upper(), logging.INFO), "[%s] %s", source, message
        )
        entry = {
            "level": level.upper(),
            "source": source,
            "message": message,
            "timestamp": datetime.now(timezone.utc),
        }
        self._buffer.append(entry)
        if self._db_factory:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._persist(entry))
            except RuntimeError:
                pass  # No running loop — skip DB persist

    def info(self, message: str, source: str = "system"):
        self._log("INFO", message, source)

    def warning(self, message: str, source: str = "system"):
        self._log("WARNING", message, source)

    def error(self, message: str, source: str = "system"):
        self._log("ERROR", message, source)

    def get_logs(self) -> list[dict]:
        """Return all buffered logs (for in-memory access while session is running)."""
        return list(self._buffer)

    async def _persist(self, entry: dict):
        """Write a single log entry to the DB."""
        try:
            from app.models.session_log import SessionLog
            async with self._db_factory() as db:
                log_entry = SessionLog(
                    trading_session_id=UUID(self.session_id),
                    level=entry["level"],
                    source=entry["source"],
                    message=entry["message"],
                )
                db.add(log_entry)
                await db.commit()
        except Exception as exc:
            logger.debug("Failed to persist session log: %s", exc)
