"""Kite Connect client management for per-user API access."""

import logging
from datetime import datetime, timezone, timedelta
from kiteconnect import KiteConnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from cryptography.fernet import Fernet
from app.config import get_settings
from app.models.broker_connection import BrokerConnection

logger = logging.getLogger(__name__)
settings = get_settings()


class KiteClientManager:
    """Manages per-user KiteConnect instances."""

    def __init__(self):
        self._clients: dict[str, KiteConnect] = {}
        self._fernet = None
        if settings.encryption_key:
            try:
                self._fernet = Fernet(settings.encryption_key.encode())
            except Exception:
                logger.warning("Invalid encryption key, broker secrets won't be encrypted")

    def _encrypt(self, text: str) -> str:
        if self._fernet:
            return self._fernet.encrypt(text.encode()).decode()
        return text

    def _decrypt(self, text: str) -> str:
        if self._fernet:
            return self._fernet.decrypt(text.encode()).decode()
        return text

    async def get_client(self, db: AsyncSession, user_id: str) -> KiteConnect | None:
        """Get or create a KiteConnect client for a user."""
        if user_id in self._clients:
            return self._clients[user_id]

        result = await db.execute(
            select(BrokerConnection).where(
                BrokerConnection.user_id == user_id,
                BrokerConnection.broker == "zerodha",
                BrokerConnection.is_active == True,
            )
        )
        connection = result.scalar_one_or_none()
        if not connection or not connection.access_token:
            return None

        kite = KiteConnect(api_key=connection.api_key)
        kite.set_access_token(connection.access_token)
        self._clients[user_id] = kite
        return kite

    def generate_login_url(self, api_key: str) -> str:
        """Generate the Kite Connect login URL."""
        kite = KiteConnect(api_key=api_key)
        return kite.login_url()

    @staticmethod
    def _calc_token_expiry() -> datetime:
        """Kite tokens expire at 6:00 AM IST (00:30 UTC) the next day."""
        now = datetime.now(timezone.utc)
        ist = timezone(timedelta(hours=5, minutes=30))
        now_ist = now.astimezone(ist)
        # Next day at 6:00 AM IST
        expiry_ist = now_ist.replace(hour=6, minute=0, second=0, microsecond=0) + timedelta(days=1)
        return expiry_ist.astimezone(timezone.utc)

    async def complete_auth(
        self, db: AsyncSession, user_id: str, api_key: str, api_secret: str, request_token: str
    ) -> str:
        """Exchange request_token for access_token and store."""
        kite = KiteConnect(api_key=api_key)
        data = kite.generate_session(request_token, api_secret=api_secret)
        access_token = data["access_token"]
        token_expiry = self._calc_token_expiry()

        # Upsert broker connection
        result = await db.execute(
            select(BrokerConnection).where(
                BrokerConnection.user_id == user_id,
                BrokerConnection.broker == "zerodha",
            )
        )
        connection = result.scalar_one_or_none()

        if connection:
            connection.api_key = api_key
            connection.api_secret_enc = self._encrypt(api_secret)
            connection.access_token = access_token
            connection.token_expiry = token_expiry
            connection.is_active = True
        else:
            connection = BrokerConnection(
                user_id=user_id,
                broker="zerodha",
                api_key=api_key,
                api_secret_enc=self._encrypt(api_secret),
                access_token=access_token,
                token_expiry=token_expiry,
                is_active=True,
            )
            db.add(connection)

        await db.flush()

        # Cache client
        kite.set_access_token(access_token)
        self._clients[str(user_id)] = kite

        return access_token

    def invalidate_client(self, user_id: str):
        """Remove cached client (e.g., on token expiry)."""
        self._clients.pop(str(user_id), None)


# Singleton
kite_manager = KiteClientManager()
