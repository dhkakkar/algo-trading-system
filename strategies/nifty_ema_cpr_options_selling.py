import math


def norm_cdf(x):
    """Approximation of the standard normal CDF."""
    if x > 6.0:
        return 1.0
    if x < -6.0:
        return 0.0
    t = 1.0 / (1.0 + 0.2316419 * abs(x))
    d = 0.3989422804014327  # 1/sqrt(2*pi)
    p = d * math.exp(-x * x / 2.0) * (
        t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    )
    return 1.0 - p if x > 0 else p


def bs_delta(spot, strike, tte_years, vol, r=0.07, option_type="CE"):
    """Black-Scholes delta for a European option."""
    if tte_years <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        if option_type == "CE":
            return 1.0 if spot >= strike else 0.0
        return -1.0 if spot <= strike else 0.0
    d1 = (math.log(spot / strike) + (r + 0.5 * vol ** 2) * tte_years) / (vol * math.sqrt(tte_years))
    if option_type == "CE":
        return norm_cdf(d1)
    return norm_cdf(d1) - 1.0


def historical_vol(closes, period=20):
    """Annualized historical volatility from a list of close prices."""
    if len(closes) < period + 1:
        return 0.15  # default fallback
    log_rets = [math.log(closes[i] / closes[i - 1])
                for i in range(len(closes) - period, len(closes))]
    mean = sum(log_rets) / len(log_rets)
    var = sum((r - mean) ** 2 for r in log_rets) / (len(log_rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


class NiftyEMACPRStrategy(Strategy):
    """
    Nifty EMA+CPR Options Selling Strategy

    Uses EMA-20/EMA-60 with CPR (Central Pivot Range) levels on a 5-min
    Nifty chart to generate directional signals.  Sells OTM options
    (PE on bullish signal, CE on bearish signal) targeting delta ~0.4.

    Signal logic runs on the underlying (NIFTY 50); execution is on NFO
    options.  SL, TSL and TP are tracked on per-lot P&L in INR.

    Parameters:
        symbol          -- Underlying symbol (default: "NIFTY 50")
        exchange        -- Underlying exchange (default: "NSE")
        quantity        -- Number of lots (default: 1)
        target_delta    -- Option |delta| to target (default: 0.4)
        ema_fast        -- Fast EMA period (default: 20)
        ema_slow        -- Slow EMA period (default: 60)
        tp_per_lot      -- Take profit per lot in INR (default: 3000)
        sl_per_lot      -- Initial stop loss per lot in INR (default: 2000)
        tsl_activation  -- TSL activation profit per lot in INR (default: 1500)
        tsl_lock_pct    -- TSL lock-in percentage (default: 50)
        tsl_step_per_lot -- TSL step size per lot in INR (default: 200)
        swing_bars      -- Bars for trigger invalidation (default: 3)
        cutoff_hour     -- Time cutoff hour IST (default: 15)
        cutoff_minute   -- Time cutoff minute (default: 10)
    """

    def on_init(self, ctx):
        # --- Underlying ---
        self.symbol = ctx.get_param("symbol", "NIFTY 50")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.num_lots = ctx.get_param("quantity", 1)
        self.target_delta = ctx.get_param("target_delta", 0.4)

        # --- EMA periods ---
        self.ema_fast = ctx.get_param("ema_fast", 20)
        self.ema_slow = ctx.get_param("ema_slow", 60)

        # --- P&L-based exits (INR per lot) ---
        self.tp_per_lot = ctx.get_param("tp_per_lot", 3000)
        self.sl_per_lot = ctx.get_param("sl_per_lot", 2000)
        self.tsl_activation = ctx.get_param("tsl_activation", 1500)
        self.tsl_lock_pct = ctx.get_param("tsl_lock_pct", 50)
        self.tsl_step_per_lot = ctx.get_param("tsl_step_per_lot", 200)

        # --- Trigger ---
        self.swing_bars = ctx.get_param("swing_bars", 3)

        # --- Time cutoff (IST) ---
        self.entry_cutoff_hour = ctx.get_param("entry_cutoff_hour", 14)
        self.entry_cutoff_minute = ctx.get_param("entry_cutoff_minute", 45)
        self.cutoff_hour = ctx.get_param("cutoff_hour", 15)
        self.cutoff_minute = ctx.get_param("cutoff_minute", 10)

        # --- Trigger state ---
        self.bullish_trigger = False
        self.bearish_trigger = False
        self.trigger_high = None
        self.trigger_low = None
        self.bars_since_trigger = 0
        self.recent_highs = []
        self.recent_lows = []

        # --- Position state ---
        self.in_long = False
        self.in_short = False
        self.entry_premium = None   # option premium at sell
        self.peak_pnl_per_lot = 0.0
        self.tsl_step = 0
        self.tsl_active = False
        self.sl_level_per_lot = None  # current SL level in INR per lot (negative = loss)

        # --- Options position tracking ---
        self.held_option = None
        self.held_lot_size = 25

        # --- Re-entry blocking ---
        self.block_long = False
        self.block_short = False

        # --- Previous day HLC for CPR ---
        self.last_date = None
        self.prev_day_high = None
        self.prev_day_low = None
        self.prev_day_close = None

        ctx.log(
            "EMA+CPR Options Selling init: underlying=" + self.symbol
            + " lots=" + str(self.num_lots)
            + " target_delta=" + str(self.target_delta)
            + " TP/lot=" + str(self.tp_per_lot)
            + " SL/lot=" + str(self.sl_per_lot)
        )

    # -- Option selection --------------------------------------------------

    def find_option_by_delta(self, ctx, spot, option_type, closes_list):
        """Find the option with |delta| closest to target_delta."""
        expiry = ctx.get_nearest_expiry(self.symbol)
        if expiry is None:
            ctx.log("WARNING: No expiry found for options")
            return None

        chain = ctx.get_option_chain(self.symbol, expiry)
        if not chain:
            ctx.log("WARNING: Empty option chain")
            return None

        options = [o for o in chain if o["option_type"] == option_type]
        if not options:
            ctx.log("WARNING: No " + option_type + " options in chain")
            return None

        vol = historical_vol(closes_list)

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
            delta = bs_delta(spot, opt["strike"], tte_years, vol,
                             option_type=option_type)
            diff = abs(abs(delta) - self.target_delta)
            if diff < best_diff:
                best_diff = diff
                best = opt
                best_delta = delta

        if best:
            ctx.log(
                "Selected " + option_type + ": " + best["tradingsymbol"]
                + " strike=" + str(best["strike"])
                + " delta=" + str(round(best_delta, 3))
                + " vol=" + str(round(vol, 3))
                + " DTE=" + str(dte)
            )
        return best

    # -- Exit held option helper -------------------------------------------

    def exit_held_option(self, ctx, reason):
        """Buy back the sold option to close the position."""
        if self.held_option:
            qty = self.num_lots * self.held_lot_size
            ctx.buy(self.held_option, qty, exchange="NFO", product="MIS")
            ctx.log("EXIT (" + reason + ") | buyback " + self.held_option
                    + " x" + str(qty))

    # -- P&L helper --------------------------------------------------------

    def calc_pnl_per_lot(self, ctx):
        """Return current P&L per lot in INR (positive = profit for seller).

        For options selling: profit = (entry_premium - current_premium) * lot_size
        """
        if self.entry_premium is None or self.held_option is None:
            return 0.0
        current_premium = ctx.get_option_price(self.held_option)
        if current_premium is None:
            return 0.0
        return (self.entry_premium - current_premium) * self.held_lot_size

    # -- Main bar handler --------------------------------------------------

    def on_data(self, ctx):
        lookback = max(self.ema_slow + 10, 200)
        data = ctx.get_historical_data(
            self.symbol, exchange=self.exchange, periods=lookback
        )
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

        # Use IST time for cutoff and day tracking
        bar_hour, bar_min = ctx.get_bar_ist_time()
        bar_date = timestamp.date() if hasattr(timestamp, "date") else None

        # -- New day reset -------------------------------------------------
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

        # -- CPR -----------------------------------------------------------
        pivot = (self.prev_day_high + self.prev_day_low + self.prev_day_close) / 3.0
        bc = (self.prev_day_high + self.prev_day_low) / 2.0
        tc = (2.0 * pivot) - bc

        # -- EMAs ----------------------------------------------------------
        ema20 = ctx.ema(close, self.ema_fast)
        ema60 = ctx.ema(close, self.ema_slow)
        cur_ema20 = ema20.iloc[-1]
        cur_ema60 = ema60.iloc[-1]

        before_entry_cutoff = (
            bar_hour < self.entry_cutoff_hour
            or (bar_hour == self.entry_cutoff_hour and bar_min < self.entry_cutoff_minute)
        )
        before_cutoff = (
            bar_hour < self.cutoff_hour
            or (bar_hour == self.cutoff_hour and bar_min < self.cutoff_minute)
        )

        # -- Trigger conditions --------------------------------------------
        bull_cond = (cur_close > cur_ema20 and cur_close > cur_ema60
                     and cur_close > pivot and cur_close > bc and cur_close > tc)
        bear_cond = (cur_close  < cur_ema20 and cur_close < cur_ema60
                     and cur_close < pivot and cur_close < bc and cur_close < tc)

        if self.bullish_trigger or self.bearish_trigger:
            self.bars_since_trigger = self.bars_since_trigger + 1
            self.recent_highs.append(cur_high)
            self.recent_lows.append(cur_low)

        # -- New bullish trigger -------------------------------------------
        if (bull_cond and not self.bullish_trigger
                and not self.in_long and not self.block_long and before_entry_cutoff):
            self.bullish_trigger = True
            self.trigger_high = cur_high
            self.bars_since_trigger = 0
            self.recent_highs = [cur_high]
            self.recent_lows = [cur_low]
            ctx.log(
                "BULL TRIGGER | close=" + str(round(cur_close, 2))
                + " trigHigh=" + str(round(cur_high, 2))
                + " TC=" + str(round(tc, 2))
            )

        # -- New bearish trigger -------------------------------------------
        if (bear_cond and not self.bearish_trigger
                and not self.in_short and not self.block_short and before_entry_cutoff):
            self.bearish_trigger = True
            self.trigger_low = cur_low
            self.bars_since_trigger = 0
            self.recent_highs = [cur_high]
            self.recent_lows = [cur_low]
            ctx.log(
                "BEAR TRIGGER | close=" + str(round(cur_close, 2))
                + " trigLow=" + str(round(cur_low, 2))
                + " BC=" + str(round(bc, 2))
            )

        # -- Trigger negation (close back below/above any level) ------------
        if self.bullish_trigger and not self.in_long:
            if (cur_close < cur_ema20 or cur_close < cur_ema60
                    or cur_close < pivot or cur_close < bc or cur_close < tc):
                self.bullish_trigger = False
                self.trigger_high = None
                ctx.log("BULL TRIGGER NEGATED | close=" + str(round(cur_close, 2)))

        if self.bearish_trigger and not self.in_short:
            if (cur_close > cur_ema20 or cur_close > cur_ema60
                    or cur_close > pivot or cur_close > bc or cur_close > tc):
                self.bearish_trigger = False
                self.trigger_low = None
                ctx.log("BEAR TRIGGER NEGATED | close=" + str(round(cur_close, 2)))

        # -- Trigger invalidation (swing) ----------------------------------
        min_bars_for_swing = self.swing_bars * 2 + 1

        if self.bullish_trigger and self.bars_since_trigger >= min_bars_for_swing:
            if self.swing_high_below(self.trigger_high):
                self.bullish_trigger = False
                self.trigger_high = None
                ctx.log("Bull trigger INVALIDATED (swing high)")

        if self.bearish_trigger and self.bars_since_trigger >= min_bars_for_swing:
            if self.swing_low_above(self.trigger_low):
                self.bearish_trigger = False
                self.trigger_low = None
                ctx.log("Bear trigger INVALIDATED (swing low)")

        # -- Long entry: breakout above trigger high -> SELL PE ------------
        if (self.bullish_trigger and not self.in_long
                and not self.block_long and before_entry_cutoff
                and cur_close > self.trigger_high):
            opt = self.find_option_by_delta(ctx, cur_close, "PE", closes_list)
            if opt:
                qty = self.num_lots * opt.get("lot_size", 25)
                self.held_lot_size = opt.get("lot_size", 25)
                ctx.sell(opt["tradingsymbol"], qty, exchange="NFO", product="MIS")
                self.held_option = opt["tradingsymbol"]
                self.entry_premium = None  # will be set on fill
                self.peak_pnl_per_lot = 0.0
                self.tsl_step = 0
                self.tsl_active = False
                self.sl_level_per_lot = 0.0 - self.sl_per_lot
                self.in_long = True
                self.bullish_trigger = False
                self.trigger_high = None
                ctx.log(
                    "LONG ENTRY (Sell " + opt["tradingsymbol"] + ") @ underlying="
                    + str(round(cur_close, 2))
                    + " | SL/lot=" + str(self.sl_per_lot) + " INR"
                    + " | TP/lot=" + str(self.tp_per_lot) + " INR"
                )

        # -- Short entry: breakdown below trigger low -> SELL CE -----------
        if (self.bearish_trigger and not self.in_short
                and not self.block_short and before_entry_cutoff
                and cur_close < self.trigger_low):
            opt = self.find_option_by_delta(ctx, cur_close, "CE", closes_list)
            if opt:
                qty = self.num_lots * opt.get("lot_size", 25)
                self.held_lot_size = opt.get("lot_size", 25)
                ctx.sell(opt["tradingsymbol"], qty, exchange="NFO", product="MIS")
                self.held_option = opt["tradingsymbol"]
                self.entry_premium = None  # will be set on fill
                self.peak_pnl_per_lot = 0.0
                self.tsl_step = 0
                self.tsl_active = False
                self.sl_level_per_lot = 0.0 - self.sl_per_lot
                self.in_short = True
                self.bearish_trigger = False
                self.trigger_low = None
                ctx.log(
                    "SHORT ENTRY (Sell " + opt["tradingsymbol"] + ") @ underlying="
                    + str(round(cur_close, 2))
                    + " | SL/lot=" + str(self.sl_per_lot) + " INR"
                    + " | TP/lot=" + str(self.tp_per_lot) + " INR"
                )

        # -- P&L-based exits (TP / SL / TSL) ------------------------------
        if (self.in_long or self.in_short) and self.entry_premium is not None:
            pnl_per_lot = self.calc_pnl_per_lot(ctx)

            # Level-cross exit (price crossed adverse EMA/CPR level)
            level_cross_exit = False
            if self.in_long:
                if (cur_close < cur_ema20 and cur_close < cur_ema60
                        and cur_close < pivot and cur_close < bc and cur_close < tc):
                    level_cross_exit = True
            elif self.in_short:
                if (cur_close > cur_ema20 and cur_close > cur_ema60
                        and cur_close > pivot and cur_close > bc and cur_close > tc):
                    level_cross_exit = True

            if level_cross_exit:
                direction = "LONG" if self.in_long else "SHORT"
                self.exit_held_option(ctx, direction + " Level Cross")
                ctx.log(direction + " EXIT (Level Cross) | P&L/lot="
                        + str(round(pnl_per_lot, 2)) + " INR")
                if self.in_long:
                    self.block_long = True
                else:
                    self.block_short = True
                self.reset_position()

            # Take Profit
            elif pnl_per_lot >= self.tp_per_lot:
                direction = "LONG" if self.in_long else "SHORT"
                self.exit_held_option(ctx, direction + " TP")
                ctx.log(direction + " EXIT (TP) | P&L/lot=" + str(round(pnl_per_lot, 2)) + " INR")
                if self.in_long:
                    self.block_long = True
                else:
                    self.block_short = True
                self.reset_position()
            else:
                # Track peak profit
                if pnl_per_lot > self.peak_pnl_per_lot:
                    self.peak_pnl_per_lot = pnl_per_lot

                # TSL activation
                if not self.tsl_active and self.peak_pnl_per_lot >= self.tsl_activation:
                    self.tsl_active = True
                    self.tsl_step = 1
                    lock = self.peak_pnl_per_lot * (self.tsl_lock_pct / 100.0)
                    self.sl_level_per_lot = lock
                    ctx.log("TSL ON step=1 | peak=" + str(round(self.peak_pnl_per_lot, 2))
                            + " | SL/lot=" + str(round(self.sl_level_per_lot, 2)) + " INR")

                # TSL stepping
                if self.tsl_active and self.peak_pnl_per_lot > self.tsl_activation:
                    new_step = 1 + int(
                        (self.peak_pnl_per_lot - self.tsl_activation) / self.tsl_step_per_lot
                    )
                    if new_step > self.tsl_step:
                        self.tsl_step = new_step
                        lock = self.peak_pnl_per_lot * (self.tsl_lock_pct / 100.0)
                        self.sl_level_per_lot = lock
                        ctx.log("TSL step=" + str(self.tsl_step)
                                + " | SL/lot=" + str(round(self.sl_level_per_lot, 2)) + " INR")

                # SL check (pnl dropped below SL level)
                if pnl_per_lot <= self.sl_level_per_lot:
                    direction = "LONG" if self.in_long else "SHORT"
                    reason = "TSL" if self.tsl_active else "Initial SL"
                    self.exit_held_option(ctx, direction + " " + reason)
                    ctx.log(direction + " EXIT (" + reason + ") | P&L/lot="
                            + str(round(pnl_per_lot, 2)) + " INR")
                    if self.in_long:
                        self.block_long = True
                    else:
                        self.block_short = True
                    self.reset_position()

        # -- Time cutoff -- 3:10 PM IST ------------------------------------
        if not before_cutoff:
            if self.in_long:
                pnl = self.calc_pnl_per_lot(ctx)
                self.exit_held_option(ctx, "Cutoff 3:10 PM")
                ctx.log("LONG EXIT (Cutoff) | P&L/lot=" + str(round(pnl, 2)) + " INR")
                self.reset_position()

            if self.in_short:
                pnl = self.calc_pnl_per_lot(ctx)
                self.exit_held_option(ctx, "Cutoff 3:10 PM")
                ctx.log("SHORT EXIT (Cutoff) | P&L/lot=" + str(round(pnl, 2)) + " INR")
                self.reset_position()

            # Clear any pending triggers — no new trades after cutoff
            self.bullish_trigger = False
            self.bearish_trigger = False
            self.trigger_high = None
            self.trigger_low = None
            return

    # -- Helpers -----------------------------------------------------------

    def reset_position(self):
        """Clear all position-related state."""
        self.in_long = False
        self.in_short = False
        self.entry_premium = None
        self.peak_pnl_per_lot = 0.0
        self.sl_level_per_lot = None
        self.tsl_step = 0
        self.tsl_active = False
        self.held_option = None

    def calc_prev_day_hlc(self, data, current_date):
        """Aggregate intraday bars to get previous day's High, Low, Close."""
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
        """True if a swing high below threshold exists in recent bars."""
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
        """True if a swing low above threshold exists in recent bars."""
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
        """Handle order fills: record entry premium on SELL, reset on BUY."""
        ctx.log(
            "FILLED: " + order.side + " " + order.symbol
            + " x" + str(order.quantity) + " @ " + str(order.fill_price)
        )
        # When the sell (entry) fills, store the premium
        if order.side == "SELL" and self.entry_premium is None:
            self.entry_premium = order.fill_price
            ctx.log("Entry premium recorded: " + str(round(order.fill_price, 2))
                    + " | lot_size=" + str(self.held_lot_size))
        # When a buy (exit/cover) fills, ensure position state is reset
        # This handles both strategy-initiated exits and runner EOD closes
        elif order.side == "BUY" and (self.in_long or self.in_short):
            self.reset_position()

    def on_order_reject(self, ctx, order):
        """Handle rejected orders: reset position state."""
        ctx.log(
            "ORDER REJECTED: " + order.side + " " + order.symbol
            + " x" + str(order.quantity) + " (no OHLCV data)"
        )
        if self.in_long or self.in_short:
            self.reset_position()

    def on_stop(self, ctx):
        ctx.log("EMA+CPR Options Selling Strategy stopped")
