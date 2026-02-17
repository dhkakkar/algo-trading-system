"""Shared timezone constants for the project.

Convention:
- DB storage & wire format: UTC (handled by TimestampMixin)
- Indian market time comparisons: Always convert to IST first
- Never use naive datetime.now() — always datetime.now(timezone.utc)
"""

from datetime import timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
