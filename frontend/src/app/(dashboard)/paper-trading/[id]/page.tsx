"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTradingStore } from "@/stores/trading-store";
import { connectSocket } from "@/lib/socket-client";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Pause,
  Trash2,
  ArrowLeft,
  Loader2,
  Activity,
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ChevronDown,
  Settings2,
  X,
} from "lucide-react";
import type { TradingOrder, TradingTrade, TradingSnapshot } from "@/types/trading";
import apiClient from "@/lib/api-client";

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    stopped: "bg-gray-100 text-gray-800",
    running: "bg-green-100 text-green-800",
    paused: "bg-yellow-100 text-yellow-800",
    error: "bg-red-100 text-red-800",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
        colors[status] || "bg-gray-100 text-gray-800"
      )}
    >
      {status === "running" && (
        <span className="relative flex h-2 w-2 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
      )}
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------
function MetricCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: any;
  color?: string;
}) {
  return (
    <div className="bg-card border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <Icon className={cn("h-3.5 w-3.5", color || "text-muted-foreground")} />
      </div>
      <p className={cn("text-lg font-bold", color)}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicator Types & Calculation Helpers
// ---------------------------------------------------------------------------
interface IndicatorConfig {
  emaFast: { enabled: boolean; period: number };
  emaSlow: { enabled: boolean; period: number };
  sma: { enabled: boolean; period: number };
  cpr: { enabled: boolean };
  vwap: { enabled: boolean };
  bollinger: { enabled: boolean; period: number; stdDev: number };
}

const DEFAULT_INDICATORS: IndicatorConfig = {
  emaFast: { enabled: false, period: 9 },
  emaSlow: { enabled: false, period: 21 },
  sma: { enabled: false, period: 20 },
  cpr: { enabled: false },
  vwap: { enabled: false },
  bollinger: { enabled: false, period: 20, stdDev: 2 },
};

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface VolumeData {
  time: number;
  value: number;
  color: string;
}

function calcEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length === 0 || period <= 0) return result;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      // SMA seed for first `period` values
      ema = closes.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      result.push(null);
    } else if (i === period - 1) {
      ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(ema);
    } else {
      ema = closes[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function calcSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calcBollinger(
  closes: number[],
  period: number,
  stdDevMult: number
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = calcSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (middle[i] == null) {
      upper.push(null);
      lower.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = middle[i]!;
      const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
      const stdDev = Math.sqrt(variance);
      upper.push(mean + stdDev * stdDevMult);
      lower.push(mean - stdDev * stdDevMult);
    }
  }
  return { upper, middle, lower };
}

function calcVWAP(
  candles: CandleData[],
  volumes: number[]
): (number | null)[] {
  const result: (number | null)[] = [];
  let cumTP = 0;
  let cumVol = 0;
  let lastDay = -1;

  for (let i = 0; i < candles.length; i++) {
    const d = new Date(candles[i].time * 1000);
    const dayNum = Math.floor(candles[i].time / 86400);

    // Reset on new day
    if (dayNum !== lastDay) {
      cumTP = 0;
      cumVol = 0;
      lastDay = dayNum;
    }

    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const vol = volumes[i] || 1;
    cumTP += tp * vol;
    cumVol += vol;
    result.push(cumVol > 0 ? cumTP / cumVol : null);
  }
  return result;
}

function calcCPR(candles: CandleData[]): {
  pivot: number;
  tc: number;
  bc: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
} | null {
  // Find previous day's high, low, close from the candle data
  if (candles.length === 0) return null;

  // Group candles by day
  const dayMap = new Map<number, { high: number; low: number; close: number }>();
  for (const c of candles) {
    const dayNum = Math.floor(c.time / 86400);
    const existing = dayMap.get(dayNum);
    if (existing) {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close; // Last close of the day
    } else {
      dayMap.set(dayNum, { high: c.high, low: c.low, close: c.close });
    }
  }

  const days = Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0]);
  if (days.length < 2) return null;

  // Use the second-to-last complete day
  const prev = days[days.length - 2][1];
  const { high: pH, low: pL, close: pC } = prev;

  const pivot = (pH + pL + pC) / 3;
  const bc = (pH + pL) / 2;
  const tc = pivot - bc + pivot;
  const r1 = 2 * pivot - pL;
  const s1 = 2 * pivot - pH;
  const r2 = pivot + (pH - pL);
  const s2 = pivot - (pH - pL);

  return { pivot, tc, bc, r1, r2, s1, s2 };
}

