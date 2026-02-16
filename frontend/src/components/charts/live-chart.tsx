"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import {
  Loader2,
  Settings2,
  X,
  AlertTriangle,
  ExternalLink,
  WifiOff,
} from "lucide-react";
import type { TradingSnapshot } from "@/types/trading";

// ---------------------------------------------------------------------------
// Types
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
  time: any;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface VolumeData {
  time: any;
  value: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Indicator Calculations
// ---------------------------------------------------------------------------
function calcEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length === 0 || period <= 0) return result;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
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

function calcVWAP(candles: CandleData[], volumes: number[]): (number | null)[] {
  const result: (number | null)[] = [];
  let cumTP = 0;
  let cumVol = 0;
  let lastDay = -1;
  for (let i = 0; i < candles.length; i++) {
    const dayNum = Math.floor(candles[i].time / 86400);
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

function calcCPR(candles: CandleData[]) {
  if (candles.length === 0) return null;
  const dayMap = new Map<number, { high: number; low: number; close: number }>();
  for (const c of candles) {
    const dayNum = Math.floor(c.time / 86400);
    const existing = dayMap.get(dayNum);
    if (existing) {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
    } else {
      dayMap.set(dayNum, { high: c.high, low: c.low, close: c.close });
    }
  }
  const days = Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0]);
  if (days.length < 2) return null;
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
// Constants
// ---------------------------------------------------------------------------
const INDICATOR_COLORS = {
  emaFast: "#2196F3",
  emaSlow: "#FF9800",
  sma: "#00BCD4",
  cprPivot: "#9C27B0",
  cprTC: "#9C27B0",
  cprBC: "#9C27B0",
  cprR1: "#F44336",
  cprR2: "#F44336",
  cprS1: "#4CAF50",
  cprS2: "#4CAF50",
  vwap: "#E91E63",
  bollingerUpper: "#607D8B",
  bollingerMiddle: "#607D8B",
  bollingerLower: "#607D8B",
};

const TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1H", value: "1h" },
  { label: "1D", value: "1d" },
];

const STORAGE_KEY_TIMEFRAME = "chart_timeframe";
const CHART_TIMEZONE_KEY = "chart_timezone";
const DEFAULT_TIMEZONE = "Asia/Kolkata";

function getTimezoneOffsetSeconds(timezone: string): number {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    return Math.round((tzDate.getTime() - utcDate.getTime()) / 1000);
  } catch {
    return 19800; // Default to IST (+5:30)
  }
}

