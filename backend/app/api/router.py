from fastapi import APIRouter
from app.api.v1 import auth, users, strategies, backtests, market_data, broker, admin, trading, notifications

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(strategies.router)
api_router.include_router(market_data.router)
api_router.include_router(backtests.router)
api_router.include_router(broker.router)
api_router.include_router(admin.router)
api_router.include_router(trading.router)
api_router.include_router(notifications.router)
