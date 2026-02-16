class NiftyEMACPRStrategy(Strategy):
    """
    Nifty EMA+CPR Options Selling Strategy

    Uses EMA-20/EMA-60 with CPR (Central Pivot Range) levels on a 5-min
    Nifty Futures chart to generate entry signals.  Implements stepwise
    trailing stop-loss, 3:10 PM time cutoff, and re-entry blocking.

    Parameters:
        symbol          — Trading symbol (default: "NIFTY 50")
        exchange        — Exchange (default: "NSE")
        quantity        — Lot size (default: 25)
        ema_fast        — Fast EMA period (default: 20)
        ema_slow        — Slow EMA period (default: 60)
        initial_sl      — Initial stop loss amount (default: 2500)
        tsl_activation  — TSL activation profit threshold (default: 2000)
        tsl_lock_pct    — TSL lock-in percentage (default: 50)
        tsl_step_size   — TSL step size (default: 200)
        swing_bars      — Bars for trigger invalidation (default: 3)
        cutoff_hour     — Time cutoff hour IST (default: 15)
        cutoff_minute   — Time cutoff minute (default: 10)
    """

    def on_init(self, ctx):
        # --- Symbol & sizing ---
        self.symbol = ctx.get_param("symbol", "NIFTY 50")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.quantity = ctx.get_param("quantity", 25)
        self.product = ctx.get_param("product", "MIS")

        # --- EMA periods ---
        self.ema_fast = ctx.get_param("ema_fast", 20)
        self.ema_slow = ctx.get_param("ema_slow", 60)

        # --- Stop-loss & trailing ---
        self.initial_sl = ctx.get_param("initial_sl", 2500)
        self.tsl_activation = ctx.get_param("tsl_activation", 2000)
        self.tsl_lock_pct = ctx.get_param("tsl_lock_pct", 50)
        self.tsl_step_size = ctx.get_param("tsl_step_size", 200)

        # --- Trigger ---
        self.swing_bars = ctx.get_param("swing_bars", 3)

        # --- Time cutoff (IST) ---
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
        self.entry_price = None
        self.current_sl = None
        self.peak_profit = 0.0
        self.tsl_step = 0
        self.tsl_active = False

        # --- Re-entry blocking ---
        self.block_long = False
        self.block_short = False

        # --- Previous day HLC for CPR ---
        self.last_date = None
        self.prev_day_high = None
        self.prev_day_low = None
        self.prev_day_close = None

        ctx.log(
            "EMA+CPR Strategy init: symbol=" + self.symbol
            + " qty=" + str(self.quantity)
            + " SL=" + str(self.initial_sl)
            + " TSL_act=" + str(self.tsl_activation)
        )

    # ── Main bar handler ─────────────────────────────────────────

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

        # Extract IST time from bar timestamp
        bar_hour = timestamp.hour if hasattr(timestamp, "hour") else 0
        bar_min = timestamp.minute if hasattr(timestamp, "minute") else 0
        bar_date = timestamp.date() if hasattr(timestamp, "date") else None

        # ── New day reset ────────────────────────────────────────
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

        # Need previous-day data for CPR
        if self.prev_day_high is None:
            return

        # ── CPR ──────────────────────────────────────────────────
        pivot = (self.prev_day_high + self.prev_day_low + self.prev_day_close) / 3.0
        bc = (self.prev_day_high + self.prev_day_low) / 2.0
        tc = (2.0 * pivot) - bc

        # ── EMAs ─────────────────────────────────────────────────
        ema20 = ctx.ema(close, self.ema_fast)
        ema60 = ctx.ema(close, self.ema_slow)
        cur_ema20 = ema20.iloc[-1]
        cur_ema60 = ema60.iloc[-1]

        # ── Time check ───────────────────────────────────────────
        before_cutoff = (
            bar_hour < self.cutoff_hour
            or (bar_hour == self.cutoff_hour and bar_min < self.cutoff_minute)
        )

        # ── Trigger conditions ───────────────────────────────────
        bull_cond = cur_close > cur_ema20 and cur_close > cur_ema60 and cur_close > tc
        bear_cond = cur_close < cur_ema20 and cur_close < cur_ema60 and cur_close < bc

        # Track bars for swing invalidation
        if self.bullish_trigger or self.bearish_trigger:
            self.bars_since_trigger = self.bars_since_trigger + 1
            self.recent_highs.append(cur_high)
            self.recent_lows.append(cur_low)

        # ── New bullish trigger ──────────────────────────────────
        if (bull_cond and not self.bullish_trigger
                and not self.in_long and not self.block_long and before_cutoff):
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

        # ── New bearish trigger ──────────────────────────────────
        if (bear_cond and not self.bearish_trigger
                and not self.in_short and not self.block_short and before_cutoff):
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

        # ── Trigger invalidation (3-bar swing) ──────────────────
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

        # ── Long entry: breakout above trigger high ──────────────
        if (self.bullish_trigger and not self.in_long
                and not self.block_long and before_cutoff
                and cur_close > self.trigger_high):
            ctx.buy(self.symbol, self.quantity,
                    exchange=self.exchange, product=self.product)
            self.entry_price = cur_close
            self.current_sl = cur_close - self.initial_sl
            self.peak_profit = 0.0
            self.tsl_step = 0
            self.tsl_active = False
            self.in_long = True
            self.bullish_trigger = False
            self.trigger_high = None
            ctx.log(
                "LONG ENTRY @ " + str(round(cur_close, 2))
                + " | SL=" + str(round(self.current_sl, 2))
            )

        # ── Short entry: breakdown below trigger low ─────────────
        if (self.bearish_trigger and not self.in_short
                and not self.block_short and before_cutoff
                and cur_close < self.trigger_low):
            ctx.sell(self.symbol, self.quantity,
                     exchange=self.exchange, product=self.product)
            self.entry_price = cur_close
            self.current_sl = cur_close + self.initial_sl
            self.peak_profit = 0.0
            self.tsl_step = 0
            self.tsl_active = False
            self.in_short = True
            self.bearish_trigger = False
            self.trigger_low = None
            ctx.log(
                "SHORT ENTRY @ " + str(round(cur_close, 2))
                + " | SL=" + str(round(self.current_sl, 2))
            )

        # ── Stepwise trailing SL — LONG ─────────────────────────
        if self.in_long and self.entry_price is not None:
            unrealized = cur_close - self.entry_price
            if unrealized > self.peak_profit:
                self.peak_profit = unrealized

            # Activate TSL
            if not self.tsl_active and self.peak_profit >= self.tsl_activation:
                self.tsl_active = True
                self.tsl_step = 1
                lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                self.current_sl = self.entry_price + lock
                ctx.log(
                    "TSL ON (Long) step=1 | SL="
                    + str(round(self.current_sl, 2))
                )

            # Step up
            if self.tsl_active and self.peak_profit > self.tsl_activation:
                new_step = 1 + int(
                    (self.peak_profit - self.tsl_activation) / self.tsl_step_size
                )
                if new_step > self.tsl_step:
                    self.tsl_step = new_step
                    lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                    self.current_sl = self.entry_price + lock
                    ctx.log(
                        "TSL step=" + str(self.tsl_step)
                        + " | SL=" + str(round(self.current_sl, 2))
                    )

            # SL hit
            if cur_close <= self.current_sl:
                ctx.sell(self.symbol, self.quantity,
                         exchange=self.exchange, product=self.product)
                reason = "TSL" if self.tsl_active else "Initial SL"
                ctx.log(
                    "LONG EXIT (" + reason + ") @ "
                    + str(round(cur_close, 2))
                )
                if self.tsl_active:
                    self.block_long = True
                self.reset_position()

        # ── Stepwise trailing SL — SHORT ─────────────────────────
        if self.in_short and self.entry_price is not None:
            unrealized = self.entry_price - cur_close
            if unrealized > self.peak_profit:
                self.peak_profit = unrealized

            # Activate TSL
            if not self.tsl_active and self.peak_profit >= self.tsl_activation:
                self.tsl_active = True
                self.tsl_step = 1
                lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                self.current_sl = self.entry_price - lock
                ctx.log(
                    "TSL ON (Short) step=1 | SL="
                    + str(round(self.current_sl, 2))
                )

            # Step up
            if self.tsl_active and self.peak_profit > self.tsl_activation:
                new_step = 1 + int(
                    (self.peak_profit - self.tsl_activation) / self.tsl_step_size
                )
                if new_step > self.tsl_step:
                    self.tsl_step = new_step
                    lock = self.peak_profit * (self.tsl_lock_pct / 100.0)
                    self.current_sl = self.entry_price - lock
                    ctx.log(
                        "TSL step=" + str(self.tsl_step)
                        + " | SL=" + str(round(self.current_sl, 2))
                    )

            # SL hit
            if cur_close >= self.current_sl:
                ctx.buy(self.symbol, self.quantity,
                        exchange=self.exchange, product=self.product)
                reason = "TSL" if self.tsl_active else "Initial SL"
                ctx.log(
                    "SHORT EXIT (" + reason + ") @ "
                    + str(round(cur_close, 2))
                )
                if self.tsl_active:
                    self.block_short = True
                self.reset_position()

        # ── Time cutoff — 3:10 PM IST ───────────────────────────
        if not before_cutoff:
            if self.in_long:
                ctx.sell(self.symbol, self.quantity,
                         exchange=self.exchange, product=self.product)
                ctx.log("LONG EXIT (Cutoff 3:10 PM) @ " + str(round(cur_close, 2)))
                self.reset_position()

            if self.in_short:
                ctx.buy(self.symbol, self.quantity,
                        exchange=self.exchange, product=self.product)
                ctx.log("SHORT EXIT (Cutoff 3:10 PM) @ " + str(round(cur_close, 2)))
                self.reset_position()

    # ── Helpers ───────────────────────────────────────────────────

    def reset_position(self):
        """Clear all position-related state."""
        self.in_long = False
        self.in_short = False
        self.entry_price = None
        self.current_sl = None
        self.peak_profit = 0.0
        self.tsl_step = 0
        self.tsl_active = False

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
        """True if a swing high below *threshold* exists in recent bars."""
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
        """True if a swing low above *threshold* exists in recent bars."""
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
        ctx.log(
            "FILLED: " + order.side + " " + order.symbol
            + " x" + str(order.quantity) + " @ " + str(order.fill_price)
        )

    def on_stop(self, ctx):
        ctx.log("EMA+CPR Strategy stopped")
