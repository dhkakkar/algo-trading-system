import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.platform_settings import PlatformSettings
from app.models.user import User
from app.exceptions import ForbiddenException, BadRequestException

logger = logging.getLogger(__name__)

VALID_MODES = {"test", "live"}


async def get_platform_settings(db: AsyncSession) -> PlatformSettings:
    """Get or create platform settings (single row)."""
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = PlatformSettings(id=1, trading_mode="test")
        db.add(settings)
        await db.flush()
        await db.refresh(settings)
    return settings


async def set_platform_trading_mode(
    db: AsyncSession, admin_user: User, mode: str
) -> PlatformSettings:
    """Set platform-wide trading mode. Only super admin can do this."""
    if not admin_user.is_superadmin:
        raise ForbiddenException("Only super admin can change platform trading mode")
    if mode not in VALID_MODES:
        raise BadRequestException(f"Invalid mode. Must be one of: {VALID_MODES}")

    settings = await get_platform_settings(db)
    settings.trading_mode = mode
    db.add(settings)
    await db.flush()
    await db.refresh(settings)

    logger.info(f"Platform trading mode set to '{mode}' by admin {admin_user.email}")
    return settings


async def set_user_trading_mode(
    db: AsyncSession, user: User, mode: str
) -> User:
    """Set per-client trading mode."""
    if mode not in VALID_MODES:
        raise BadRequestException(f"Invalid mode. Must be one of: {VALID_MODES}")

    user.trading_mode = mode
    db.add(user)
    await db.flush()
    await db.refresh(user)

    logger.info(f"User {user.email} trading mode set to '{mode}'")
    return user


async def can_trade_live(db: AsyncSession, user: User) -> dict:
    """
    Check if a user is allowed to place live trades.
    Returns {"allowed": bool, "reason": str | None}

    Rules:
    1. Platform must be in 'live' mode (super admin control)
    2. User's own trading_mode must be 'live'
    """
    platform = await get_platform_settings(db)

    if platform.trading_mode != "live":
        return {
            "allowed": False,
            "reason": "Platform is in TEST mode. Super admin must enable LIVE mode.",
        }

    if user.trading_mode != "live":
        return {
            "allowed": False,
            "reason": "Your account is in TEST mode. Switch to LIVE mode in settings.",
        }

    return {"allowed": True, "reason": None}
