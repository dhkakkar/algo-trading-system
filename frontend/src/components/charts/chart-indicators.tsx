"use client";

import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface IndicatorConfig {
  emaFast: { enabled: boolean; period: number };
  emaSlow: { enabled: boolean; period: number };
  sma: { enabled: boolean; period: number };
  cpr: { enabled: boolean };
  vwap: { enabled: boolean };
  bollinger: { enabled: boolean; period: number; stdDev: number };
}

export const DEFAULT_INDICATORS: IndicatorConfig = {
  emaFast: { enabled: false, period: 9 },
  emaSlow: { enabled: false, period: 21 },
  sma: { enabled: false, period: 20 },
  cpr: { enabled: false },
  vwap: { enabled: false },
  bollinger: { enabled: false, period: 20, stdDev: 2 },
};

export interface CandleData {
  time: any;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeData {
  time: any;
  value: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Indicator Colors
// ---------------------------------------------------------------------------
export const INDICATOR_COLORS = {
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

interface CPRLevelData { time: any; value: number }
interface CPRResult {
  pivot: CPRLevelData[]; tc: CPRLevelData[]; bc: CPRLevelData[];
  r1: CPRLevelData[]; r2: CPRLevelData[]; s1: CPRLevelData[]; s2: CPRLevelData[];
}

function calcCPR(candles: CandleData[]): CPRResult | null {
  if (candles.length === 0) return null;

  // Group candles by day
  const isDaily = typeof candles[0].time === "string";
  const getDayKey = (c: CandleData): string =>
    isDaily ? (c.time as string) : String(Math.floor((c.time as number) / 86400));

  const dayGroups: { firstTime: any; lastTime: any; high: number; low: number; close: number }[] = [];
  const dayMap = new Map<string, number>();

  for (const c of candles) {
    const key = getDayKey(c);
    const idx = dayMap.get(key);
    if (idx !== undefined) {
      const g = dayGroups[idx];
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.lastTime = c.time;
    } else {
      dayMap.set(key, dayGroups.length);
      dayGroups.push({ firstTime: c.time, lastTime: c.time, high: c.high, low: c.low, close: c.close });
    }
  }

  if (dayGroups.length < 2) return null;

  const result: CPRResult = { pivot: [], tc: [], bc: [], r1: [], r2: [], s1: [], s2: [] };

  for (let i = 1; i < dayGroups.length; i++) {
    const prev = dayGroups[i - 1];
    const { high: pH, low: pL, close: pC } = prev;
    const pivot = (pH + pL + pC) / 3;
    const bc = (pH + pL) / 2;
    const tc = 2 * pivot - bc;
    const r1 = 2 * pivot - pL;
    const s1 = 2 * pivot - pH;
    const r2 = pivot + (pH - pL);
    const s2 = pivot - (pH - pL);

    const tStart = dayGroups[i].firstTime;
    const tEnd = dayGroups[i].lastTime;
    // Add start and end points so the line spans the entire day
    result.pivot.push({ time: tStart, value: pivot });
    result.tc.push({ time: tStart, value: tc });
    result.bc.push({ time: tStart, value: bc });
    result.r1.push({ time: tStart, value: r1 });
    result.r2.push({ time: tStart, value: r2 });
    result.s1.push({ time: tStart, value: s1 });
    result.s2.push({ time: tStart, value: s2 });
    if (tEnd !== tStart) {
      result.pivot.push({ time: tEnd, value: pivot });
      result.tc.push({ time: tEnd, value: tc });
      result.bc.push({ time: tEnd, value: bc });
      result.r1.push({ time: tEnd, value: r1 });
      result.r2.push({ time: tEnd, value: r2 });
      result.s1.push({ time: tEnd, value: s1 });
      result.s2.push({ time: tEnd, value: s2 });
    }
  }

  return result.pivot.length > 0 ? result : null;
}

// ---------------------------------------------------------------------------
// Indicator Panel Component
// ---------------------------------------------------------------------------
export function IndicatorPanel({
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
// Apply Indicators to Chart
// ---------------------------------------------------------------------------
export function applyIndicators(
  chart: any,
  candleSeries: any,
  candles: CandleData[],
  volumes: number[],
  config: IndicatorConfig,
  seriesRef: { current: Record<string, any> }
) {
  // Remove existing indicator series
  for (const [, series] of Object.entries(seriesRef.current)) {
    try { chart.removeSeries(series); } catch {}
  }
  seriesRef.current = {};

  if (candles.length === 0) return;

  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);

  if (config.emaFast.enabled) {
    const emaData = calcEMA(closes, config.emaFast.period);
    const series = chart.addLineSeries({ color: INDICATOR_COLORS.emaFast, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    series.setData(emaData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.emaFast = series;
  }
  if (config.emaSlow.enabled) {
    const emaData = calcEMA(closes, config.emaSlow.period);
    const series = chart.addLineSeries({ color: INDICATOR_COLORS.emaSlow, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    series.setData(emaData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.emaSlow = series;
  }
  if (config.sma.enabled) {
    const smaData = calcSMA(closes, config.sma.period);
    const series = chart.addLineSeries({ color: INDICATOR_COLORS.sma, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    series.setData(smaData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.sma = series;
  }
  if (config.vwap.enabled) {
    const vwapData = calcVWAP(candles, volumes);
    const series = chart.addLineSeries({ color: INDICATOR_COLORS.vwap, lineWidth: 1.5, lineStyle: 0, priceLineVisible: false, lastValueVisible: false });
    series.setData(vwapData.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.vwap = series;
  }
  if (config.bollinger.enabled) {
    const bb = calcBollinger(closes, config.bollinger.period, config.bollinger.stdDev);
    const upperSeries = chart.addLineSeries({ color: INDICATOR_COLORS.bollingerUpper, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    upperSeries.setData(bb.upper.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.bollingerUpper = upperSeries;
    const middleSeries = chart.addLineSeries({ color: INDICATOR_COLORS.bollingerMiddle, lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false });
    middleSeries.setData(bb.middle.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.bollingerMiddle = middleSeries;
    const lowerSeries = chart.addLineSeries({ color: INDICATOR_COLORS.bollingerLower, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    lowerSeries.setData(bb.lower.map((v, i) => (v != null ? { time: times[i] as any, value: v } : null)).filter(Boolean));
    seriesRef.current.bollingerLower = lowerSeries;
  }
  if (config.cpr.enabled) {
    const cpr = calcCPR(candles);
    if (cpr) {
      const addCPRLine = (data: CPRLevelData[], color: string, key: string, dash: boolean) => {
        const series = chart.addLineSeries({
          color,
          lineWidth: 1,
          lineStyle: dash ? 2 : 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(data);
        seriesRef.current[`cpr_${key}`] = series;
      };
      addCPRLine(cpr.pivot, INDICATOR_COLORS.cprPivot, "pivot", false);
      addCPRLine(cpr.tc, INDICATOR_COLORS.cprTC, "tc", true);
      addCPRLine(cpr.bc, INDICATOR_COLORS.cprBC, "bc", true);
      addCPRLine(cpr.r1, INDICATOR_COLORS.cprR1, "r1", true);
      addCPRLine(cpr.r2, INDICATOR_COLORS.cprR2, "r2", true);
      addCPRLine(cpr.s1, INDICATOR_COLORS.cprS1, "s1", true);
      addCPRLine(cpr.s2, INDICATOR_COLORS.cprS2, "s2", true);
    }
  }
}
