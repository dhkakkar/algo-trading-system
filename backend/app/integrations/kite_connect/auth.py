"""Kite Connect OAuth flow helpers."""

from app.config import get_settings

settings = get_settings()


def get_kite_login_url() -> str:
    """Generate Kite Connect login URL using configured API key."""
    from app.integrations.kite_connect.client import kite_manager
    return kite_manager.generate_login_url(settings.kite_api_key)
