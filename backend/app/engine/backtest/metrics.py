"""
Backtest performance metrics.

All functions are pure -- they take equity curve lists and trade lists and
return numeric results.  Edge cases (empty data, zero division, etc.) are
handled gracefully and return 0.0 or NaN where appropriate.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Return metrics
# ---------------------------------------------------------------------------

def calculate_total_return(equity_curve: list[dict]) -> float:
    """
    Total return as a decimal fraction: ``(final - initial) / initial``.

    E.g. 0.25 means 25% return.
    """
    if len(equity_curve) < 2:
        return 0.0

    initial = equity_curve[0]["equity"]
    final = equity_curve[-1]["equity"]

    if initial == 0:
        return 0.0

    return (final - initial) / initial


def calculate_cagr(
    equity_curve: list[dict],
    start_date: datetime | str,
    end_date: datetime | str,
) -> float:
    """
    Compound Annual Growth Rate.

    ``CAGR = (final / initial) ^ (1 / years) - 1``

    Returns 0.0 if the period is less than one day or data is insufficient.
    """
    if len(equity_curve) < 2:
        return 0.0

    initial = equity_curve[0]["equity"]
    final = equity_curve[-1]["equity"]

    if initial <= 0:
        return 0.0

    # Parse dates if strings
    if isinstance(start_date, str):
        start_date = datetime.fromisoformat(start_date)
    if isinstance(end_date, str):
        end_date = datetime.fromisoformat(end_date)

    days = (end_date - start_date).days
    if days <= 0:
        return 0.0

    years = days / 365.25

    ratio = final / initial
    if ratio <= 0:
        # Total loss -- can't take fractional power of negative
        return -1.0

    return ratio ** (1.0 / years) - 1.0


# ---------------------------------------------------------------------------
# Risk metrics
# ---------------------------------------------------------------------------

def calculate_sharpe_ratio(
    returns: pd.Series,
    risk_free_rate: float = 0.06,
) -> float:
    """
    Annualized Sharpe Ratio.

    ``Sharpe = (mean(excess_returns) / std(excess_returns)) * sqrt(252)``

    Uses 252 trading days for annualization (Indian equity markets).

    Args:
        returns: Daily (or per-bar) percentage returns as a Series.
        risk_free_rate: Annual risk-free rate (default 6% for Indian T-bills).
    """
    if returns is None or len(returns) < 2:
        return 0.0

    # Daily risk-free rate
    daily_rf = (1 + risk_free_rate) ** (1.0 / 252) - 1.0

    excess = returns - daily_rf
    mean_excess = excess.mean()
    std_excess = excess.std(ddof=1)

    if std_excess == 0 or np.isnan(std_excess):
        return 0.0

    return float((mean_excess / std_excess) * np.sqrt(252))


def calculate_sortino_ratio(
    returns: pd.Series,
    risk_free_rate: float = 0.06,
) -> float:
    """
    Annualized Sortino Ratio.

    Like Sharpe but only penalises downside volatility.

    ``Sortino = (mean(excess_returns) / downside_std) * sqrt(252)``
    """
    if returns is None or len(returns) < 2:
        return 0.0

    daily_rf = (1 + risk_free_rate) ** (1.0 / 252) - 1.0
    excess = returns - daily_rf

    # Downside deviation: std of negative excess returns only
    downside = excess[excess < 0]
    if len(downside) < 1:
        # No downside -- return a large positive value (capped)
        return 0.0

    downside_std = downside.std(ddof=1)
    if downside_std == 0 or np.isnan(downside_std):
        return 0.0

    return float((excess.mean() / downside_std) * np.sqrt(252))


# ---------------------------------------------------------------------------
# Drawdown metrics
# ---------------------------------------------------------------------------

def calculate_max_drawdown(equity_curve: list[dict]) -> float:
    """
    Maximum peak-to-trough decline as a decimal fraction.

    E.g. -0.15 means a 15% drawdown.  Returns 0.0 if data is insufficient.
    """
    if len(equity_curve) < 2:
        return 0.0

    equities = [pt["equity"] for pt in equity_curve]
    peak = equities[0]
    max_dd = 0.0

    for eq in equities:
        if eq > peak:
            peak = eq
        if peak > 0:
            dd = (eq - peak) / peak
            if dd < max_dd:
                max_dd = dd

    return max_dd


def calculate_drawdown_curve(equity_curve: list[dict]) -> list[dict]:
    """
    Compute the drawdown at every point on the equity curve.

    Returns a list of ``{"timestamp": ..., "drawdown_percent": ...}``
    where drawdown_percent is a negative number (or zero).
    """
    if not equity_curve:
        return []

    result = []
    peak = equity_curve[0]["equity"]

    for pt in equity_curve:
        eq = pt["equity"]
        if eq > peak:
            peak = eq

        dd_pct = ((eq - peak) / peak * 100) if peak > 0 else 0.0

        result.append({
            "timestamp": pt["timestamp"],
            "drawdown_percent": round(dd_pct, 4),
        })

    return result


# ---------------------------------------------------------------------------
# Trade-level metrics
# ---------------------------------------------------------------------------

def calculate_win_rate(trades: list[dict]) -> float:
    """
    Fraction of winning trades: ``wins / total``.

    A trade is a win if its ``net_pnl`` (or ``pnl`` if net_pnl is absent)
    is greater than zero.
    """
    if not trades:
        return 0.0

    wins = sum(
        1 for t in trades
        if t.get("net_pnl", t.get("pnl", 0)) > 0
    )

    return wins / len(trades)


def calculate_profit_factor(trades: list[dict]) -> float:
    """
    Gross profit / gross loss.

    Returns ``float('inf')`` if there are no losing trades but there are
    winning trades.  Returns 0.0 if there are no trades or no winners.
    """
    if not trades:
        return 0.0

    gross_profit = 0.0
    gross_loss = 0.0

    for t in trades:
        pnl = t.get("net_pnl", t.get("pnl", 0))
        if pnl > 0:
            gross_profit += pnl
        elif pnl < 0:
            gross_loss += abs(pnl)

    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0

    return gross_profit / gross_loss


def calculate_avg_trade_pnl(trades: list[dict]) -> float:
    """Average P&L per trade (using net_pnl where available)."""
    if not trades:
        return 0.0

    total_pnl = sum(t.get("net_pnl", t.get("pnl", 0)) for t in trades)
    return total_pnl / len(trades)


def calculate_max_consecutive_wins(trades: list[dict]) -> int:
    """Maximum number of consecutive winning trades."""
    if not trades:
        return 0

    max_streak = 0
    current = 0

    for t in trades:
        if t.get("net_pnl", t.get("pnl", 0)) > 0:
            current += 1
            max_streak = max(max_streak, current)
        else:
            current = 0

    return max_streak


def calculate_max_consecutive_losses(trades: list[dict]) -> int:
    """Maximum number of consecutive losing trades."""
    if not trades:
        return 0

    max_streak = 0
    current = 0

    for t in trades:
        if t.get("net_pnl", t.get("pnl", 0)) < 0:
            current += 1
            max_streak = max(max_streak, current)
        else:
            current = 0

    return max_streak


def calculate_expectancy(trades: list[dict]) -> float:
    """
    Trading expectancy per trade.

    ``E = (win_rate * avg_win) - (loss_rate * avg_loss)``
    """
    if not trades:
        return 0.0

    wins = []
    losses = []

    for t in trades:
        pnl = t.get("net_pnl", t.get("pnl", 0))
        if pnl > 0:
            wins.append(pnl)
        elif pnl < 0:
            losses.append(abs(pnl))

    total = len(trades)
    win_rate = len(wins) / total
    loss_rate = len(losses) / total

    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0

    return (win_rate * avg_win) - (loss_rate * avg_loss)


# ---------------------------------------------------------------------------
# Helper: compute daily returns from equity curve
# ---------------------------------------------------------------------------

def _equity_to_returns(equity_curve: list[dict]) -> pd.Series:
    """
    Convert an equity curve into a pandas Series of fractional daily returns.

    Returns an empty Series if the equity curve has fewer than 2 points.
    """
    if len(equity_curve) < 2:
        return pd.Series(dtype=float)

    equities = pd.Series(
        [pt["equity"] for pt in equity_curve],
        index=[pt["timestamp"] for pt in equity_curve],
        dtype=float,
    )

    returns = equities.pct_change().dropna()
    # Replace inf/-inf with 0 (can happen if equity goes to zero)
    returns = returns.replace([np.inf, -np.inf], 0.0)

    return returns


# ---------------------------------------------------------------------------
# Aggregate: calculate everything at once
# ---------------------------------------------------------------------------

def calculate_all_metrics(
    equity_curve: list[dict],
    trades: list[dict],
    start_date: datetime | str,
    end_date: datetime | str,
) -> dict[str, Any]:
    """
    Calculate all performance metrics in one call.

    Returns a dict with the following keys:

    - ``total_return``: Total return as decimal (e.g. 0.25 = 25%)
    - ``cagr``: Compound Annual Growth Rate as decimal
    - ``sharpe_ratio``: Annualized Sharpe Ratio
    - ``sortino_ratio``: Annualized Sortino Ratio
    - ``max_drawdown``: Maximum drawdown as decimal (negative)
    - ``win_rate``: Winning trade fraction
    - ``profit_factor``: Gross profit / gross loss
    - ``total_trades``: Number of completed trades
    - ``avg_trade_pnl``: Average P&L per trade
    - ``max_consecutive_wins``: Longest winning streak
    - ``max_consecutive_losses``: Longest losing streak
    - ``expectancy``: Expected value per trade
    - ``drawdown_curve``: List of drawdown points
    """
    returns = _equity_to_returns(equity_curve)

    total_return = calculate_total_return(equity_curve)
    cagr = calculate_cagr(equity_curve, start_date, end_date)
    sharpe = calculate_sharpe_ratio(returns)
    sortino = calculate_sortino_ratio(returns)
    max_dd = calculate_max_drawdown(equity_curve)
    dd_curve = calculate_drawdown_curve(equity_curve)

    win_rate = calculate_win_rate(trades)
    profit_factor = calculate_profit_factor(trades)
    avg_pnl = calculate_avg_trade_pnl(trades)
    max_wins = calculate_max_consecutive_wins(trades)
    max_losses = calculate_max_consecutive_losses(trades)
    expectancy = calculate_expectancy(trades)

    return {
        "total_return": round(total_return, 6),
        "cagr": round(cagr, 6),
        "sharpe_ratio": round(sharpe, 4),
        "sortino_ratio": round(sortino, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4) if not math.isinf(profit_factor) else 9999.0,
        "total_trades": len(trades),
        "avg_trade_pnl": round(avg_pnl, 2),
        "max_consecutive_wins": max_wins,
        "max_consecutive_losses": max_losses,
        "expectancy": round(expectancy, 2),
        "drawdown_curve": dd_curve,
    }