// ---------------------------------------------------------------------------
// Indicator Colors
// ---------------------------------------------------------------------------
const INDICATOR_COLORS = {
  emaFast: "#2196F3",    // blue
  emaSlow: "#FF9800",    // orange
  sma: "#00BCD4",        // cyan
  cprPivot: "#9C27B0",   // purple
  cprTC: "#9C27B0",
  cprBC: "#9C27B0",
  cprR1: "#F44336",      // red
  cprR2: "#F44336",
  cprS1: "#4CAF50",      // green
  cprS2: "#4CAF50",
  vwap: "#E91E63",       // pink
  bollingerUpper: "#607D8B",
  bollingerMiddle: "#607D8B",
  bollingerLower: "#607D8B",
};

// ---------------------------------------------------------------------------
// Timeframes
// ---------------------------------------------------------------------------
const TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1H", value: "1h" },
  { label: "1D", value: "1d" },
];

// ---------------------------------------------------------------------------
// Indicator Panel Component
// ---------------------------------------------------------------------------
function IndicatorPanel({
  config,
  onChange,
  onClose,
}: {
  config: IndicatorConfig;
  onChange: (c: IndicatorConfig) => void;
  onClose: () => void;
}) {
  const toggle = (key: keyof IndicatorConfig) => {
    onChange({
      ...config,
      [key]: { ...config[key], enabled: !config[key].enabled },
    });
  };

  const updateParam = (key: keyof IndicatorConfig, param: string, val: number) => {
    onChange({
      ...config,
      [key]: { ...config[key], [param]: val },
    });
  };

  return (
    <div className="absolute top-full right-0 mt-1 w-72 bg-card border rounded-lg shadow-xl z-50 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Indicators
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2.5">
        {/* EMA Fast */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.emaFast.enabled}
            onChange={() => toggle("emaFast")}
            className="rounded border-input h-3.5 w-3.5 accent-blue-500"
          />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.emaFast }}>
            EMA Fast
          </span>
          <input
            type="number"
            value={config.emaFast.period}
            onChange={(e) => updateParam("emaFast", "period", parseInt(e.target.value) || 9)}
            className="w-14 px-1.5 py-0.5 text-xs rounded border border-input bg-background text-center"
            min={1}
            max={200}
          />
        </div>

        {/* EMA Slow */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.emaSlow.enabled}
            onChange={() => toggle("emaSlow")}
            className="rounded border-input h-3.5 w-3.5 accent-orange-500"
          />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.emaSlow }}>
            EMA Slow
          </span>
          <input
            type="number"
            value={config.emaSlow.period}
            onChange={(e) => updateParam("emaSlow", "period", parseInt(e.target.value) || 21)}
            className="w-14 px-1.5 py-0.5 text-xs rounded border border-input bg-background text-center"
            min={1}
            max={200}
          />
        </div>

        {/* SMA */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.sma.enabled}
            onChange={() => toggle("sma")}
            className="rounded border-input h-3.5 w-3.5 accent-cyan-500"
          />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.sma }}>
            SMA
          </span>
          <input
            type="number"
            value={config.sma.period}
            onChange={(e) => updateParam("sma", "period", parseInt(e.target.value) || 20)}
            className="w-14 px-1.5 py-0.5 text-xs rounded border border-input bg-background text-center"
            min={1}
            max={200}
          />
        </div>

        <div className="border-t border-border my-1" />

        {/* CPR */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.cpr.enabled}
            onChange={() => toggle("cpr")}
            className="rounded border-input h-3.5 w-3.5 accent-purple-500"
          />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.cprPivot }}>
            CPR (Pivot, S/R)
          </span>
          <span className="text-[10px] text-muted-foreground">Auto</span>
        </div>

        {/* VWAP */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.vwap.enabled}
            onChange={() => toggle("vwap")}
            className="rounded border-input h-3.5 w-3.5 accent-pink-500"
          />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.vwap }}>
            VWAP
          </span>
          <span className="text-[10px] text-muted-foreground">Daily</span>
        </div>

        <div className="border-t border-border my-1" />

        {/* Bollinger Bands */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.bollinger.enabled}
            onChange={() => toggle("bollinger")}
            className="rounded border-input h-3.5 w-3.5 accent-gray-500"
          />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.bollingerMiddle }}>
            Bollinger Bands
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={config.bollinger.period}
              onChange={(e) => updateParam("bollinger", "period", parseInt(e.target.value) || 20)}
              className="w-10 px-1 py-0.5 text-xs rounded border border-input bg-background text-center"
              min={5}
              max={100}
            />
            <span className="text-[10px] text-muted-foreground">/</span>
            <input
              type="number"
              value={config.bollinger.stdDev}
              onChange={(e) => updateParam("bollinger", "stdDev", parseFloat(e.target.value) || 2)}
              className="w-10 px-1 py-0.5 text-xs rounded border border-input bg-background text-center"
              min={0.5}
              max={5}
              step={0.5}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers: IST offset for lightweight-charts (displays UTC, we fake IST)
