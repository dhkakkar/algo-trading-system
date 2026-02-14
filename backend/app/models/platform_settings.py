from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, TimestampMixin


class PlatformSettings(Base, TimestampMixin):
    """
    Global platform settings. Single row table.
    Controls platform-wide behavior like test/live mode.
    """
    __tablename__ = "platform_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    trading_mode: Mapped[str] = mapped_column(String(10), default="test")  # 'test' | 'live'
