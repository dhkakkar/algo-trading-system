import redis.asyncio as redis
from app.config import get_settings

settings = get_settings()

redis_client = redis.Redis(
    host=settings.redis_host,
    port=settings.redis_port,
    decode_responses=True,
)

async def get_redis() -> redis.Redis:
    return redis_client
