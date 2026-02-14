"""Resource limits for sandboxed strategy execution."""

# Time limits (seconds)
BACKTEST_TIME_LIMIT = 30    # Max time per bar in backtest
LIVE_TIME_LIMIT = 5         # Max time per tick in live/paper

# Memory limits (bytes)
MEMORY_LIMIT = 512 * 1024 * 1024  # 512 MB

# Code limits
MAX_CODE_LENGTH = 50_000    # 50KB max strategy code
MAX_LOOP_ITERATIONS = 1_000_000
