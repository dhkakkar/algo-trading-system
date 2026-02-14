"""
Technical indicator functions for the algo-trading SDK.

All functions operate on pandas Series (or DataFrames where noted) and return
pandas Series (or tuples of Series). They use numpy internally for performance
and handle edge cases such as NaN values and insufficient data gracefully.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Trend indicators
# ---------------------------------------------------------------------------

def sma(data: pd.Series, period: int) -> pd.Series:
    """
    Simple Moving Average.

    Args:
        data: Price series (typically close prices).
        period: Number of periods for the moving average.

    Returns:
        Series with the SMA values.  The first ``period - 1`` values will be
        NaN because there is not enough data to compute the average.
    """
    return data.rolling(window=period, min_periods=period).mean()


def ema(data: pd.Series, period: int) -> pd.Series:
    """
    Exponential Moving Average.

    Uses the standard *span*-based smoothing factor ``alpha = 2 / (period + 1)``.

    Args:
        data: Price series.
        period: Span for the EMA.

    Returns:
        Series with the EMA values.
    """
    return data.ewm(span=period, adjust=False).mean()


def macd(
    data: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Moving Average Convergence Divergence.

    Args:
        data: Price series (typically close).
        fast: Fast EMA period.
        slow: Slow EMA period.
        signal: Signal line EMA period.

    Returns:
        Tuple of (macd_line, signal_line, histogram).
    """
    fast_ema = ema(data, fast)
    slow_ema = ema(data, slow)
    macd_line = fast_ema - slow_ema
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def supertrend(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 10,
    multiplier: float = 3.0,
) -> pd.Series:
    """
    SuperTrend indicator (very popular among Indian retail traders).

    The indicator flips between an upper and lower band based on ATR.  When the
    close is above the SuperTrend line the trend is bullish; when below, bearish.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        period: ATR look-back period.
        multiplier: ATR multiplier for band width.

    Returns:
        Series with the SuperTrend values.
    """
    atr_vals = atr(high, low, close, period)

    hl2 = (high + low) / 2.0
    upper_basic = hl2 + multiplier * atr_vals
    lower_basic = hl2 - multiplier * atr_vals

    n = len(close)
    upper_band = np.empty(n, dtype=np.float64)
    lower_band = np.empty(n, dtype=np.float64)
    st = np.empty(n, dtype=np.float64)

    close_arr = close.values.astype(np.float64)
    upper_basic_arr = upper_basic.values.astype(np.float64)
    lower_basic_arr = lower_basic.values.astype(np.float64)

    upper_band[0] = upper_basic_arr[0]
    lower_band[0] = lower_basic_arr[0]
    # Initial direction: bullish if close > upper band
    st[0] = lower_band[0] if close_arr[0] > upper_band[0] else upper_band[0]

    for i in range(1, n):
        # --- lower band ---
        if lower_basic_arr[i] > lower_band[i - 1] or close_arr[i - 1] < lower_band[i - 1]:
            lower_band[i] = lower_basic_arr[i]
        else:
            lower_band[i] = lower_band[i - 1]

        # --- upper band ---
        if upper_basic_arr[i] < upper_band[i - 1] or close_arr[i - 1] > upper_band[i - 1]:
            upper_band[i] = upper_basic_arr[i]
        else:
            upper_band[i] = upper_band[i - 1]

        # --- supertrend ---
        if st[i - 1] == upper_band[i - 1]:
            # Previous trend was bearish (ST was upper band)
            if close_arr[i] <= upper_band[i]:
                st[i] = upper_band[i]
            else:
                st[i] = lower_band[i]
        else:
            # Previous trend was bullish (ST was lower band)
            if close_arr[i] >= lower_band[i]:
                st[i] = lower_band[i]
            else:
                st[i] = upper_band[i]

    result = pd.Series(st, index=close.index, name="supertrend")
    # Propagate NaN from ATR warm-up period
    result.iloc[: period - 1] = np.nan
    return result


def adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """
    Average Directional Index.

    Measures trend strength regardless of direction.  Values above 25 generally
    indicate a strong trend; below 20 indicates a weak / ranging market.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        period: Look-back period.

    Returns:
        Series with the ADX values.
    """
    high_arr = high.values.astype(np.float64)
    low_arr = low.values.astype(np.float64)
    close_arr = close.values.astype(np.float64)

    n = len(close_arr)
    if n < 2:
        return pd.Series(np.nan, index=close.index, name="adx")

    # +DM / -DM
    plus_dm = np.zeros(n, dtype=np.float64)
    minus_dm = np.zeros(n, dtype=np.float64)
    tr = np.zeros(n, dtype=np.float64)

    for i in range(1, n):
        up_move = high_arr[i] - high_arr[i - 1]
        down_move = low_arr[i - 1] - low_arr[i]

        plus_dm[i] = up_move if (up_move > down_move and up_move > 0) else 0.0
        minus_dm[i] = down_move if (down_move > up_move and down_move > 0) else 0.0

        tr[i] = max(
            high_arr[i] - low_arr[i],
            abs(high_arr[i] - close_arr[i - 1]),
            abs(low_arr[i] - close_arr[i - 1]),
        )

    # Wilder smoothing (equivalent to EMA with alpha = 1/period)
    def wilder_smooth(values: np.ndarray, period: int) -> np.ndarray:
        result = np.full(n, np.nan, dtype=np.float64)
        # First smoothed value is the simple sum of the first `period` values
        first_sum = np.sum(values[1 : period + 1])
        result[period] = first_sum
        for i in range(period + 1, n):
            result[i] = result[i - 1] - result[i - 1] / period + values[i]
        return result

    smoothed_tr = wilder_smooth(tr, period)
    smoothed_plus_dm = wilder_smooth(plus_dm, period)
    smoothed_minus_dm = wilder_smooth(minus_dm, period)

    # +DI / -DI
    with np.errstate(divide="ignore", invalid="ignore"):
        plus_di = 100.0 * smoothed_plus_dm / smoothed_tr
        minus_di = 100.0 * smoothed_minus_dm / smoothed_tr
        dx = 100.0 * np.abs(plus_di - minus_di) / (plus_di + minus_di)

    # ADX is Wilder-smoothed DX
    adx_arr = np.full(n, np.nan, dtype=np.float64)
    # First ADX = mean of first `period` DX values starting from where DX is valid
    start = period  # first valid DX index
    end = start + period
    if end <= n:
        adx_arr[end - 1] = np.nanmean(dx[start:end])
        for i in range(end, n):
            adx_arr[i] = (adx_arr[i - 1] * (period - 1) + dx[i]) / period

    return pd.Series(adx_arr, index=close.index, name="adx")


# ---------------------------------------------------------------------------
# Momentum / oscillator indicators
# ---------------------------------------------------------------------------

def rsi(data: pd.Series, period: int = 14) -> pd.Series:
    """
    Relative Strength Index (Wilder's smoothing method).

    Args:
        data: Price series (typically close).
        period: Look-back period.

    Returns:
        Series with RSI values in the range [0, 100].
    """
    delta = data.diff()

    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)

    # Wilder's smoothing: first value is simple average, then EMA with alpha=1/period
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi_values = 100.0 - (100.0 / (1.0 + rs))

    # Where avg_loss is 0, RSI should be 100
    rsi_values = rsi_values.fillna(100.0)
    # First (period - 1) values don't have enough data
    rsi_values.iloc[: period] = np.nan

    return rsi_values.rename("rsi")


