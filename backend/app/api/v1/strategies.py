import uuid
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.strategy import (
    StrategyCreate,
    StrategyUpdate,
    StrategyResponse,
    StrategyListResponse,
    StrategyVersionResponse,
    StrategyValidateResponse,
)
from app.services import strategy_service
from app.exceptions import BadRequestException

router = APIRouter(prefix="/strategies", tags=["Strategies"])


@router.get("", response_model=list[StrategyListResponse])
async def list_strategies(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    strategies = await strategy_service.get_strategies(db, current_user.id)
    return strategies


@router.post("", response_model=StrategyResponse, status_code=201)
async def create_strategy(
    data: StrategyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    strategy = await strategy_service.create_strategy(db, current_user.id, data)
    return strategy


@router.post("/upload", response_model=StrategyResponse, status_code=201)
async def upload_strategy(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.endswith(".py"):
        raise BadRequestException("Only .py files are allowed")

    content = await file.read()
    if len(content) > 1_000_000:  # 1MB limit
        raise BadRequestException("File too large. Maximum size is 1MB")

    try:
        code = content.decode("utf-8")
    except UnicodeDecodeError:
        raise BadRequestException("File must be valid UTF-8 text")

    strategy = await strategy_service.create_strategy_from_upload(
        db, current_user.id, file.filename, code
    )
    return strategy


@router.get("/{strategy_id}", response_model=StrategyResponse)
async def get_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    strategy = await strategy_service.get_strategy(db, strategy_id, current_user.id)
    return strategy


@router.put("/{strategy_id}", response_model=StrategyResponse)
async def update_strategy(
    strategy_id: uuid.UUID,
    data: StrategyUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    strategy = await strategy_service.update_strategy(
        db, strategy_id, current_user.id, data
    )
    return strategy


@router.delete("/{strategy_id}", status_code=204)
async def delete_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await strategy_service.delete_strategy(db, strategy_id, current_user.id)


@router.post("/{strategy_id}/validate", response_model=StrategyValidateResponse)
async def validate_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    strategy = await strategy_service.get_strategy(db, strategy_id, current_user.id)

    from app.sandbox.executor import StrategyExecutor

    executor = StrategyExecutor()
    result = executor.validate_code(strategy.code)
    return result


@router.get("/{strategy_id}/versions", response_model=list[StrategyVersionResponse])
async def get_strategy_versions(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    versions = await strategy_service.get_strategy_versions(
        db, strategy_id, current_user.id
    )
    return versions
