"""Risk manager for live trading — validates every order before execution."""
import logging
from datetime import datetime, timezone, timedelta

from app.core.timezone import IST
from app.integrations.kite_connect.constants import (
    MARKET_OPEN_HOUR, MARKET_OPEN_MINUTE,
    MARKET_CLOSE_HOUR, MARKET_CLOSE_MINUTE,
)

logger = logging.getLogger(__name__)


class RiskManager:
    """
    Validates orders against safety rules before they reach the broker.

    Rules:
    1. Market hours check (9:15 AM - 3:30 PM IST)
    2. Maximum position size per instrument
    3. Maximum order value
    4. Daily loss limit
    5. Maximum number of open positions
    6. Maximum orders per minute (rate limit)
    """

    def __init__(self, config: dict | None = None):
        config = config or {}
        self.max_position_size = config.get("max_position_size", 100)  # max qty per instrument
        self.max_order_value = config.get("max_order_value", 500000)  # Rs 5L per order
        self.daily_loss_limit = config.get("daily_loss_limit", 50000)  # Rs 50K daily loss
        self.max_open_positions = config.get("max_open_positions", 10)
        self.max_orders_per_minute = config.get("max_orders_per_minute", 10)
        self.enforce_market_hours = config.get("enforce_market_hours", True)

        # Tracking
        self._daily_pnl = 0.0
        self._order_timestamps: list[datetime] = []
        self._current_positions_count = 0
        self._daily_date: str = ""

    def reset_daily(self):
        """Reset daily counters."""
        self._daily_pnl = 0.0
        self._order_timestamps.clear()
        self._daily_date = datetime.now(IST).strftime("%Y-%m-%d")

    def update_pnl(self, realized_pnl: float):
        """Update daily P&L tracking."""
        today = datetime.now(IST).strftime("%Y-%m-%d")
        if today != self._daily_date:
            self.reset_daily()
        self._daily_pnl += realized_pnl

    def update_position_count(self, count: int):
        self._current_positions_count = count

    def validate_order(
        self,
        symbol: str,
        side: str,
        quantity: int,
        price: float | None,
        order_type: str,
        current_positions: list[dict],
    ) -> tuple[bool, str | None]:
        """
        Validate an order against all risk rules.

        Returns (allowed, rejection_reason).
        """
        now_ist = datetime.now(IST)
        today = now_ist.strftime("%Y-%m-%d")

        if today != self._daily_date:
            self.reset_daily()

        # 1. Market hours check
        if self.enforce_market_hours:
            market_open = now_ist.replace(hour=MARKET_OPEN_HOUR, minute=MARKET_OPEN_MINUTE, second=0, microsecond=0)
            market_close = now_ist.replace(hour=MARKET_CLOSE_HOUR, minute=MARKET_CLOSE_MINUTE, second=0, microsecond=0)
            if now_ist < market_open or now_ist > market_close:
                return False, f"Market is closed. Trading hours: {MARKET_OPEN_HOUR}:{MARKET_OPEN_MINUTE:02d} - {MARKET_CLOSE_HOUR}:{MARKET_CLOSE_MINUTE:02d} IST"

        # 2. Position size check
        if quantity > self.max_position_size:
            return False, f"Order quantity {quantity} exceeds max position size {self.max_position_size}"

        # 3. Order value check
        estimated_price = price if price else 0
        if estimated_price > 0 and estimated_price * quantity > self.max_order_value:
            return False, f"Order value {estimated_price * quantity:.2f} exceeds max {self.max_order_value:.2f}"

        # 4. Daily loss limit
        if self._daily_pnl < -self.daily_loss_limit:
            return False, f"Daily loss limit reached: {self._daily_pnl:.2f} (limit: -{self.daily_loss_limit:.2f})"

        # 5. Max open positions
        if side == "BUY" and self._current_positions_count >= self.max_open_positions:
            # Check if this is closing an existing position
            has_existing = any(p.get("symbol") == symbol and p.get("side") == "SHORT" for p in current_positions)
            if not has_existing:
                return False, f"Max open positions ({self.max_open_positions}) reached"

        # 6. Rate limit
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=1)
        self._order_timestamps = [t for t in self._order_timestamps if t > cutoff]
        if len(self._order_timestamps) >= self.max_orders_per_minute:
            return False, f"Rate limit: max {self.max_orders_per_minute} orders per minute"

        # Track the order timestamp
        self._order_timestamps.append(datetime.now(timezone.utc))

        logger.info("Risk check PASSED: %s %s x%d", side, symbol, quantity)
        return True, None