def stochastic(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    k_period: int = 14,
    d_period: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """
    Stochastic Oscillator (%K and %D).

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        k_period: Look-back period for %K.
        d_period: SMA period for %D (smoothing of %K).

    Returns:
        Tuple of (%K, %D) Series, each in [0, 100].
    """
    lowest_low = low.rolling(window=k_period, min_periods=k_period).min()
    highest_high = high.rolling(window=k_period, min_periods=k_period).max()

    k = 100.0 * (close - lowest_low) / (highest_high - lowest_low)
    d = k.rolling(window=d_period, min_periods=d_period).mean()

    return k.rename("stoch_k"), d.rename("stoch_d")


# ---------------------------------------------------------------------------
# Volatility indicators
# ---------------------------------------------------------------------------

def bollinger_bands(
    data: pd.Series,
    period: int = 20,
    std_dev: float = 2.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Bollinger Bands.

    Args:
        data: Price series (typically close).
        period: SMA period for the middle band.
        std_dev: Number of standard deviations for the upper/lower bands.

    Returns:
        Tuple of (upper_band, middle_band, lower_band).
    """
    middle = sma(data, period)
    rolling_std = data.rolling(window=period, min_periods=period).std(ddof=0)
    upper = middle + std_dev * rolling_std
    lower = middle - std_dev * rolling_std
    return (
        upper.rename("bb_upper"),
        middle.rename("bb_middle"),
        lower.rename("bb_lower"),
    )


def atr(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """
    Average True Range.

    Uses Wilder's smoothing (exponential moving average with alpha = 1/period).

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        period: Look-back period.

    Returns:
        Series with ATR values.
    """
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    # Wilder smoothing
    atr_values = tr.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    atr_values.iloc[: period - 1] = np.nan
    return atr_values.rename("atr")


# ---------------------------------------------------------------------------
# Volume indicators
# ---------------------------------------------------------------------------

def vwap(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series,
) -> pd.Series:
    """
    Volume Weighted Average Price.

    Computes the cumulative VWAP over the entire series.  For intraday use the
    caller should pass data that resets at the start of each trading session.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        volume: Volume.

    Returns:
        Series with VWAP values.
    """
    typical_price = (high + low + close) / 3.0
    cum_tp_vol = (typical_price * volume).cumsum()
    cum_vol = volume.cumsum()

    vwap_values = cum_tp_vol / cum_vol
    return vwap_values.rename("vwap")


def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """
    On Balance Volume.

    A cumulative indicator that adds volume on up-days and subtracts volume on
    down-days.

    Args:
        close: Close prices.
        volume: Volume.

    Returns:
        Series with OBV values.
    """
    direction = np.sign(close.diff())
    # First value has no diff, treat as 0
    direction.iloc[0] = 0
    obv_values = (direction * volume).cumsum()
    return obv_values.rename("obv")


# ---------------------------------------------------------------------------
# Cross-over / cross-under helpers
# ---------------------------------------------------------------------------

def crossover(series_a: pd.Series, series_b: pd.Series) -> bool:
    """
    Check if *series_a* just crossed **above** *series_b* on the latest bar.

    A crossover is defined as:
        - On the previous bar, ``a <= b``
        - On the current (latest) bar, ``a > b``

    Handles NaN gracefully: returns False if either value is NaN.

    Args:
        series_a: First series (e.g. fast MA).
        series_b: Second series (e.g. slow MA) -- can also be a scalar
                  wrapped in a constant Series.

    Returns:
        True if a crossover occurred on the most recent bar.
    """
    if len(series_a) < 2 or len(series_b) < 2:
        return False

    curr_a = series_a.iloc[-1]
    prev_a = series_a.iloc[-2]
    curr_b = series_b.iloc[-1]
    prev_b = series_b.iloc[-2]

    if np.isnan(curr_a) or np.isnan(prev_a) or np.isnan(curr_b) or np.isnan(prev_b):
        return False

    return bool(prev_a <= prev_b and curr_a > curr_b)


def crossunder(series_a: pd.Series, series_b: pd.Series) -> bool:
    """
    Check if *series_a* just crossed **below** *series_b* on the latest bar.

    A crossunder is defined as:
        - On the previous bar, ``a >= b``
        - On the current (latest) bar, ``a < b``

    Args:
        series_a: First series.
        series_b: Second series.

    Returns:
        True if a crossunder occurred on the most recent bar.
    """
    if len(series_a) < 2 or len(series_b) < 2:
        return False

    curr_a = series_a.iloc[-1]
    prev_a = series_a.iloc[-2]
    curr_b = series_b.iloc[-1]
    prev_b = series_b.iloc[-2]

    if np.isnan(curr_a) or np.isnan(prev_a) or np.isnan(curr_b) or np.isnan(prev_b):
        return False

    return bool(prev_a >= prev_b and curr_a < curr_b)
