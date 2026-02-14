import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.strategy import Strategy, StrategyVersion
from app.schemas.strategy import StrategyCreate, StrategyUpdate
from app.exceptions import NotFoundException, ForbiddenException


async def create_strategy(
    db: AsyncSession, user_id: uuid.UUID, data: StrategyCreate, source_type: str = "editor"
) -> Strategy:
    strategy = Strategy(
        user_id=user_id,
        name=data.name,
        description=data.description,
        code=data.code,
        source_type=source_type,
        parameters=data.parameters,
        instruments=data.instruments,
        timeframe=data.timeframe,
        version=1,
    )
    db.add(strategy)
    await db.flush()
    await db.refresh(strategy)

    # Save initial version
    version = StrategyVersion(
        strategy_id=strategy.id,
        version=1,
        code=data.code,
        parameters=data.parameters,
    )
    db.add(version)
    await db.flush()

    return strategy


async def get_strategies(db: AsyncSession, user_id: uuid.UUID) -> list[Strategy]:
    result = await db.execute(
        select(Strategy)
        .where(Strategy.user_id == user_id, Strategy.is_active == True)
        .order_by(Strategy.updated_at.desc())
    )
    return list(result.scalars().all())


async def get_strategy(db: AsyncSession, strategy_id: uuid.UUID, user_id: uuid.UUID) -> Strategy:
    result = await db.execute(
        select(Strategy).where(Strategy.id == strategy_id)
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise NotFoundException("Strategy not found")
    if strategy.user_id != user_id:
        raise ForbiddenException("Not authorized to access this strategy")
    return strategy


async def update_strategy(
    db: AsyncSession, strategy_id: uuid.UUID, user_id: uuid.UUID, data: StrategyUpdate
) -> Strategy:
    strategy = await get_strategy(db, strategy_id, user_id)
    code_changed = False

    if data.name is not None:
        strategy.name = data.name
    if data.description is not None:
        strategy.description = data.description
    if data.code is not None and data.code != strategy.code:
        strategy.code = data.code
        code_changed = True
    if data.parameters is not None:
        strategy.parameters = data.parameters
    if data.instruments is not None:
        strategy.instruments = data.instruments
    if data.timeframe is not None:
        strategy.timeframe = data.timeframe

    # Bump version if code changed
    if code_changed:
        strategy.version += 1
        version = StrategyVersion(
            strategy_id=strategy.id,
            version=strategy.version,
            code=strategy.code,
            parameters=strategy.parameters,
        )
        db.add(version)

    db.add(strategy)
    await db.flush()
    await db.refresh(strategy)
    return strategy


async def delete_strategy(db: AsyncSession, strategy_id: uuid.UUID, user_id: uuid.UUID) -> None:
    strategy = await get_strategy(db, strategy_id, user_id)
    strategy.is_active = False
    db.add(strategy)


async def get_strategy_versions(
    db: AsyncSession, strategy_id: uuid.UUID, user_id: uuid.UUID
) -> list[StrategyVersion]:
    # Verify ownership
    await get_strategy(db, strategy_id, user_id)
    result = await db.execute(
        select(StrategyVersion)
        .where(StrategyVersion.strategy_id == strategy_id)
        .order_by(StrategyVersion.version.desc())
    )
    return list(result.scalars().all())


async def create_strategy_from_upload(
    db: AsyncSession, user_id: uuid.UUID, filename: str, code: str
) -> Strategy:
    name = filename.rsplit(".", 1)[0] if "." in filename else filename
    data = StrategyCreate(
        name=name,
        description=f"Uploaded from {filename}",
        code=code,
        parameters={},
        instruments=[],
        timeframe="1d",
    )
    return await create_strategy(db, user_id, data, source_type="upload")