// ---------------------------------------------------------------------------
// Indicator Panel
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
    onChange({ ...config, [key]: { ...config[key], enabled: !config[key].enabled } });
  };
  const updateParam = (key: keyof IndicatorConfig, param: string, val: number) => {
    onChange({ ...config, [key]: { ...config[key], [param]: val } });
  };

  return (
    <div className="absolute top-full right-0 mt-1 w-72 bg-card border rounded-lg shadow-xl z-50 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indicators</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-2.5">
        {/* EMA Fast */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={config.emaFast.enabled} onChange={() => toggle("emaFast")} className="rounded border-input h-3.5 w-3.5 accent-blue-500" />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.emaFast }}>EMA Fast</span>
          <input type="number" value={config.emaFast.period} onChange={(e) => updateParam("emaFast", "period", parseInt(e.target.value) || 9)} className="w-14 px-1.5 py-0.5 text-xs rounded border border-input bg-background text-center" min={1} max={200} />
        </div>
        {/* EMA Slow */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={config.emaSlow.enabled} onChange={() => toggle("emaSlow")} className="rounded border-input h-3.5 w-3.5 accent-orange-500" />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.emaSlow }}>EMA Slow</span>
          <input type="number" value={config.emaSlow.period} onChange={(e) => updateParam("emaSlow", "period", parseInt(e.target.value) || 21)} className="w-14 px-1.5 py-0.5 text-xs rounded border border-input bg-background text-center" min={1} max={200} />
        </div>
        {/* SMA */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={config.sma.enabled} onChange={() => toggle("sma")} className="rounded border-input h-3.5 w-3.5 accent-cyan-500" />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.sma }}>SMA</span>
          <input type="number" value={config.sma.period} onChange={(e) => updateParam("sma", "period", parseInt(e.target.value) || 20)} className="w-14 px-1.5 py-0.5 text-xs rounded border border-input bg-background text-center" min={1} max={200} />
        </div>
        <div className="border-t border-border my-1" />
        {/* CPR */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={config.cpr.enabled} onChange={() => toggle("cpr")} className="rounded border-input h-3.5 w-3.5 accent-purple-500" />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.cprPivot }}>CPR (Pivot, S/R)</span>
          <span className="text-[10px] text-muted-foreground">Auto</span>
        </div>
        {/* VWAP */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={config.vwap.enabled} onChange={() => toggle("vwap")} className="rounded border-input h-3.5 w-3.5 accent-pink-500" />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.vwap }}>VWAP</span>
          <span className="text-[10px] text-muted-foreground">Daily</span>
        </div>
        <div className="border-t border-border my-1" />
        {/* Bollinger Bands */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={config.bollinger.enabled} onChange={() => toggle("bollinger")} className="rounded border-input h-3.5 w-3.5 accent-gray-500" />
          <span className="text-xs font-medium flex-1" style={{ color: INDICATOR_COLORS.bollingerMiddle }}>Bollinger Bands</span>
          <div className="flex items-center gap-1">
            <input type="number" value={config.bollinger.period} onChange={(e) => updateParam("bollinger", "period", parseInt(e.target.value) || 20)} className="w-10 px-1 py-0.5 text-xs rounded border border-input bg-background text-center" min={5} max={100} />
            <span className="text-[10px] text-muted-foreground">/</span>
            <input type="number" value={config.bollinger.stdDev} onChange={(e) => updateParam("bollinger", "stdDev", parseFloat(e.target.value) || 2)} className="w-10 px-1 py-0.5 text-xs rounded border border-input bg-background text-center" min={0.5} max={5} step={0.5} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time parsing
// ---------------------------------------------------------------------------
function toChartTime(timeStr: string, isDaily: boolean, tzOffsetSeconds: number = 0): string | number {
  if (isDaily) return timeStr.slice(0, 10);
  return Math.floor(new Date(timeStr).getTime() / 1000) + tzOffsetSeconds;
}

// ---------------------------------------------------------------------------
// LiveChart Component
// ---------------------------------------------------------------------------
export default function LiveChart({
  instruments,
  sessionTimeframe,
  snapshot,
  isRunning,
  brokerConnected,
}: {
  instruments: string[];
  sessionTimeframe: string;
  snapshot: TradingSnapshot | null;
  isRunning: boolean;
  brokerConnected: boolean | null;
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
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY_TIMEFRAME) || sessionTimeframe;
    }
    return sessionTimeframe;
  });
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATORS);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);

  const timezoneOffset = useMemo(() => {
    if (typeof window === "undefined") return 19800;
    const tz = localStorage.getItem(CHART_TIMEZONE_KEY) || DEFAULT_TIMEZONE;
    return getTimezoneOffsetSeconds(tz);
  }, []);

  const earliestDateRef = useRef<string>("");
  const isLoadingMoreRef = useRef(false);

  const primaryInstrument = instruments[0] || "";
  const sym = primaryInstrument.includes(":") ? primaryInstrument.split(":")[1] : primaryInstrument;
  const exch = primaryInstrument.includes(":") ? primaryInstrument.split(":")[0] : "NSE";

  const activeCount = Object.values(indicators).filter((v) => v.enabled).length;

  // Persist timeframe to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TIMEFRAME, chartTimeframe);
  }, [chartTimeframe]);

  // Apply indicators
  const applyIndicators = useCallback(
    (chart: any, candleSeries: any, candles: CandleData[], volumes: number[], config: IndicatorConfig) => {
      for (const [, series] of Object.entries(indicatorSeriesRef.current)) {
        try { chart.removeSeries(series); } catch {}
      }
      indicatorSeriesRef.current = {};
      try {
        const allPriceLines = (candleSeries as any).__cprLines || [];
        for (const pl of allPriceLines) { candleSeries.removePriceLine(pl); }
      } catch {}
      (candleSeries as any).__cprLines = [];
      if (candles.length === 0) return;

      const closes = candles.map((c) => c.close);
      const times = candles.map((c) => c.time);

      if (config.emaFast.enabled) {
        const emaData = calcEMA(closes, config.emaFast.period);
        const series = chart.addLineSeries({ color: INDICATOR_COLORS.emaFast, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        series.setData(emaData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.emaFast = series;
      }
      if (config.emaSlow.enabled) {
        const emaData = calcEMA(closes, config.emaSlow.period);
        const series = chart.addLineSeries({ color: INDICATOR_COLORS.emaSlow, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        series.setData(emaData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.emaSlow = series;
      }
      if (config.sma.enabled) {
        const smaData = calcSMA(closes, config.sma.period);
        const series = chart.addLineSeries({ color: INDICATOR_COLORS.sma, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        series.setData(smaData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.sma = series;
      }
      if (config.vwap.enabled) {
        const vwapData = calcVWAP(candles, volumes);
        const series = chart.addLineSeries({ color: INDICATOR_COLORS.vwap, lineWidth: 1.5, lineStyle: 0, priceLineVisible: false, lastValueVisible: false });
        series.setData(vwapData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.vwap = series;
      }
      if (config.bollinger.enabled) {
        const bb = calcBollinger(closes, config.bollinger.period, config.bollinger.stdDev);
        const upperSeries = chart.addLineSeries({ color: INDICATOR_COLORS.bollingerUpper, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
        upperSeries.setData(bb.upper.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.bollingerUpper = upperSeries;
        const middleSeries = chart.addLineSeries({ color: INDICATOR_COLORS.bollingerMiddle, lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false });
        middleSeries.setData(bb.middle.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.bollingerMiddle = middleSeries;
        const lowerSeries = chart.addLineSeries({ color: INDICATOR_COLORS.bollingerLower, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
        lowerSeries.setData(bb.lower.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
        indicatorSeriesRef.current.bollingerLower = lowerSeries;
      }
      if (config.cpr.enabled) {
        const cpr = calcCPR(candles);
        if (cpr) {
          const lines: any[] = [];
          const addLine = (price: number, color: string, title: string, dash: boolean) => {
            const pl = candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: dash ? 2 : 1, axisLabelVisible: true, title });
            lines.push(pl);
          };
          addLine(cpr.pivot, INDICATOR_COLORS.cprPivot, "P", false);
          addLine(cpr.tc, INDICATOR_COLORS.cprTC, "TC", true);
          addLine(cpr.bc, INDICATOR_COLORS.cprBC, "BC", true);
          addLine(cpr.r1, INDICATOR_COLORS.cprR1, "R1", true);
          addLine(cpr.r2, INDICATOR_COLORS.cprR2, "R2", true);
          addLine(cpr.s1, INDICATOR_COLORS.cprS1, "S1", true);
          addLine(cpr.s2, INDICATOR_COLORS.cprS2, "S2", true);
          (candleSeries as any).__cprLines = lines;
        }
      }
    },
    []
  );

  // Process raw OHLCV API data
  const processOHLCV = useCallback(
    (data: any[], daily: boolean): { candles: CandleData[]; volumes: VolumeData[]; rawVolumes: number[] } => {
      const candleData: CandleData[] = data.map((d: any) => ({
        time: toChartTime(d.time || d.timestamp, daily, timezoneOffset),
        open: d.open, high: d.high, low: d.low, close: d.close,
      }));
      const rawVolumeArr: number[] = data.map((d: any) => d.volume || 0);
      const volumeData: VolumeData[] = data.map((d: any, i: number) => ({
        time: candleData[i].time,
        value: d.volume || 0,
        color: d.close >= d.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      const seen = new Set<any>();
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

      candles.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      volumes.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      const timeOrder = candles.map((c) => c.time);
      const sortedRaw = timeOrder.map((t) => {
        const idx = candles.findIndex((uc) => uc.time === t);
        return rawVolumes[idx] || 0;
      });

      return { candles, volumes, rawVolumes: sortedRaw };
    },
    [timezoneOffset]
  );

  // Load more history on scroll
  const loadMoreHistory = useCallback(async () => {
    if (isLoadingMoreRef.current || !chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current || !earliestDateRef.current) return;
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
        `/market-data/ohlcv?symbol=${sym}&exchange=${exch}&from_date=${fromStr}&to_date=${toStr}&interval=${chartTimeframe}`,
        { _suppressToast: true } as any
      );
      const newData = res.data || [];
      if (newData.length === 0) return;

      const { candles: newCandles, volumes: newVolumes, rawVolumes: newRawVolumes } = processOHLCV(newData, chartTimeframe === "1d");
      if (newCandles.length === 0) return;

      const existingCandles = rawCandlesRef.current;
      const existingVolumes = rawVolumesRef.current;
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

      const allCandles = [...filteredCandles, ...existingCandles].sort((a, b) => a.time - b.time);
      const candleTimeToIdx = new Map<any, number>();
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

      const visibleRange = chartRef.current?.timeScale().getVisibleRange();
      candleSeriesRef.current.setData(allCandles as any[]);
      volumeSeriesRef.current.setData(allVolumeBars as any[]);
      if (visibleRange) {
        chartRef.current?.timeScale().setVisibleRange(visibleRange);
      }
      rawCandlesRef.current = allCandles;
      rawVolumesRef.current = mergedRawVolumes;
      earliestDateRef.current = fromStr;
      applyIndicators(chartRef.current, candleSeriesRef.current, allCandles, mergedRawVolumes, indicators);
    } catch {
      // silently fail
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [sym, exch, chartTimeframe, processOHLCV, applyIndicators, indicators]);

  // Load historical candles and create chart
  useEffect(() => {
    if (!sym || !chartContainerRef.current || brokerConnected === false) return;

    setChartLoading(true);
    setChartError(null);

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - (chartTimeframe === "1d" ? 365 : 30));
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);
    earliestDateRef.current = fromStr;

    Promise.all([
      apiClient.get(`/market-data/ohlcv?symbol=${sym}&exchange=${exch}&from_date=${fromStr}&to_date=${toStr}&interval=${chartTimeframe}`),
      import("lightweight-charts"),
    ])
      .then(([ohlcvRes, lc]) => {
        if (!chartContainerRef.current) return;
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

        const { createChart, ColorType } = lc;
        const isDaily = chartTimeframe === "1d";

        const chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          layout: { background: { type: ColorType.Solid, color: "#09090b" }, textColor: "#9ca3af", fontSize: 11 },
          grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
          crosshair: { mode: 0 },
          timeScale: { borderColor: "#374151", timeVisible: !isDaily, secondsVisible: false, rightOffset: 5, minBarSpacing: 3 },
          rightPriceScale: { borderColor: "#374151" },
        });

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#22c55e", downColor: "#ef4444", borderDownColor: "#ef4444", borderUpColor: "#22c55e", wickDownColor: "#ef4444", wickUpColor: "#22c55e",
        });
        const volumeSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "volume" });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        const data = ohlcvRes.data || [];
        const { candles: uniqueCandles, volumes: uniqueVolumes, rawVolumes: sortedRawVolumes } = processOHLCV(data, isDaily);

        candleSeries.setData(uniqueCandles as any[]);
        volumeSeries.setData(uniqueVolumes as any[]);
        chart.timeScale().fitContent();

        if (uniqueCandles.length > 0) lastCandleRef.current = uniqueCandles[uniqueCandles.length - 1];

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;
        rawCandlesRef.current = uniqueCandles;
        rawVolumesRef.current = sortedRawVolumes;

        applyIndicators(chart, candleSeries, uniqueCandles, sortedRawVolumes, indicators);

        chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange: any) => {
          if (!logicalRange) return;
          if (logicalRange.from < 10) loadMoreHistory();
        });

        const handleResize = () => {
          if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
          }
        };
        window.addEventListener("resize", handleResize);
        setChartLoading(false);
        return () => { window.removeEventListener("resize", handleResize); };
      })
      .catch((err: any) => {
        const msg = err?.response?.data?.detail || `Failed to load chart data (${err?.response?.status || "network error"})`;
        setChartError(msg);
        setChartLoading(false);
      });

    return () => {
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [sym, exch, chartTimeframe, brokerConnected]);

  // Re-apply indicators when config changes
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || rawCandlesRef.current.length === 0) return;
    applyIndicators(chartRef.current, candleSeriesRef.current, rawCandlesRef.current, rawVolumesRef.current, indicators);
  }, [indicators, applyIndicators]);

  // Update last candle with live price from snapshot
  useEffect(() => {
    if (!snapshot || !candleSeriesRef.current || !sym) return;

    const price = snapshot.prices[sym] || snapshot.prices[sym.toUpperCase()];
    if (!price) return;

    const isDaily = chartTimeframe === "1d";
    const now = Math.floor(Date.now() / 1000) + timezoneOffset;
    const lastCandle = lastCandleRef.current;

    const intervalSecs: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400 };
    const interval = intervalSecs[chartTimeframe] || 3600;

    if (lastCandle) {
      if (isDaily) {
        const todayStr = new Date(Date.now() + timezoneOffset * 1000).toISOString().slice(0, 10);
        if (lastCandle.time === todayStr) {
          const updated = { ...lastCandle, high: Math.max(lastCandle.high, price), low: Math.min(lastCandle.low, price), close: price };
          candleSeriesRef.current.update(updated);
          lastCandleRef.current = updated;
        } else {
          const newCandle: CandleData = { time: todayStr as any, open: price, high: price, low: price, close: price };
          candleSeriesRef.current.update(newCandle as any);
          lastCandleRef.current = newCandle;
        }
      } else {
        const lastTime = typeof lastCandle.time === "number" ? lastCandle.time : 0;
        const candleEnd = lastTime + interval;
        if (now < candleEnd) {
          const updated = { ...lastCandle, high: Math.max(lastCandle.high, price), low: Math.min(lastCandle.low, price), close: price };
          candleSeriesRef.current.update(updated);
          lastCandleRef.current = updated;
        } else {
          const newTime = Math.floor(now / interval) * interval;
          const newCandle: CandleData = { time: newTime, open: price, high: price, low: price, close: price };
          candleSeriesRef.current.update(newCandle as any);
          lastCandleRef.current = newCandle;
        }
      }
    }
  }, [snapshot, sym, chartTimeframe, timezoneOffset]);

  // Broker invalid overlay
  if (brokerConnected === false) {
    return (
      <div className="relative h-full min-h-[400px] flex flex-col items-center justify-center bg-card text-center px-6 rounded-lg">
        <WifiOff className="h-12 w-12 text-yellow-500 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-1">API Token Invalid</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-4">Your Kite API token is missing or expired. Re-authenticate in Settings to load live chart data.</p>
        <a href="/settings" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
          Go to Settings <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[400px] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card flex-shrink-0">
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
              <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none">{activeCount}</span>
            )}
          </button>
          {showIndicatorPanel && (
            <IndicatorPanel config={indicators} onChange={setIndicators} onClose={() => setShowIndicatorPanel(false)} />
          )}
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 relative">
        {chartLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {chartError && !chartLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/90 z-10">
            <div className="text-center space-y-2 max-w-xs">
              <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto" />
              <p className="text-sm text-muted-foreground">{chartError}</p>
              <button onClick={() => { setChartError(null); setChartLoading(true); }} className="text-xs text-primary hover:underline">Retry</button>
            </div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full min-h-[350px]" />
        {!isRunning && !chartLoading && !chartError && (
          <div className="absolute top-2 left-2 bg-yellow-500/20 text-yellow-500 text-xs px-2 py-1 rounded z-10">
            Session not running — chart shows historical data only
          </div>
        )}
      </div>
    </div>
  );
}
