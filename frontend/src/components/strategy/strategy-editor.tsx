"use client";

import { useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

const DEFAULT_TEMPLATE = `class MyStrategy(Strategy):
    def on_init(self, ctx):
        # Initialize your strategy here
        self.period = ctx.get_param("period", 20)

    def on_data(self, ctx):
        # Your strategy logic here
        data = ctx.get_historical_data("RELIANCE", periods=self.period)
        close = data["close"]

        sma = ctx.sma(close, self.period)

        position = ctx.get_position("RELIANCE")

        if ctx.crossover(close, sma) and position is None:
            ctx.buy("RELIANCE", quantity=10)
            ctx.log("BUY signal")

        elif ctx.crossunder(close, sma) and position is not None:
            ctx.sell("RELIANCE", quantity=10)
            ctx.log("SELL signal")
`;

const EMA_CROSS_TEMPLATE = `class EMACrossStrategy(Strategy):
    """
    EMA Cross Strategy — enters long on fast/slow EMA crossover,
    enters short on crossunder. Supports Long-only, Short-only, or Both.

    Parameters:
        fast_ema    — Fast EMA period (default: 2)
        slow_ema    — Slow EMA period (default: 5)
        direction   — "Both", "Long", or "Short" (default: "Both")
        symbol      — Trading symbol (default: "NIFTY 50")
        exchange    — Exchange segment (default: "NSE")
        quantity    — Order quantity / lot size (default: 25)
    """

    def on_init(self, ctx):
        self.fast_period = ctx.get_param("fast_ema", 2)
        self.slow_period = ctx.get_param("slow_ema", 5)
        self.direction = ctx.get_param("direction", "Both")
        self.symbol = ctx.get_param("symbol", "NIFTY 50")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.quantity = ctx.get_param("quantity", 25)
        self.product = ctx.get_param("product", "CNC")

        self.long_ok = self.direction in ("Long", "Both")
        self.short_ok = self.direction in ("Short", "Both")

        ctx.log(
            "EMA Cross Strategy initialized: "
            + "fast=" + str(self.fast_period)
            + " slow=" + str(self.slow_period)
            + " direction=" + self.direction
            + " symbol=" + self.symbol
            + " qty=" + str(self.quantity)
        )

    def on_data(self, ctx):
        # Need enough bars for the slow EMA to stabilize
        lookback = self.slow_period + 10
        data = ctx.get_historical_data(
            self.symbol, exchange=self.exchange, periods=lookback
        )
        if data is None or len(data) < self.slow_period:
            return

        close = data["close"]

        # Calculate EMAs
        fast_ema = ctx.ema(close, self.fast_period)
        slow_ema = ctx.ema(close, self.slow_period)

        # Detect crossover / crossunder
        long_signal = ctx.crossover(fast_ema, slow_ema)
        short_signal = ctx.crossunder(fast_ema, slow_ema)

        position = ctx.get_position(self.symbol)

        # --- LONG ENTRY (crossover) ---
        if long_signal and self.long_ok:
            if position is None:
                # Flat -> go long
                ctx.buy(self.symbol, self.quantity,
                        exchange=self.exchange, product=self.product)
                ctx.log("LONG entry at " + str(close.iloc[-1]))

            elif position.side == "SHORT":
                # Reverse: close short + open long
                reverse_qty = position.quantity + self.quantity
                ctx.buy(self.symbol, reverse_qty,
                        exchange=self.exchange, product=self.product)
                ctx.log("REVERSE short->long at " + str(close.iloc[-1]))

        # --- SHORT ENTRY (crossunder) ---
        if short_signal and self.short_ok:
            if position is None:
                # Flat -> go short
                ctx.sell(self.symbol, self.quantity,
                         exchange=self.exchange, product=self.product)
                ctx.log("SHORT entry at " + str(close.iloc[-1]))

            elif position.side == "LONG":
                # Reverse: close long + open short
                reverse_qty = position.quantity + self.quantity
                ctx.sell(self.symbol, reverse_qty,
                         exchange=self.exchange, product=self.product)
                ctx.log("REVERSE long->short at " + str(close.iloc[-1]))

        # --- EXIT without reversal (when direction is restricted) ---
        if short_signal and not self.short_ok and position is not None:
            if position.side == "LONG":
                ctx.sell(self.symbol, position.quantity,
                         exchange=self.exchange, product=self.product)
                ctx.log("EXIT long at " + str(close.iloc[-1]))

        if long_signal and not self.long_ok and position is not None:
            if position.side == "SHORT":
                ctx.buy(self.symbol, position.quantity,
                        exchange=self.exchange, product=self.product)
                ctx.log("EXIT short at " + str(close.iloc[-1]))

    def on_order_fill(self, ctx, order):
        ctx.log(
            "FILLED: " + order.side + " " + order.symbol
            + " x" + str(order.quantity)
            + " @ " + str(order.fill_price)
        )

    def on_stop(self, ctx):
        ctx.log("EMA Cross Strategy stopped")
`;

const RSI_MEAN_REVERSION_TEMPLATE = `class RSIMeanReversion(Strategy):
    """
    RSI Mean-Reversion Strategy — buys when RSI dips below oversold,
    sells when RSI rises above overbought.

    Parameters:
        rsi_period   — RSI look-back period (default: 14)
        oversold     — Buy threshold (default: 30)
        overbought   — Sell threshold (default: 70)
        symbol       — Trading symbol (default: "RELIANCE")
        quantity     — Order quantity (default: 10)
    """

    def on_init(self, ctx):
        self.rsi_period = ctx.get_param("rsi_period", 14)
        self.oversold = ctx.get_param("oversold", 30)
        self.overbought = ctx.get_param("overbought", 70)
        self.symbol = ctx.get_param("symbol", "RELIANCE")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.quantity = ctx.get_param("quantity", 10)

    def on_data(self, ctx):
        data = ctx.get_historical_data(
            self.symbol, exchange=self.exchange,
            periods=self.rsi_period + 5
        )
        if data is None or len(data) < self.rsi_period + 1:
            return

        rsi = ctx.rsi(data["close"], self.rsi_period)
        current_rsi = rsi.iloc[-1]
        position = ctx.get_position(self.symbol)

        if current_rsi < self.oversold and position is None:
            ctx.buy(self.symbol, self.quantity, exchange=self.exchange)
            ctx.log("BUY — RSI=" + str(round(current_rsi, 1)))

        elif current_rsi > self.overbought and position is not None:
            ctx.sell(self.symbol, position.quantity, exchange=self.exchange)
            ctx.log("SELL — RSI=" + str(round(current_rsi, 1)))
`;

const EMA_CPR_TEMPLATE = `import math


def _norm_cdf(x):
    if x > 6.0:
        return 1.0
    if x < -6.0:
        return 0.0
    t = 1.0 / (1.0 + 0.2316419 * abs(x))
    d = 0.3989422804014327
    p = d * math.exp(-x * x / 2.0) * (
        t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    )
    return 1.0 - p if x > 0 else p


def _bs_delta(spot, strike, tte_years, vol, r=0.07, option_type="CE"):
    if tte_years <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        if option_type == "CE":
            return 1.0 if spot >= strike else 0.0
        return -1.0 if spot <= strike else 0.0
    d1 = (math.log(spot / strike) + (r + 0.5 * vol ** 2) * tte_years) / (vol * math.sqrt(tte_years))
    if option_type == "CE":
        return _norm_cdf(d1)
    return _norm_cdf(d1) - 1.0


def _historical_vol(closes, period=20):
    if len(closes) < period + 1:
        return 0.15
    log_rets = [math.log(closes[i] / closes[i - 1])
                for i in range(len(closes) - period, len(closes))]
    mean = sum(log_rets) / len(log_rets)
    var = sum((r - mean) ** 2 for r in log_rets) / (len(log_rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


class NiftyEMACPRStrategy(Strategy):
    """
    Nifty EMA+CPR Options Selling Strategy

    Uses EMA-20/EMA-60 with CPR levels on 5-min Nifty chart to generate
    directional signals.  Sells OTM options (PE on bullish, CE on bearish)
    targeting delta ~0.4.  SL tracked on underlying price.

    Parameters:
        symbol          — Underlying symbol (default: "NIFTY 50")
        exchange        — Underlying exchange (default: "NSE")
        quantity        — Number of lots (default: 1)
        target_delta    — Option |delta| to target (default: 0.4)
        ema_fast        — Fast EMA period (default: 20)
        ema_slow        — Slow EMA period (default: 60)
        initial_sl      — Initial stop loss in underlying points (default: 2500)
        tsl_activation  — TSL activation profit threshold (default: 2000)
        tsl_lock_pct    — TSL lock-in percentage (default: 50)
        tsl_step_size   — TSL step size (default: 200)
        swing_bars      — Bars for trigger invalidation (default: 3)
        cutoff_hour     — Time cutoff hour IST (default: 15)
        cutoff_minute   — Time cutoff minute (default: 10)
    """

    def on_init(self, ctx):
        self.symbol = ctx.get_param("symbol", "NIFTY 50")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.num_lots = ctx.get_param("quantity", 1)
        self.target_delta = ctx.get_param("target_delta", 0.4)

        self.ema_fast = ctx.get_param("ema_fast", 20)
        self.ema_slow = ctx.get_param("ema_slow", 60)

        self.initial_sl = ctx.get_param("initial_sl", 2500)
        self.tsl_activation = ctx.get_param("tsl_activation", 2000)
        self.tsl_lock_pct = ctx.get_param("tsl_lock_pct", 50)
        self.tsl_step_size = ctx.get_param("tsl_step_size", 200)

        self.swing_bars = ctx.get_param("swing_bars", 3)
        self.cutoff_hour = ctx.get_param("cutoff_hour", 15)
        self.cutoff_minute = ctx.get_param("cutoff_minute", 10)

        self.bullish_trigger = False
        self.bearish_trigger = False
        self.trigger_high = None
        self.trigger_low = None
        self.bars_since_trigger = 0
        self.recent_highs = []
        self.recent_lows = []

        self.in_long = False
        self.in_short = False
        self.entry_price = None
        self.current_sl = None
        self.peak_profit = 0.0
        self.tsl_step = 0
        self.tsl_active = False

        self.held_option = None
        self.held_lot_size = 25

        self.block_long = False
        self.block_short = False

        self.last_date = None
        self.prev_day_high = None
        self.prev_day_low = None
        self.prev_day_close = None

        ctx.log("EMA+CPR Options Selling init: underlying=" + self.symbol
                + " lots=" + str(self.num_lots) + " target_delta=" + str(self.target_delta))

    def _find_option_by_delta(self, ctx, spot, option_type, closes_list):
        expiry = ctx.get_nearest_expiry(self.symbol)
        if expiry is None:
            ctx.log("WARNING: No expiry found")
            return None
        chain = ctx.get_option_chain(self.symbol, expiry)
        if not chain:
            ctx.log("WARNING: Empty option chain")
            return None
        options = [o for o in chain if o["option_type"] == option_type]
        if not options:
            return None
        vol = _historical_vol(closes_list)
        bar = ctx.get_current_bar(self.symbol)
        if bar and hasattr(bar.get("timestamp"), "date"):
            bar_date = bar["timestamp"].date()
        else:
            bar_date = expiry
        dte = (expiry - bar_date).days
        tte_years = max(dte, 1) / 365.0
        best = None
        best_diff = float("inf")
        best_delta = 0.0
        for opt in options:
            delta = _bs_delta(spot, opt["strike"], tte_years, vol, option_type=option_type)
            diff = abs(abs(delta) - self.target_delta)
            if diff < best_diff:
                best_diff = diff
                best = opt
                best_delta = delta
        if best:
            ctx.log("Selected " + option_type + ": " + best["tradingsymbol"]
                    + " strike=" + str(best["strike"]) + " delta=" + str(round(best_delta, 3)))
        return best

    def _exit_held_option(self, ctx, reason):
        if self.held_option:
            qty = self.num_lots * self.held_lot_size
            ctx.buy(self.held_option, qty, exchange="NFO", product="NRML")
            ctx.log("EXIT (" + reason + ") | buyback " + self.held_option + " x" + str(qty))

    def on_data(self, ctx):
        lookback = max(self.ema_slow + 10, 200)
        data = ctx.get_historical_data(self.symbol, exchange=self.exchange, periods=lookback)
        if data is None or len(data) < self.ema_slow + 5:
            return
        bar = ctx.get_current_bar(self.symbol)
        if not bar:
            return

        close = data["close"]
        high_s = data["high"]
        low_s = data["low"]
        cur_close = close.iloc[-1]
        cur_high = high_s.iloc[-1]
        cur_low = low_s.iloc[-1]
        timestamp = bar["timestamp"]
        closes_list = list(close)

        bar_hour = timestamp.hour if hasattr(timestamp, "hour") else 0
        bar_min = timestamp.minute if hasattr(timestamp, "minute") else 0
        bar_date = timestamp.date() if hasattr(timestamp, "date") else None

        if bar_date is not None and bar_date != self.last_date:
            self.calc_prev_day_hlc(data, bar_date)
            self.bullish_trigger = False
            self.bearish_trigger = False
            self.trigger_high = None
            self.trigger_low = None
            self.bars_since_trigger = 0
            self.recent_highs = []
            self.recent_lows = []
            self.block_long = False
            self.block_short = False
            self.last_date = bar_date

        if self.prev_day_high is None:
            return

        pivot = (self.prev_day_high + self.prev_day_low + self.prev_day_close) / 3.0
        bc = (self.prev_day_high + self.prev_day_low) / 2.0
        tc = (2.0 * pivot) - bc

        ema20 = ctx.ema(close, self.ema_fast)
        ema60 = ctx.ema(close, self.ema_slow)
        cur_ema20 = ema20.iloc[-1]
        cur_ema60 = ema60.iloc[-1]

        before_cutoff = (bar_hour < self.cutoff_hour
            or (bar_hour == self.cutoff_hour and bar_min < self.cutoff_minute))

        bull_cond = cur_close > cur_ema20 and cur_close > cur_ema60 and cur_close > tc
        bear_cond = cur_close < cur_ema20 and cur_close < cur_ema60 and cur_close < bc

        if self.bullish_trigger or self.bearish_trigger:
            self.bars_since_trigger += 1
            self.recent_highs.append(cur_high)
            self.recent_lows.append(cur_low)

        if (bull_cond and not self.bullish_trigger
                and not self.in_long and not self.block_long and before_cutoff):
            self.bullish_trigger = True
            self.trigger_high = cur_high
            self.bars_since_trigger = 0
            self.recent_highs = [cur_high]
            self.recent_lows = [cur_low]
            ctx.log("BULL TRIGGER | close=" + str(round(cur_close, 2))
                    + " trigHigh=" + str(round(cur_high, 2)))

        if (bear_cond and not self.bearish_trigger
                and not self.in_short and not self.block_short and before_cutoff):
            self.bearish_trigger = True
            self.trigger_low = cur_low
            self.bars_since_trigger = 0
            self.recent_highs = [cur_high]
            self.recent_lows = [cur_low]
            ctx.log("BEAR TRIGGER | close=" + str(round(cur_close, 2))
                    + " trigLow=" + str(round(cur_low, 2)))

        min_bars = self.swing_bars * 2 + 1
        if self.bullish_trigger and self.bars_since_trigger >= min_bars:
            if self.swing_high_below(self.trigger_high):
                self.bullish_trigger = False
                self.trigger_high = None
                ctx.log("Bull trigger INVALIDATED")
        if self.bearish_trigger and self.bars_since_trigger >= min_bars:
            if self.swing_low_above(self.trigger_low):
                self.bearish_trigger = False
                self.trigger_low = None
                ctx.log("Bear trigger INVALIDATED")

        # Long entry: breakout above trigger high -> SELL PE
        if (self.bullish_trigger and not self.in_long
                and not self.block_long and before_cutoff
                and cur_close > self.trigger_high):
            opt = self._find_option_by_delta(ctx, cur_close, "PE", closes_list)
            if opt:
                qty = self.num_lots * opt.get("lot_size", 25)
                self.held_lot_size = opt.get("lot_size", 25)
                ctx.sell(opt["tradingsymbol"], qty, exchange="NFO", product="NRML")
                self.held_option = opt["tradingsymbol"]
                self.entry_price = cur_close
                self.current_sl = cur_close - self.initial_sl
                self.peak_profit = 0.0
                self.tsl_step = 0
                self.tsl_active = False
                self.in_long = True
                self.bullish_trigger = False
                self.trigger_high = None
                ctx.log("LONG ENTRY (Sell " + opt["tradingsymbol"] + ") @ "
                        + str(round(cur_close, 2)) + " | SL=" + str(round(self.current_sl, 2)))

        # Short entry: breakdown below trigger low -> SELL CE
        if (self.bearish_trigger and not self.in_short
                and not self.block_short and before_cutoff
                and cur_close < self.trigger_low):
            opt = self._find_option_by_delta(ctx, cur_close, "CE", closes_list)
            if opt:
                qty = self.num_lots * opt.get("lot_size", 25)
                self.held_lot_size = opt.get("lot_size", 25)
                ctx.sell(opt["tradingsymbol"], qty, exchange="NFO", product="NRML")
                self.held_option = opt["tradingsymbol"]
                self.entry_price = cur_close
                self.current_sl = cur_close + self.initial_sl
                self.peak_profit = 0.0
                self.tsl_step = 0
                self.tsl_active = False
                self.in_short = True
                self.bearish_trigger = False
                self.trigger_low = None
                ctx.log("SHORT ENTRY (Sell " + opt["tradingsymbol"] + ") @ "
                        + str(round(cur_close, 2)) + " | SL=" + str(round(self.current_sl, 2)))

        # TSL: Long
        if self.in_long and self.entry_price is not None:
            unrealized = cur_close - self.entry_price
            if unrealized > self.peak_profit:
                self.peak_profit = unrealized
            if not self.tsl_active and self.peak_profit >= self.tsl_activation:
                self.tsl_active = True
                self.tsl_step = 1
                lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                self.current_sl = self.entry_price + lock
                ctx.log("TSL ON (Long) step=1 | SL=" + str(round(self.current_sl, 2)))
            if self.tsl_active and self.peak_profit > self.tsl_activation:
                new_step = 1 + int((self.peak_profit - self.tsl_activation) / self.tsl_step_size)
                if new_step > self.tsl_step:
                    self.tsl_step = new_step
                    lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                    self.current_sl = self.entry_price + lock
                    ctx.log("TSL step=" + str(self.tsl_step) + " | SL=" + str(round(self.current_sl, 2)))
            if cur_close <= self.current_sl:
                reason = "TSL" if self.tsl_active else "Initial SL"
                self._exit_held_option(ctx, "LONG " + reason)
                ctx.log("LONG EXIT (" + reason + ") @ " + str(round(cur_close, 2)))
                if self.tsl_active:
                    self.block_long = True
                self.reset_position()

        # TSL: Short
        if self.in_short and self.entry_price is not None:
            unrealized = self.entry_price - cur_close
            if unrealized > self.peak_profit:
                self.peak_profit = unrealized
            if not self.tsl_active and self.peak_profit >= self.tsl_activation:
                self.tsl_active = True
                self.tsl_step = 1
                lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                self.current_sl = self.entry_price - lock
                ctx.log("TSL ON (Short) step=1 | SL=" + str(round(self.current_sl, 2)))
            if self.tsl_active and self.peak_profit > self.tsl_activation:
                new_step = 1 + int((self.peak_profit - self.tsl_activation) / self.tsl_step_size)
                if new_step > self.tsl_step:
                    self.tsl_step = new_step
                    lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                    self.current_sl = self.entry_price - lock
                    ctx.log("TSL step=" + str(self.tsl_step) + " | SL=" + str(round(self.current_sl, 2)))
            if cur_close >= self.current_sl:
                reason = "TSL" if self.tsl_active else "Initial SL"
                self._exit_held_option(ctx, "SHORT " + reason)
                ctx.log("SHORT EXIT (" + reason + ") @ " + str(round(cur_close, 2)))
                if self.tsl_active:
                    self.block_short = True
                self.reset_position()

        # Time cutoff 3:10 PM
        if not before_cutoff:
            if self.in_long:
                self._exit_held_option(ctx, "Cutoff 3:10 PM")
                ctx.log("LONG EXIT (Cutoff) @ " + str(round(cur_close, 2)))
                self.reset_position()
            if self.in_short:
                self._exit_held_option(ctx, "Cutoff 3:10 PM")
                ctx.log("SHORT EXIT (Cutoff) @ " + str(round(cur_close, 2)))
                self.reset_position()

    def reset_position(self):
        self.in_long = False
        self.in_short = False
        self.entry_price = None
        self.current_sl = None
        self.peak_profit = 0.0
        self.tsl_step = 0
        self.tsl_active = False
        self.held_option = None

    def calc_prev_day_hlc(self, data, current_date):
        day_data = {}
        for ts in data.index:
            if not hasattr(ts, "date"):
                continue
            d = ts.date()
            if d >= current_date:
                continue
            if d not in day_data:
                day_data[d] = {"high": [], "low": [], "close": None}
            day_data[d]["high"].append(data.loc[ts, "high"])
            day_data[d]["low"].append(data.loc[ts, "low"])
            day_data[d]["close"] = data.loc[ts, "close"]
        if not day_data:
            return
        prev_date = max(day_data.keys())
        self.prev_day_high = max(day_data[prev_date]["high"])
        self.prev_day_low = min(day_data[prev_date]["low"])
        self.prev_day_close = day_data[prev_date]["close"]

    def swing_high_below(self, threshold):
        n = len(self.recent_highs)
        sb = self.swing_bars
        if n < sb * 2 + 1:
            return False
        for i in range(sb, n - sb):
            is_swing = True
            for j in range(1, sb + 1):
                if (self.recent_highs[i - j] >= self.recent_highs[i]
                        or self.recent_highs[i + j] >= self.recent_highs[i]):
                    is_swing = False
                    break
            if is_swing and self.recent_highs[i] < threshold:
                return True
        return False

    def swing_low_above(self, threshold):
        n = len(self.recent_lows)
        sb = self.swing_bars
        if n < sb * 2 + 1:
            return False
        for i in range(sb, n - sb):
            is_swing = True
            for j in range(1, sb + 1):
                if (self.recent_lows[i - j] <= self.recent_lows[i]
                        or self.recent_lows[i + j] <= self.recent_lows[i]):
                    is_swing = False
                    break
            if is_swing and self.recent_lows[i] > threshold:
                return True
        return False

    def on_order_fill(self, ctx, order):
        ctx.log("FILLED: " + order.side + " " + order.symbol
                + " x" + str(order.quantity) + " @ " + str(order.fill_price))

    def on_stop(self, ctx):
        ctx.log("EMA+CPR Options Selling Strategy stopped")
`;

const SUPERTREND_TEMPLATE = `class SuperTrendStrategy(Strategy):
    """
    SuperTrend Strategy — follows trend using the SuperTrend indicator.
    Goes long when price crosses above SuperTrend, exits when it crosses below.

    Parameters:
        atr_period    — ATR period for SuperTrend (default: 10)
        multiplier    — ATR multiplier (default: 3.0)
        symbol        — Trading symbol (default: "NIFTY 50")
        quantity      — Order quantity (default: 25)
    """

    def on_init(self, ctx):
        self.atr_period = ctx.get_param("atr_period", 10)
        self.multiplier = ctx.get_param("multiplier", 3.0)
        self.symbol = ctx.get_param("symbol", "NIFTY 50")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.quantity = ctx.get_param("quantity", 25)
        self.product = ctx.get_param("product", "CNC")

    def on_data(self, ctx):
        lookback = self.atr_period + 20
        data = ctx.get_historical_data(
            self.symbol, exchange=self.exchange, periods=lookback
        )
        if data is None or len(data) < self.atr_period + 5:
            return

        st = ctx.supertrend(
            data["high"], data["low"], data["close"],
            period=self.atr_period, multiplier=self.multiplier
        )

        close = data["close"]
        position = ctx.get_position(self.symbol)

        # Bullish: close above SuperTrend
        if ctx.crossover(close, st) and position is None:
            ctx.buy(self.symbol, self.quantity,
                    exchange=self.exchange, product=self.product)
            ctx.log("LONG — SuperTrend crossover at " + str(close.iloc[-1]))

        # Bearish: close below SuperTrend
        elif ctx.crossunder(close, st) and position is not None:
            ctx.sell(self.symbol, position.quantity,
                     exchange=self.exchange, product=self.product)
            ctx.log("EXIT — SuperTrend crossunder at " + str(close.iloc[-1]))
`;

export const STRATEGY_TEMPLATES = [
  {
    id: "blank",
    name: "SMA Crossover (Default)",
    description: "Simple Moving Average crossover strategy",
    code: DEFAULT_TEMPLATE,
  },
  {
    id: "ema-cross",
    name: "EMA Cross Strategy",
    description: "EMA crossover/crossunder with long/short reversal — NIFTY 50 index",
    code: EMA_CROSS_TEMPLATE,
  },
  {
    id: "rsi-reversion",
    name: "RSI Mean Reversion",
    description: "Buy oversold, sell overbought using RSI",
    code: RSI_MEAN_REVERSION_TEMPLATE,
  },
  {
    id: "supertrend",
    name: "SuperTrend Follower",
    description: "Trend-following using the SuperTrend indicator",
    code: SUPERTREND_TEMPLATE,
  },
  {
    id: "ema-cpr",
    name: "Nifty EMA+CPR Options Selling",
    description: "EMA-20/60 + CPR levels with stepwise trailing SL — NIFTY 50 intraday",
    code: EMA_CPR_TEMPLATE,
  },
];

interface StrategyEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  showTemplates?: boolean;
}

export function StrategyEditor({
  value,
  onChange,
  readOnly = false,
  showTemplates = false,
}: StrategyEditorProps) {
  const editorRef = useRef<any>(null);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const displayValue = value || DEFAULT_TEMPLATE;

  return (
    <div className="h-full w-full flex flex-col">
      {showTemplates && (
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground">Template:</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            defaultValue=""
            onChange={(e) => {
              const tmpl = STRATEGY_TEMPLATES.find((t) => t.id === e.target.value);
              if (tmpl) {
                onChange(tmpl.code);
              }
            }}
          >
            <option value="" disabled>
              Load a template...
            </option>
            {STRATEGY_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex-1 min-h-0 rounded-md border border-input overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="python"
          theme="vs-dark"
          value={displayValue}
          onChange={(val) => onChange(val ?? "")}
          onMount={handleEditorMount}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 4,
            insertSpaces: true,
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
            contextmenu: true,
            folding: true,
            bracketPairColorization: { enabled: true },
          }}
          loading={
            <div className="flex items-center justify-center h-full bg-[#1e1e1e] text-gray-400 text-sm">
              Loading editor...
            </div>
          }
        />
      </div>
    </div>
  );
}
