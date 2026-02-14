from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services import platform_service
from app.exceptions import ForbiddenException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/admin", tags=["Admin"])


class TradingModeRequest(BaseModel):
    mode: str = Field(..., pattern=r"^(test|live)$")


class PlatformStatusResponse(BaseModel):
    platform_trading_mode: str
    total_users: int
    users_in_live_mode: int
    users_in_test_mode: int


class UserTradingModeResponse(BaseModel):
    user_id: str
    email: str
    trading_mode: str
    platform_trading_mode: str
    can_trade_live: bool
    reason: str | None = None


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    if not user.is_superadmin:
        raise ForbiddenException("Super admin access required")
    return user


@router.get("/platform/status", response_model=PlatformStatusResponse)
async def get_platform_status(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    settings = await platform_service.get_platform_settings(db)
    result = await db.execute(select(User).where(User.is_active == True))
    users = list(result.scalars().all())

    return PlatformStatusResponse(
        platform_trading_mode=settings.trading_mode,
        total_users=len(users),
        users_in_live_mode=sum(1 for u in users if u.trading_mode == "live"),
        users_in_test_mode=sum(1 for u in users if u.trading_mode == "test"),
    )


@router.post("/platform/trading-mode")
async def set_platform_trading_mode(
    data: TradingModeRequest,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Set platform-wide trading mode. When set to 'test', NO client can place live trades."""
    settings = await platform_service.set_platform_trading_mode(db, admin, data.mode)
    return {
        "message": f"Platform trading mode set to '{settings.trading_mode}'",
        "trading_mode": settings.trading_mode,
    }


@router.post("/users/{user_id}/trading-mode")
async def set_user_trading_mode_admin(
    user_id: str,
    data: TradingModeRequest,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Admin override: set a specific client's trading mode."""
    import uuid
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    target_user = result.scalar_one_or_none()
    if not target_user:
        from app.exceptions import NotFoundException
        raise NotFoundException("User not found")

    updated = await platform_service.set_user_trading_mode(db, target_user, data.mode)
    return {
        "message": f"User {updated.email} trading mode set to '{updated.trading_mode}'",
        "user_id": str(updated.id),
        "trading_mode": updated.trading_mode,
    }


@router.get("/users", response_model=list[UserTradingModeResponse])
async def list_users_with_trading_mode(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """List all users with their trading mode and live trading eligibility."""
    settings = await platform_service.get_platform_settings(db)
    result = await db.execute(select(User).where(User.is_active == True))
    users = list(result.scalars().all())

    response = []
    for user in users:
        live_check = await platform_service.can_trade_live(db, user)
        response.append(UserTradingModeResponse(
            user_id=str(user.id),
            email=user.email,
            trading_mode=user.trading_mode,
            platform_trading_mode=settings.trading_mode,
            can_trade_live=live_check["allowed"],
            reason=live_check["reason"],
        ))
    return response


@router.post("/instruments/refresh")
async def refresh_instruments(
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Refresh instrument list from Kite Connect (requires admin's Kite connection)."""
    from app.integrations.kite_connect.client import kite_manager
    from app.services import market_data_service

    kite_client = await kite_manager.get_client(db, str(admin.id))
    if not kite_client:
        from app.exceptions import BadRequestException
        raise BadRequestException(
            "Connect your Kite account first. Go to Settings > Connect Broker."
        )

    count = await market_data_service.refresh_instruments_from_kite(db, kite_client)
    return {"message": f"Refreshed {count} instruments from Kite Connect", "count": count}
