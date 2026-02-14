from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserResponse, UserUpdate, ChangePasswordRequest
from app.core.security import hash_password, verify_password
from app.exceptions import BadRequestException

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.full_name is not None:
        current_user.full_name = data.full_name
    db.add(current_user)
    await db.flush()
    await db.refresh(current_user)
    return current_user


@router.put("/me/password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(data.current_password, current_user.password_hash):
        raise BadRequestException("Current password is incorrect")
    current_user.password_hash = hash_password(data.new_password)
    db.add(current_user)
    return {"message": "Password updated successfully"}


@router.put("/me/trading-mode")
async def set_my_trading_mode(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle own trading mode between test and live."""
    from app.services import platform_service

    mode = data.get("mode", "")
    user = await platform_service.set_user_trading_mode(db, current_user, mode)

    # Also check if live trading is actually possible
    can_trade = await platform_service.can_trade_live(db, user)

    return {
        "trading_mode": user.trading_mode,
        "can_trade_live": can_trade["allowed"],
        "reason": can_trade["reason"],
    }


@router.get("/me/trading-status")
async def get_my_trading_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if you can place live trades right now."""
    from app.services import platform_service

    can_trade = await platform_service.can_trade_live(db, current_user)
    platform = await platform_service.get_platform_settings(db)

    return {
        "user_trading_mode": current_user.trading_mode,
        "platform_trading_mode": platform.trading_mode,
        "can_trade_live": can_trade["allowed"],
        "reason": can_trade["reason"],
    }
