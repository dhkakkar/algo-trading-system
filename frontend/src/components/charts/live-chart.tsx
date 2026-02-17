"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import {
  Loader2,
  Settings2,
  AlertTriangle,
  ExternalLink,
  WifiOff,
  Grid3X3,
} from "lucide-react";
import type { TradingSnapshot } from "@/types/trading";
import {
  IndicatorConfig,
  DEFAULT_INDICATORS,
  CandleData,
  VolumeData,
  IndicatorPanel,
  applyIndicators,
} from "./chart-indicators";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1H", value: "1h" },
  { label: "1D", value: "1d" },
];

const STORAGE_KEY_TIMEFRAME = "chart_timeframe";
const STORAGE_KEY_GRID = "chart_grid_visible";
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
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("chart_indicators");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return DEFAULT_INDICATORS;
  });
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [showGrid, setShowGrid] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY_GRID) !== "false";
    }
    return true;
  });

  // Persist indicator config
  useEffect(() => {
    localStorage.setItem("chart_indicators", JSON.stringify(indicators));
  }, [indicators]);

  // Persist grid preference and apply to chart
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_GRID, String(showGrid));
    if (chartRef.current) {
      const gridColor = showGrid ? "#1f2937" : "transparent";
      chartRef.current.applyOptions({ grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } } });
    }
  }, [showGrid]);

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
      applyIndicators(chartRef.current, candleSeriesRef.current, allCandles, mergedRawVolumes, indicators, indicatorSeriesRef);
    } catch {
      // silently fail
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [sym, exch, chartTimeframe, processOHLCV, indicators]);

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
          grid: { vertLines: { color: showGrid ? "#1f2937" : "transparent" }, horzLines: { color: showGrid ? "#1f2937" : "transparent" } },
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

        applyIndicators(chart, candleSeries, uniqueCandles, sortedRawVolumes, indicators, indicatorSeriesRef);

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
    applyIndicators(chartRef.current, candleSeriesRef.current, rawCandlesRef.current, rawVolumesRef.current, indicators, indicatorSeriesRef);
  }, [indicators]);

  // Update last candle with live price from snapshot + update indicators
  useEffect(() => {
    if (!snapshot || !candleSeriesRef.current || !sym) return;

    const price = snapshot.prices[sym] || snapshot.prices[sym.toUpperCase()];
    if (!price) return;

    const isDaily = chartTimeframe === "1d";
    const now = Math.floor(Date.now() / 1000) + timezoneOffset;
    const lastCandle = lastCandleRef.current;

    const intervalSecs: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400 };
    const interval = intervalSecs[chartTimeframe] || 3600;

    let updatedCandle: CandleData | null = null;
    let isNewCandle = false;

    if (lastCandle) {
      if (isDaily) {
        const todayStr = new Date(Date.now() + timezoneOffset * 1000).toISOString().slice(0, 10);
        if (lastCandle.time === todayStr) {
          updatedCandle = { ...lastCandle, high: Math.max(lastCandle.high, price), low: Math.min(lastCandle.low, price), close: price };
        } else {
          updatedCandle = { time: todayStr as any, open: price, high: price, low: price, close: price };
          isNewCandle = true;
        }
      } else {
        const lastTime = typeof lastCandle.time === "number" ? lastCandle.time : 0;
        const candleEnd = lastTime + interval;
        if (now < candleEnd) {
          updatedCandle = { ...lastCandle, high: Math.max(lastCandle.high, price), low: Math.min(lastCandle.low, price), close: price };
        } else {
          const newTime = Math.floor(now / interval) * interval;
          updatedCandle = { time: newTime, open: price, high: price, low: price, close: price };
          isNewCandle = true;
        }
      }
    }

    if (updatedCandle) {
      candleSeriesRef.current.update(updatedCandle as any);
      lastCandleRef.current = updatedCandle;

      // Keep rawCandlesRef in sync and reapply indicators
      const candles = rawCandlesRef.current;
      if (isNewCandle) {
        candles.push(updatedCandle);
      } else if (candles.length > 0) {
        candles[candles.length - 1] = updatedCandle;
      }
      if (chartRef.current) {
        applyIndicators(chartRef.current, candleSeriesRef.current, candles, rawVolumesRef.current, indicators, indicatorSeriesRef);
      }
    }
  }, [snapshot, sym, chartTimeframe, timezoneOffset, indicators]);

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
        <button
          onClick={() => setShowGrid(!showGrid)}
          title={showGrid ? "Hide grid lines" : "Show grid lines"}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors",
            showGrid
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          <Grid3X3 className="h-3.5 w-3.5" />
        </button>
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
