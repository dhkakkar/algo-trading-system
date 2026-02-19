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


class NiftySuperTrendCPRStrategy(Strategy):
    """
    Nifty SuperTrend+CPR Options Selling Strategy

    Uses SuperTrend indicator with CPR (Central Pivot Range) levels on a
    15-min Nifty chart to generate directional signals.  Sells OTM options
    (PE on bullish signal, CE on bearish signal) targeting |delta| 0.30-0.35.

    Entry: Two-step trigger→breakout.  Step 1 (trigger): close is above/below
    SuperTrend AND all CPR levels (pivot, BC, TC).  Step 2 (breakout): on a
    subsequent bar, HIGH > trigger candle close (for long) or LOW < trigger
    candle close (for short).  Uses tick-based (HIGH/LOW) breakout check.
    Exit when SuperTrend flips signal.  Positions force-closed at 3:10 PM IST.

    Parameters:
        symbol          -- Underlying symbol (default: "NIFTY 50")
        exchange        -- Underlying exchange (default: "NSE")
        quantity        -- Number of lots (default: 1)
        delta_min       -- Minimum |delta| for option selection (default: 0.30)
        delta_max       -- Maximum |delta| for option selection (default: 0.35)
        st_period       -- SuperTrend ATR period (default: 10)
        st_multiplier   -- SuperTrend multiplier (default: 1.25)
        cutoff_hour     -- Time cutoff hour IST (default: 15)
        cutoff_minute   -- Time cutoff minute (default: 10)
    """

    def on_init(self, ctx):
        # --- Underlying ---
        self.symbol = ctx.get_param("symbol", "NIFTY 50")
        self.exchange = ctx.get_param("exchange", "NSE")
        self.num_lots = ctx.get_param("quantity", 1)
        self.delta_min = ctx.get_param("delta_min", 0.30)
        self.delta_max = ctx.get_param("delta_max", 0.35)

        # --- SuperTrend parameters ---
        self.st_period = ctx.get_param("st_period", 10)
        self.st_multiplier = ctx.get_param("st_multiplier", 1.25)

        # --- Time cutoff (IST) ---
        self.entry_cutoff_hour = ctx.get_param("entry_cutoff_hour", 14)
        self.entry_cutoff_minute = ctx.get_param("entry_cutoff_minute", 45)
        self.cutoff_hour = ctx.get_param("cutoff_hour", 15)
        self.cutoff_minute = ctx.get_param("cutoff_minute", 10)

        # --- Position state ---
        self.in_long = False
        self.in_short = False
        self.entry_premium = None
        self.held_option = None
        self.held_lot_size = 25

        # --- Trigger state (two-step entry) ---
        self.bullish_trigger = False
        self.bearish_trigger = False
        self.trigger_close = None
        self.trigger_option = None
        self.trigger_lot_size = 25

        # --- Previous condition state (for chart markers) ---
        self.prev_bull = False
        self.prev_bear = False

        # --- Previous day HLC for CPR ---
        self.last_date = None
        self.prev_day_high = None
        self.prev_day_low = None
        self.prev_day_close = None

        ctx.log(
            "SuperTrend+CPR Options Selling init: underlying=" + self.symbol
            + " lots=" + str(self.num_lots)
            + " delta=" + str(self.delta_min) + "-" + str(self.delta_max)
            + " ST(" + str(self.st_period) + "," + str(self.st_multiplier) + ")"
        )

    # -- Option selection --------------------------------------------------

    def find_option_by_delta(self, ctx, spot, option_type, closes_list):
        """Find the option with |delta| in [delta_min, delta_max] range.

        Prefers options within the range (closest to midpoint).  If none
        fall inside the range, picks the option closest to the midpoint.
        """
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

        midpoint = (self.delta_min + self.delta_max) / 2.0
        best = None
        best_diff = float("inf")
        best_in_range = False
        best_delta = 0.0
        for opt in options:
            delta = bs_delta(spot, opt["strike"], tte_years, vol,
                             option_type=option_type)
            abs_delta = abs(delta)
            in_range = self.delta_min <= abs_delta <= self.delta_max
            diff = abs(abs_delta - midpoint)
            # Prefer in-range options; among same category pick closest to midpoint
            if (in_range and not best_in_range) or (in_range == best_in_range and diff < best_diff):
                best_diff = diff
                best = opt
                best_delta = delta
                best_in_range = in_range

        if best:
            ctx.log(
                "Selected " + option_type + ": " + best["tradingsymbol"]
                + " strike=" + str(best["strike"])
                + " |delta|=" + str(round(abs(best_delta), 3))
                + " range=[" + str(self.delta_min) + "," + str(self.delta_max) + "]"
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

    # -- Tick-level breakout (paper/live trading) --------------------------

    def on_tick(self, ctx, symbol, price):
        """Check breakout on every tick. Called by paper/live runner only."""
        if symbol != self.symbol:
            return
        if self.in_long or self.in_short:
            return
        if not self.bullish_trigger and not self.bearish_trigger:
            return
        if not self.trigger_option:
            return

        # Entry cutoff check
        bar_hour, bar_min = ctx.get_bar_ist_time()
        before_entry_cutoff = (
            bar_hour < self.entry_cutoff_hour
            or (bar_hour == self.entry_cutoff_hour
                and bar_min < self.entry_cutoff_minute)
        )
        if not before_entry_cutoff:
            return

        # Bull breakout: LTP > trigger candle close
        if self.bullish_trigger and price > self.trigger_close:
            trig_lvl = self.trigger_close
            qty = self.num_lots * self.trigger_lot_size
            ctx.sell(self.trigger_option, qty, exchange="NFO", product="MIS")
            self.held_option = self.trigger_option
            self.held_lot_size = self.trigger_lot_size
            self.entry_premium = None
            self.in_long = True
            self.bullish_trigger = False
            self.trigger_close = None
            self.trigger_option = None
            ctx.log(
                "LONG ENTRY [tick] (Sell " + self.held_option
                + ") @ LTP=" + str(round(price, 2))
                + " trigger_close=" + str(round(trig_lvl, 2))
            )
            return

        # Bear breakout: LTP < trigger candle close
        if self.bearish_trigger and price < self.trigger_close:
            trig_lvl = self.trigger_close
            qty = self.num_lots * self.trigger_lot_size
            ctx.sell(self.trigger_option, qty, exchange="NFO", product="MIS")
            self.held_option = self.trigger_option
            self.held_lot_size = self.trigger_lot_size
            self.entry_premium = None
            self.in_short = True
            self.bearish_trigger = False
            self.trigger_close = None
            self.trigger_option = None
            ctx.log(
                "SHORT ENTRY [tick] (Sell " + self.held_option
                + ") @ LTP=" + str(round(price, 2))
                + " trigger_close=" + str(round(trig_lvl, 2))
            )

    # -- Main bar handler --------------------------------------------------

    def on_data(self, ctx):
        lookback = max(self.st_period + 10, 200)
        data = ctx.get_historical_data(
            self.symbol, exchange=self.exchange, periods=lookback
        )
        if data is None or len(data) < self.st_period + 5:
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
            self.last_date = bar_date

        if self.prev_day_high is None:
            return

        # -- CPR -----------------------------------------------------------
        pivot = (self.prev_day_high + self.prev_day_low + self.prev_day_close) / 3.0
        bc = (self.prev_day_high + self.prev_day_low) / 2.0
        tc = (2.0 * pivot) - bc

        # -- SuperTrend ----------------------------------------------------
        st = ctx.supertrend(high_s, low_s, close, self.st_period, self.st_multiplier)
        cur_st = st.iloc[-1]

        before_entry_cutoff = (
            bar_hour < self.entry_cutoff_hour
            or (bar_hour == self.entry_cutoff_hour and bar_min < self.entry_cutoff_minute)
        )
        before_cutoff = (
            bar_hour < self.cutoff_hour
            or (bar_hour == self.cutoff_hour and bar_min < self.cutoff_minute)
        )

        # -- Entry conditions (close-based) -----------------------------------
        bull_cond = (cur_close > cur_st
                     and cur_close > pivot and cur_close > bc and cur_close > tc)
        bear_cond = (cur_close < cur_st
                     and cur_close < pivot and cur_close < bc and cur_close < tc)

        # -- Bar-level breakout entry (backtest fallback; in paper/live on_tick fires first) --
        # Long breakout: HIGH > trigger candle close
        if (self.bullish_trigger and self.trigger_option
                and not self.in_long and not self.in_short
                and before_entry_cutoff and cur_high > self.trigger_close):
            trig_lvl = self.trigger_close
            qty = self.num_lots * self.trigger_lot_size
            ctx.sell(self.trigger_option, qty, exchange="NFO", product="MIS")
            self.held_option = self.trigger_option
            self.held_lot_size = self.trigger_lot_size
            self.entry_premium = None
            self.in_long = True
            self.bullish_trigger = False
            self.trigger_close = None
            self.trigger_option = None
            ctx.log(
                "LONG ENTRY (Sell " + self.held_option + ") @ underlying="
                + str(round(cur_close, 2))
                + " high=" + str(round(cur_high, 2))
                + " trigger_close=" + str(round(trig_lvl, 2))
                + " ST=" + str(round(cur_st, 2))
            )

        # Short breakout: LOW < trigger candle close
        if (self.bearish_trigger and self.trigger_option
                and not self.in_short and not self.in_long
                and before_entry_cutoff and cur_low < self.trigger_close):
            trig_lvl = self.trigger_close
            qty = self.num_lots * self.trigger_lot_size
            ctx.sell(self.trigger_option, qty, exchange="NFO", product="MIS")
            self.held_option = self.trigger_option
            self.held_lot_size = self.trigger_lot_size
            self.entry_premium = None
            self.in_short = True
            self.bearish_trigger = False
            self.trigger_close = None
            self.trigger_option = None
            ctx.log(
                "SHORT ENTRY (Sell " + self.held_option + ") @ underlying="
                + str(round(cur_close, 2))
                + " low=" + str(round(cur_low, 2))
                + " trigger_close=" + str(round(trig_lvl, 2))
                + " ST=" + str(round(cur_st, 2))
            )

        # -- SuperTrend signal flip exit ------------------------------------
        if self.in_long and cur_close < cur_st:
            self.exit_held_option(ctx, "ST flip bearish")
            ctx.log("LONG EXIT (ST flip) | close=" + str(round(cur_close, 2))
                    + " < ST=" + str(round(cur_st, 2)))
            self.reset_position()

        if self.in_short and cur_close > cur_st:
            self.exit_held_option(ctx, "ST flip bullish")
            ctx.log("SHORT EXIT (ST flip) | close=" + str(round(cur_close, 2))
                    + " > ST=" + str(round(cur_st, 2)))
            self.reset_position()

        # -- Time cutoff -- 3:10 PM IST ------------------------------------
        if not before_cutoff:
            if self.in_long:
                self.exit_held_option(ctx, "Cutoff 3:10 PM")
                ctx.log("LONG EXIT (Cutoff)")
                self.reset_position()

            if self.in_short:
                self.exit_held_option(ctx, "Cutoff 3:10 PM")
                ctx.log("SHORT EXIT (Cutoff)")
                self.reset_position()

            # Clear triggers at cutoff too
            self.bullish_trigger = False
            self.bearish_trigger = False
            self.trigger_close = None
            self.trigger_option = None
            return

        # -- Trigger set / negate (AFTER entries so triggers fire on next bar/tick) --
        # Bull trigger: conditions just became true -> pre-select option & arm trigger
        if bull_cond and not self.prev_bull and not self.in_long:
            opt = self.find_option_by_delta(ctx, cur_close, "PE", closes_list)
            if opt:
                self.bullish_trigger = True
                self.bearish_trigger = False
                self.trigger_close = cur_close
                self.trigger_option = opt["tradingsymbol"]
                self.trigger_lot_size = opt.get("lot_size", 25)
                ctx.log(
                    "BULL TRIGGER | close=" + str(round(cur_close, 2))
                    + " ST=" + str(round(cur_st, 2))
                    + " trigger_close=" + str(round(cur_close, 2))
                    + " option=" + opt["tradingsymbol"]
                )

        # Bull trigger negated: conditions no longer true
        if not bull_cond and self.prev_bull and not self.in_long:
            if self.bullish_trigger:
                self.bullish_trigger = False
                self.trigger_close = None
                self.trigger_option = None
            ctx.log(
                "BULL TRIGGER NEGATED | close=" + str(round(cur_close, 2))
            )

        # Bear trigger: conditions just became true -> pre-select option & arm trigger
        if bear_cond and not self.prev_bear and not self.in_short:
            opt = self.find_option_by_delta(ctx, cur_close, "CE", closes_list)
            if opt:
                self.bearish_trigger = True
                self.bullish_trigger = False
                self.trigger_close = cur_close
                self.trigger_option = opt["tradingsymbol"]
                self.trigger_lot_size = opt.get("lot_size", 25)
                ctx.log(
                    "BEAR TRIGGER | close=" + str(round(cur_close, 2))
                    + " ST=" + str(round(cur_st, 2))
                    + " trigger_close=" + str(round(cur_close, 2))
                    + " option=" + opt["tradingsymbol"]
                )

        # Bear trigger negated: conditions no longer true
        if not bear_cond and self.prev_bear and not self.in_short:
            if self.bearish_trigger:
                self.bearish_trigger = False
                self.trigger_close = None
                self.trigger_option = None
            ctx.log(
                "BEAR TRIGGER NEGATED | close=" + str(round(cur_close, 2))
            )

        self.prev_bull = bull_cond
        self.prev_bear = bear_cond

    # -- Helpers -----------------------------------------------------------

    def reset_position(self):
        """Clear all position-related state."""
        self.in_long = False
        self.in_short = False
        self.entry_premium = None
        self.held_option = None
        self.bullish_trigger = False
        self.bearish_trigger = False
        self.trigger_close = None
        self.trigger_option = None
        self.trigger_lot_size = 25

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
        ctx.log("SuperTrend+CPR Options Selling Strategy stopped")
