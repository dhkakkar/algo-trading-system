import logging
from datetime import datetime, timezone
from kiteconnect import KiteConnect
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.broker_connection import BrokerConnection
from app.schemas.broker import BrokerConnectRequest, BrokerCallbackRequest, BrokerStatusResponse
from app.integrations.kite_connect.client import kite_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/broker", tags=["Broker"])


@router.get("/status", response_model=BrokerStatusResponse)
async def get_broker_status(
    validate: bool = Query(False, description="Validate token with a live API call"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.broker == "zerodha",
        )
    )
    connection = result.scalar_one_or_none()

    if not connection or not connection.access_token:
        login_url = None
        if connection and connection.api_key:
            login_url = kite_manager.generate_login_url(connection.api_key)
        return BrokerStatusResponse(
            connected=False,
            token_valid=False,
            api_key=connection.api_key if connection else None,
            login_url=login_url,
        )

    # Check if token_expiry is set and has passed
    token_expired = False
    if connection.token_expiry:
        token_expired = connection.token_expiry < datetime.now(timezone.utc)

    # Optionally validate with a live API call
    token_valid = not token_expired
    if validate:
        try:
            kite = KiteConnect(api_key=connection.api_key)
            kite.set_access_token(connection.access_token)
            kite.profile()  # Simple API call to verify token
            token_valid = True
            # Recalculate and persist expiry on successful validation
            fresh_expiry = kite_manager._calc_token_expiry()
            if connection.token_expiry != fresh_expiry:
                connection.token_expiry = fresh_expiry
                await db.flush()
        except Exception as e:
            logger.warning(f"Kite token validation failed for user {current_user.id}: {e}")
            token_valid = False

    login_url = None
    if not token_valid and connection.api_key:
        login_url = kite_manager.generate_login_url(connection.api_key)

    return BrokerStatusResponse(
        connected=True,
        token_valid=token_valid,
        api_key=connection.api_key,
        token_expiry=connection.token_expiry,
        login_url=login_url,
    )


@router.post("/connect")
async def connect_broker(
    data: BrokerConnectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store API key and secret, return login URL."""
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.broker == "zerodha",
        )
    )
    connection = result.scalar_one_or_none()

    if connection:
        connection.api_key = data.api_key
        connection.api_secret_enc = kite_manager._encrypt(data.api_secret)
    else:
        connection = BrokerConnection(
            user_id=current_user.id,
            broker="zerodha",
            api_key=data.api_key,
            api_secret_enc=kite_manager._encrypt(data.api_secret),
        )
        db.add(connection)

    await db.flush()

    login_url = kite_manager.generate_login_url(data.api_key)
    return {"message": "Broker credentials saved", "login_url": login_url}


@router.post("/callback")
async def broker_callback(
    data: BrokerCallbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exchange request_token for access_token after Kite login."""
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.broker == "zerodha",
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        from app.exceptions import BadRequestException
        raise BadRequestException("No broker connection found. Call /connect first.")

    api_secret = kite_manager._decrypt(connection.api_secret_enc)
    access_token = await kite_manager.complete_auth(
        db, current_user.id, connection.api_key, api_secret, data.request_token
    )

    return {"message": "Broker connected successfully", "connected": True}


@router.post("/disconnect")
async def disconnect_broker(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.broker == "zerodha",
        )
    )
    connection = result.scalar_one_or_none()
    if connection:
        connection.access_token = None
        connection.is_active = False
        kite_manager.invalidate_client(str(current_user.id))

    return {"message": "Broker disconnected"}
