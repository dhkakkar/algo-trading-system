import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.api.router import api_router
from app.middleware import setup_middleware
from app.config import get_settings
from app.websocket.server import socket_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(f"Starting {settings.app_name} in {settings.app_env} mode")
    yield
    logger.info("Shutting down...")


app = FastAPI(
    title="Algo Trading System API",
    description="Multi-tenant algo trading platform for Indian markets",
    version="0.1.0",
    lifespan=lifespan,
)

setup_middleware(app)
app.include_router(api_router)

# Mount Socket.IO ASGI app for WebSocket support
app.mount("/ws", socket_app)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "0.1.0"}