// ---------------------------------------------------------------------------
const IST_OFFSET_SECS = 5 * 3600 + 30 * 60; // +5:30 in seconds

function toChartTime(isoOrTs: string | number): number {
  const ms = typeof isoOrTs === "string" ? new Date(isoOrTs).getTime() : isoOrTs * 1000;
  // lightweight-charts renders timestamps as UTC — shift by IST offset so labels read correctly
  return Math.floor(ms / 1000) + IST_OFFSET_SECS;
}

// ---------------------------------------------------------------------------
// Live Candlestick Chart with Indicators
// ---------------------------------------------------------------------------
function LiveChart({
  instruments,
  sessionTimeframe,
  snapshot,
  isRunning,
}: {
  instruments: string[];
  sessionTimeframe: string;
  snapshot: TradingSnapshot | null;
  isRunning: boolean;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const lastCandleRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Record<string, any>>({});
  const rawCandlesRef = useRef<CandleData[]>([]);
  const rawVolumesRef = useRef<number[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartTimeframe, setChartTimeframe] = useState(sessionTimeframe);
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATORS);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);

  // Track earliest loaded date for lazy-loading
  const earliestDateRef = useRef<string>("");
  const isLoadingMoreRef = useRef(false);

  // Primary symbol
  const primaryInstrument = instruments[0] || "";
  const sym = primaryInstrument.includes(":")
    ? primaryInstrument.split(":")[1]
    : primaryInstrument;
  const exch = primaryInstrument.includes(":")
    ? primaryInstrument.split(":")[0]
    : "NSE";

  // Count active indicators
  const activeCount = Object.values(indicators).filter((v) => v.enabled).length;

  // Apply indicators to chart
  const applyIndicators = useCallback(
    (
      chart: any,
      candleSeries: any,
      candles: CandleData[],
      volumes: number[],
      config: IndicatorConfig
    ) => {
      // Remove old indicator series
      for (const [key, series] of Object.entries(indicatorSeriesRef.current)) {
        try {
          chart.removeSeries(series);
        } catch {}
      }
      indicatorSeriesRef.current = {};

      // Remove old price lines (CPR)
      try {
        const allPriceLines = (candleSeries as any).__cprLines || [];
        for (const pl of allPriceLines) {
          candleSeries.removePriceLine(pl);
        }
      } catch {}
      (candleSeries as any).__cprLines = [];

      if (candles.length === 0) return;

      const closes = candles.map((c) => c.close);
      const times = candles.map((c) => c.time);

      // EMA Fast
      if (config.emaFast.enabled) {
        const emaData = calcEMA(closes, config.emaFast.period);
        const series = chart.addLineSeries({
          color: INDICATOR_COLORS.emaFast,
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const lineData = emaData
          .map((v, i) => (v != null ? { time: times[i] as any, value: v } : null))
          .filter(Boolean);
        series.setData(lineData);
        indicatorSeriesRef.current.emaFast = series;
      }

      // EMA Slow
      if (config.emaSlow.enabled) {
        const emaData = calcEMA(closes, config.emaSlow.period);
        const series = chart.addLineSeries({
          color: INDICATOR_COLORS.emaSlow,
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const lineData = emaData
          .map((v, i) => (v != null ? { time: times[i] as any, value: v } : null))
          .filter(Boolean);
        series.setData(lineData);
        indicatorSeriesRef.current.emaSlow = series;
      }

      // SMA
      if (config.sma.enabled) {
        const smaData = calcSMA(closes, config.sma.period);
        const series = chart.addLineSeries({
          color: INDICATOR_COLORS.sma,
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const lineData = smaData
          .map((v, i) => (v != null ? { time: times[i] as any, value: v } : null))
          .filter(Boolean);
        series.setData(lineData);
        indicatorSeriesRef.current.sma = series;
      }

      // VWAP
      if (config.vwap.enabled) {
        const vwapData = calcVWAP(candles, volumes);
        const series = chart.addLineSeries({
          color: INDICATOR_COLORS.vwap,
          lineWidth: 1.5,
          lineStyle: 0,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const lineData = vwapData
          .map((v, i) => (v != null ? { time: times[i] as any, value: v } : null))
          .filter(Boolean);
        series.setData(lineData);
        indicatorSeriesRef.current.vwap = series;
      }

      // Bollinger Bands
      if (config.bollinger.enabled) {
        const bb = calcBollinger(closes, config.bollinger.period, config.bollinger.stdDev);

        const upperSeries = chart.addLineSeries({
          color: INDICATOR_COLORS.bollingerUpper,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const middleSeries = chart.addLineSeries({
          color: INDICATOR_COLORS.bollingerMiddle,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const lowerSeries = chart.addLineSeries({
          color: INDICATOR_COLORS.bollingerLower,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        upperSeries.setData(
          bb.upper.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean)
        );
        middleSeries.setData(
          bb.middle.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean)
        );
        lowerSeries.setData(
          bb.lower.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean)
        );

        indicatorSeriesRef.current.bollingerUpper = upperSeries;
        indicatorSeriesRef.current.bollingerMiddle = middleSeries;
        indicatorSeriesRef.current.bollingerLower = lowerSeries;
      }

      // CPR (price lines on candle series)
      if (config.cpr.enabled) {
        const cpr = calcCPR(candles);
        if (cpr) {
          const cprLines: any[] = [];
          const addCPRLine = (price: number, title: string, color: string, lineStyle: number) => {
            const pl = candleSeries.createPriceLine({
              price,
              color,
              lineWidth: 1,
              lineStyle,
              axisLabelVisible: true,
              title,
            });
            cprLines.push(pl);
          };
          addCPRLine(cpr.pivot, "P", INDICATOR_COLORS.cprPivot, 2);
          addCPRLine(cpr.tc, "TC", INDICATOR_COLORS.cprTC, 1);
          addCPRLine(cpr.bc, "BC", INDICATOR_COLORS.cprBC, 1);
          addCPRLine(cpr.r1, "R1", INDICATOR_COLORS.cprR1, 2);
          addCPRLine(cpr.r2, "R2", INDICATOR_COLORS.cprR2, 2);
          addCPRLine(cpr.s1, "S1", INDICATOR_COLORS.cprS1, 2);
          addCPRLine(cpr.s2, "S2", INDICATOR_COLORS.cprS2, 2);
          (candleSeries as any).__cprLines = cprLines;
        }
      }
    },
    []
  );

  // Process raw OHLCV API data into chart-ready arrays
  const processOHLCV = useCallback(
    (data: any[]): { candles: CandleData[]; volumes: VolumeData[]; rawVolumes: number[] } => {
      const candleData: CandleData[] = data.map((d: any) => ({
        time: toChartTime(d.time || d.timestamp),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

      const rawVolumeArr: number[] = data.map((d: any) => d.volume || 0);

      const volumeData: VolumeData[] = data.map((d: any, i: number) => ({
        time: candleData[i].time,
        value: d.volume || 0,
        color: d.close >= d.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      // Deduplicate by time
      const seen = new Set<number>();
      const candles: CandleData[] = [];
      const volumes: VolumeData[] = [];
      const rawVolumes: number[] = [];
      candleData.forEach((c, i) => {
        if (!seen.has(c.time)) {
          seen.add(c.time);
          candles.push(c);
          volumes.push(volumeData[i]);
          rawVolumes.push(rawVolumeArr[i]);
        }
      });

      candles.sort((a, b) => a.time - b.time);
      volumes.sort((a, b) => a.time - b.time);
      // Align raw volumes with sorted candles
      const timeOrder = candles.map((c) => c.time);
      const sortedRaw = timeOrder.map((t) => {
        const idx = candles.findIndex((uc) => uc.time === t);
        return rawVolumes[idx] || 0;
      });

      return { candles, volumes, rawVolumes: sortedRaw };
    },
    []
  );

  // Load more historical data when scrolling left
  const loadMoreHistory = useCallback(async () => {
    if (
      isLoadingMoreRef.current ||
      !chartRef.current ||
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      !earliestDateRef.current
    )
      return;

    isLoadingMoreRef.current = true;

    try {
      const toDate = new Date(earliestDateRef.current);
      toDate.setDate(toDate.getDate() - 1);
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - (chartTimeframe === "1d" ? 365 : 30));
      const fromStr = fromDate.toISOString().slice(0, 10);
      const toStr = toDate.toISOString().slice(0, 10);

      if (fromDate >= toDate) return;

      const res = await apiClient.get(
        `/market-data/ohlcv?symbol=${sym}&exchange=${exch}&from_date=${fromStr}&to_date=${toStr}&interval=${chartTimeframe}`
      );

      const newData = res.data || [];
      if (newData.length === 0) return;

      const { candles: newCandles, volumes: newVolumes, rawVolumes: newRawVolumes } =
        processOHLCV(newData);

      if (newCandles.length === 0) return;

      // Merge: new older data + existing data
      const existingCandles = rawCandlesRef.current;
      const existingVolumes = rawVolumesRef.current;
      const existingVolumeSeries = existingCandles.map((c, i) => ({
        time: c.time,
        value: existingVolumes[i] || 0,
        color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      // Filter out duplicates from new data
      const existingTimes = new Set(existingCandles.map((c) => c.time));
      const filteredCandles: CandleData[] = [];
      const filteredVolumes: VolumeData[] = [];
      const filteredRaw: number[] = [];
      newCandles.forEach((c, i) => {
        if (!existingTimes.has(c.time)) {
          filteredCandles.push(c);
          filteredVolumes.push(newVolumes[i]);
          filteredRaw.push(newRawVolumes[i]);
        }
      });

      if (filteredCandles.length === 0) return;

      // Merge and sort
      const allCandles = [...filteredCandles, ...existingCandles].sort((a, b) => a.time - b.time);
      const allRawVolumes = [...filteredRaw, ...existingVolumes];
      // Rebuild aligned volume array based on sorted candle order
      const candleTimeToIdx = new Map<number, number>();
      filteredCandles.forEach((c, i) => candleTimeToIdx.set(c.time, i));
      existingCandles.forEach((c, i) => candleTimeToIdx.set(c.time, filteredCandles.length + i));
      const mergedRawVolumes = allCandles.map((c) => {
        const idx = candleTimeToIdx.get(c.time);
        if (idx !== undefined && idx < filteredRaw.length) return filteredRaw[idx];
        const exIdx = idx !== undefined ? idx - filteredCandles.length : -1;
        return exIdx >= 0 ? existingVolumes[exIdx] : 0;
      });

      const allVolumeBars: VolumeData[] = allCandles.map((c, i) => ({
        time: c.time,
        value: mergedRawVolumes[i],
        color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      // Update chart series
      candleSeriesRef.current.setData(allCandles as any[]);
      volumeSeriesRef.current.setData(allVolumeBars as any[]);

      rawCandlesRef.current = allCandles;
      rawVolumesRef.current = mergedRawVolumes;
      earliestDateRef.current = fromStr;

      // Re-apply indicators with full data
      applyIndicators(chartRef.current, candleSeriesRef.current, allCandles, mergedRawVolumes, indicators);
    } catch {
      // silently fail
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [sym, exch, chartTimeframe, processOHLCV, applyIndicators, indicators]);

  // Load historical candles and create chart
  useEffect(() => {
    if (!sym || !chartContainerRef.current) return;

    setChartLoading(true);

    // Fetch historical OHLCV — 30 days for intraday, 365 days for daily
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - (chartTimeframe === "1d" ? 365 : 30));
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);
    earliestDateRef.current = fromStr;

    Promise.all([
      apiClient.get(
        `/market-data/ohlcv?symbol=${sym}&exchange=${exch}&from_date=${fromStr}&to_date=${toStr}&interval=${chartTimeframe}`
      ),
      import("lightweight-charts"),
    ])
      .then(([ohlcvRes, lc]) => {
        if (!chartContainerRef.current) return;

        // Clean up old chart
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        const { createChart, ColorType } = lc;

        const isDaily = chartTimeframe === "1d";

        const chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#9ca3af",
            fontSize: 11,
          },
          grid: {
            vertLines: { color: "#1f2937" },
            horzLines: { color: "#1f2937" },
          },
          crosshair: { mode: 0 },
          timeScale: {
            borderColor: "#374151",
            timeVisible: !isDaily,
            secondsVisible: false,
            rightOffset: 5,
            minBarSpacing: 3,
            fixLeftEdge: false,
            fixRightEdge: false,
          },
          rightPriceScale: {
            borderColor: "#374151",
          },
        });

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderDownColor: "#ef4444",
          borderUpColor: "#22c55e",
          wickDownColor: "#ef4444",
          wickUpColor: "#22c55e",
        });

        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        });

        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });

        // Transform OHLCV data
        const data = ohlcvRes.data || [];
        const { candles: uniqueCandles, volumes: uniqueVolumes, rawVolumes: sortedRawVolumes } =
          processOHLCV(data);

        candleSeries.setData(uniqueCandles as any[]);
        volumeSeries.setData(uniqueVolumes as any[]);
        chart.timeScale().fitContent();

        if (uniqueCandles.length > 0) {
          lastCandleRef.current = uniqueCandles[uniqueCandles.length - 1];
        }

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;
        rawCandlesRef.current = uniqueCandles;
        rawVolumesRef.current = sortedRawVolumes;

        // Apply current indicators
        applyIndicators(chart, candleSeries, uniqueCandles, sortedRawVolumes, indicators);

        // Lazy-load: fetch more history when user scrolls to left edge
        chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange: any) => {
          if (!logicalRange) return;
          // When user scrolls so that the leftmost visible bar index is < 10, load more
          if (logicalRange.from < 10) {
            loadMoreHistory();
          }
        });

        // Resize handler
        const handleResize = () => {
          if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: chartContainerRef.current.clientWidth,
              height: chartContainerRef.current.clientHeight,
            });
          }
        };
        window.addEventListener("resize", handleResize);

        setChartLoading(false);

        return () => {
          window.removeEventListener("resize", handleResize);
        };
      })
      .catch(() => {
        setChartLoading(false);
      });

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [sym, exch, chartTimeframe]);

  // Re-apply indicators when config changes (without re-fetching data)
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || rawCandlesRef.current.length === 0)
      return;
    applyIndicators(
      chartRef.current,
      candleSeriesRef.current,
      rawCandlesRef.current,
      rawVolumesRef.current,
      indicators
    );
  }, [indicators, applyIndicators]);

  // Update last candle with live price from snapshot
  useEffect(() => {
    if (!snapshot || !candleSeriesRef.current || !sym) return;

    const price = snapshot.prices[sym] || snapshot.prices[sym.toUpperCase()];
    if (!price) return;

    const now = Math.floor(Date.now() / 1000) + IST_OFFSET_SECS;
    const lastCandle = lastCandleRef.current;

    // Determine candle interval in seconds
    const intervalSecs: Record<string, number> = {
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "30m": 1800,
      "1h": 3600,
      "1d": 86400,
    };
    const interval = intervalSecs[chartTimeframe] || 3600;

    if (lastCandle) {
      const candleEnd = lastCandle.time + interval;

      if (now < candleEnd) {
        // Update current candle
        const updated = {
          ...lastCandle,
          high: Math.max(lastCandle.high, price),
          low: Math.min(lastCandle.low, price),
          close: price,
        };
        candleSeriesRef.current.update(updated);
        lastCandleRef.current = updated;
      } else {
        // Start a new candle
        const newTime = Math.floor(now / interval) * interval;
        const newCandle: CandleData = {
          time: newTime,
          open: price,
          high: price,
          low: price,
          close: price,
        };
        candleSeriesRef.current.update(newCandle as any);
        lastCandleRef.current = newCandle;
      }
    }
  }, [snapshot, sym, chartTimeframe]);

  return (
    <div className="relative h-full min-h-[400px] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/50 flex-shrink-0">
        {/* Timeframe selector */}
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setChartTimeframe(tf.value)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                chartTimeframe === tf.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Indicators button */}
        <div className="relative">
          <button
            onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors",
              showIndicatorPanel || activeCount > 0
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Indicators
            {activeCount > 0 && (
              <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {activeCount}
              </span>
            )}
          </button>

          {showIndicatorPanel && (
            <IndicatorPanel
              config={indicators}
              onChange={setIndicators}
              onClose={() => setShowIndicatorPanel(false)}
            />
          )}
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 relative">
        {chartLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
        {!isRunning && !chartLoading && (
          <div className="absolute top-2 left-2 bg-yellow-500/20 text-yellow-500 text-xs px-2 py-1 rounded">
            Session not running — chart shows historical data only
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function PaperTradingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const {
    currentSession: session,
    snapshot,
    loading,
    error,
    fetchSession,
    fetchSnapshot,
    setSnapshot,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    deleteSession,
    clearError,
  } = useTradingStore();

  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "trades">(
    "positions"
  );
  const [orders, setOrders] = useState<TradingOrder[]>([]);
  const [trades, setTrades] = useState<TradingTrade[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tradesLoading, setTradesLoading] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch session data
  useEffect(() => {
    fetchSession(sessionId);
    fetchSnapshot(sessionId);
  }, [sessionId]);

  // Polling for snapshot when session is running
  useEffect(() => {
    if (session?.status === "running") {
      pollingRef.current = setInterval(() => {
        fetchSnapshot(sessionId);
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [session?.status, sessionId]);

  // Socket.IO listener for real-time trading updates
  useEffect(() => {
    const socket = connectSocket();

    socket.emit("subscribe_trading", { session_id: sessionId });

    const handleTradingUpdate = (data: TradingSnapshot) => {
      if (data.session_id === sessionId) {
        setSnapshot(data);
      }
    };

    socket.on("trading_update", handleTradingUpdate);

    return () => {
      socket.emit("unsubscribe_trading", { session_id: sessionId });
      socket.off("trading_update", handleTradingUpdate);
    };
  }, [sessionId]);

  // Fetch orders when tab switches to orders
  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await apiClient.get(
        `/trading/sessions/${sessionId}/orders`
      );
      setOrders(res.data);
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [sessionId]);

  // Fetch trades when tab switches to trades
  const fetchTrades = useCallback(async () => {
    setTradesLoading(true);
    try {
      const res = await apiClient.get(
        `/trading/sessions/${sessionId}/trades`
      );
      setTrades(res.data);
    } catch {
      setTrades([]);
    } finally {
      setTradesLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (activeTab === "orders") {
      fetchOrders();
    } else if (activeTab === "trades") {
      fetchTrades();
    }
  }, [activeTab, fetchOrders, fetchTrades]);

  const handleStart = async () => {
    await startSession(sessionId);
    fetchSnapshot(sessionId);
  };

  const handleStop = async () => {
    await stopSession(sessionId);
  };

  const handlePause = async () => {
    await pauseSession(sessionId);
  };

  const handleResume = async () => {
    await resumeSession(sessionId);
    fetchSnapshot(sessionId);
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this session?")) {
      await deleteSession(sessionId);
      router.push("/paper-trading");
    }
  };

  // Loading state
  if (loading && !session) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error / not found state
  if (error || !session) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/paper-trading")}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Paper Trading
        </button>
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
          {error || "Session not found"}
        </div>
      </div>
    );
  }

  const pnlColor =
    snapshot && snapshot.total_pnl >= 0 ? "text-green-600" : "text-red-600";
  const isRunning = session.status === "running";

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <button
            onClick={() => router.push("/paper-trading")}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Paper Trading
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Paper Trading Session
            </h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Strategy: {session.strategy_id.slice(0, 8)}... v
            {session.strategy_version} &middot;{" "}
            {session.instruments.join(", ")} &middot; {session.timeframe} &middot;{" "}
            {formatCurrency(session.initial_capital)} capital
          </p>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2">
          {(session.status === "stopped" || session.status === "error") && (
            <>
              <Button onClick={handleStart} size="sm">
                <Play className="h-4 w-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={handleDelete}
                variant="destructive"
                size="sm"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </>
          )}
          {session.status === "running" && (
            <>
              <Button
                onClick={handlePause}
                variant="outline"
                size="sm"
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
              <Button
                onClick={handleStop}
                variant="destructive"
                size="sm"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </>
          )}
          {session.status === "paused" && (
            <>
              <Button onClick={handleResume} size="sm">
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
              <Button
                onClick={handleStop}
                variant="destructive"
                size="sm"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error message */}
      {session.status === "error" && session.error_message && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 flex-shrink-0">
          <p className="font-medium text-red-800">Session Error</p>
          <p className="text-sm text-red-700 mt-1">{session.error_message}</p>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
        <MetricCard
          label="Portfolio Value"
          value={snapshot ? formatCurrency(snapshot.portfolio_value) : formatCurrency(session.initial_capital)}
          icon={DollarSign}
          color={
            snapshot
              ? snapshot.portfolio_value >= session.initial_capital
                ? "text-green-600"
                : "text-red-600"
              : undefined
          }
        />
        <MetricCard
          label="Cash"
          value={snapshot ? formatCurrency(snapshot.cash) : formatCurrency(session.initial_capital)}
          icon={DollarSign}
        />
        <MetricCard
          label="Total P&L"
          value={snapshot ? formatCurrency(snapshot.total_pnl) : formatCurrency(0)}
          icon={snapshot && snapshot.total_pnl >= 0 ? TrendingUp : TrendingDown}
          color={snapshot ? pnlColor : undefined}
        />
        <MetricCard
          label="Total Trades"
          value={snapshot ? formatNumber(snapshot.total_trades) : "0"}
          icon={BarChart3}
        />
      </div>

      {/* Main area: Chart + Data Panel */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chart (left) */}
        <div className="flex-[2] min-w-0 border rounded-lg bg-card overflow-hidden">
          <LiveChart
            instruments={session.instruments}
            sessionTimeframe={session.timeframe}
            snapshot={snapshot}
            isRunning={isRunning}
          />
        </div>

        {/* Data Panel (right) */}
        <div className="flex-1 min-w-[320px] flex flex-col min-h-0">
          {/* Tab Navigation */}
          <div className="border-b flex-shrink-0">
            <nav className="flex">
              {(["positions", "orders", "trades"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex-1 pb-2 text-xs font-medium border-b-2 transition-colors capitalize text-center",
                    activeTab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab}
                  {tab === "positions" && snapshot && snapshot.positions.length > 0 && (
                    <span className="ml-1 text-[10px] bg-accent text-accent-foreground px-1 py-0.5 rounded-full">
                      {snapshot.positions.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Positions Tab */}
            {activeTab === "positions" && (
              <div className="p-2">
                {!snapshot || snapshot.positions.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    No open positions
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.positions.map((pos, i) => (
                      <div
                        key={`${pos.symbol}-${pos.exchange}-${i}`}
                        className="border rounded-md p-2.5 text-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{pos.exchange}:{pos.symbol}</span>
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                pos.side === "LONG" || pos.side === "BUY"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              )}
                            >
                              {pos.side}
                            </span>
                          </div>
                          <span className="text-muted-foreground text-xs">
                            Qty: {pos.quantity}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Avg: {formatCurrency(pos.avg_price)} &rarr; {formatCurrency(pos.current_price)}
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              pos.unrealized_pnl >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
                            {formatCurrency(pos.unrealized_pnl)} ({formatPercent(pos.pnl_percent)})
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Orders Tab */}
            {activeTab === "orders" && (
              <div className="p-2">
                {ordersLoading ? (
                  <div className="h-32 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : orders.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    No orders placed
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {[...orders].reverse().map((order) => (
                      <div
                        key={order.id}
                        className="border rounded-md p-2 text-xs"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                order.transaction_type === "BUY"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              )}
                            >
                              {order.transaction_type}
                            </span>
                            <span className="font-medium">{order.tradingsymbol}</span>
                            <span className="text-muted-foreground">x{order.quantity}</span>
                          </div>
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium capitalize",
                              order.status === "COMPLETE"
                                ? "bg-green-100 text-green-800"
                                : order.status === "REJECTED" || order.status === "CANCELLED"
                                ? "bg-red-100 text-red-800"
                                : "bg-blue-100 text-blue-800"
                            )}
                          >
                            {order.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            {order.order_type} @ {order.average_price != null ? formatCurrency(order.average_price) : "Market"}
                          </span>
                          <span>{new Date(order.placed_at).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Trades Tab */}
            {activeTab === "trades" && (
              <div className="p-2">
                {tradesLoading ? (
                  <div className="h-32 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : trades.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    No trades recorded
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {[...trades].reverse().map((t) => (
                      <div
                        key={t.id}
                        className="border rounded-md p-2 text-xs"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                t.side === "LONG" || t.side === "BUY"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              )}
                            >
                              {t.side}
                            </span>
                            <span className="font-medium">{t.tradingsymbol}</span>
                            <span className="text-muted-foreground">x{t.quantity}</span>
                          </div>
                          <span
                            className={cn(
                              "font-semibold",
                              t.net_pnl != null
                                ? t.net_pnl >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                                : ""
                            )}
                          >
                            {t.net_pnl != null ? formatCurrency(t.net_pnl) : "--"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            {formatCurrency(t.entry_price)} &rarr;{" "}
                            {t.exit_price != null ? formatCurrency(t.exit_price) : "Open"}
                          </span>
                          <span>
                            {t.pnl_percent != null ? formatPercent(t.pnl_percent) : "--"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
