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
