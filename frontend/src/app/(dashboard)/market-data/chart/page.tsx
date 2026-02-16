"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  X,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import apiClient from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import {
  IndicatorConfig,
  DEFAULT_INDICATORS,
  CandleData,
  IndicatorPanel,
  applyIndicators,
} from "@/components/charts/chart-indicators";

const INTERVAL_OPTIONS = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "1d", label: "1D" },
];

interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Map our interval codes to Kite API interval names
const INTERVAL_TO_KITE: Record<string, string> = {
  "1m": "minute",
  "5m": "5minute",
  "15m": "15minute",
  "30m": "30minute",
  "1h": "60minute",
  "1d": "day",
};

// How many days to look back per scroll-load for each interval
const SCROLL_LOOKBACK: Record<string, number> = {
  "1m": 7,
  "5m": 30,
  "15m": 30,
  "30m": 60,
  "1h": 90,
  "1d": 365,
};

const SPEED_OPTIONS = [1, 2, 5, 10, 25, 50];

const CHART_TIMEZONE_KEY = "chart_timezone";
const DEFAULT_TIMEZONE = "Asia/Kolkata";

function getTimezoneOffsetSeconds(timezone: string): number {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    return Math.round((tzDate.getTime() - utcDate.getTime()) / 1000);
  } catch {
    return 19800;
  }
}

export default function ChartPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuthStore();

  const symbol = searchParams.get("symbol") || "";
  const exchange = searchParams.get("exchange") || "NSE";

  const [interval, setInterval] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("md_chart_interval") || "1d";
    return "1d";
  });
  const [fromDate, setFromDate] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("md_chart_from");
      if (saved) return saved;
    }
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("md_chart_to");
      if (saved) return saved;
    }
    return new Date().toISOString().slice(0, 10);
  });

  // Persist settings to localStorage
  useEffect(() => { localStorage.setItem("md_chart_interval", interval); }, [interval]);
  useEffect(() => { localStorage.setItem("md_chart_from", fromDate); }, [fromDate]);
  useEffect(() => { localStorage.setItem("md_chart_to", toDate); }, [toDate]);

  const [data, setData] = useState<OHLCVBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Record<string, any>>({});
  const rawCandlesRef = useRef<CandleData[]>([]);
  const rawVolumesRef = useRef<number[]>([]);

  // Indicator state (persisted to localStorage)
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
  const indicatorsRef = useRef<IndicatorConfig>(indicators);

  // Persist indicator config
  useEffect(() => {
    localStorage.setItem("chart_indicators", JSON.stringify(indicators));
  }, [indicators]);
  const activeCount = Object.values(indicators).filter((v) => v.enabled).length;

  // Infinite scroll refs
  const dataRef = useRef<OHLCVBar[]>([]);
  const earliestDateRef = useRef(fromDate);
  const loadingOlderRef = useRef(false);
  const noMoreDataRef = useRef(false);
  const isScrollLoadRef = useRef(false);
  const loadOlderDataRef = useRef<() => Promise<void>>(undefined);

  // Replay state
  const [replayMode, setReplayMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const replayIndexRef = useRef(0);
  const replayTimerRef = useRef<number | null>(null);
  const intervalRef = useRef(interval);
  const timezoneOffset = useMemo(() => {
    if (typeof window === "undefined") return 19800;
    const tz = localStorage.getItem(CHART_TIMEZONE_KEY) || DEFAULT_TIMEZONE;
    return getTimezoneOffsetSeconds(tz);
  }, []);

  // Keep refs in sync
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);

  useEffect(() => {
    indicatorsRef.current = indicators;
  }, [indicators]);

  // Reset scroll state when key params change
  useEffect(() => {
    earliestDateRef.current = fromDate;
    noMoreDataRef.current = false;
  }, [fromDate, interval, symbol]);

  // Exit replay when params change
  useEffect(() => {
    if (replayMode) {
      setReplayMode(false);
      setIsPlaying(false);
      if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, fromDate, toDate]);

  const fetchData = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setFetchMsg(null);

    try {
      // For superadmins: always sync from Kite first, then load from DB
      if (user?.is_superadmin) {
        setFetchMsg("Syncing data from Kite...");
        try {
          const kiteInterval = INTERVAL_TO_KITE[interval] || "day";
          const fetchRes = await apiClient.post("/admin/fetch-historical", {
            symbol,
            exchange,
            from_date: fromDate,
            to_date: toDate,
            interval: kiteInterval,
          });
          setFetchMsg(`Synced ${fetchRes.data.count} records from Kite`);
        } catch (fetchErr: any) {
          // Non-fatal — still try to load whatever is in DB
          setFetchMsg(fetchErr.response?.data?.detail || "Kite sync failed — showing cached data");
        }
      }

      // Load from DB
      const res = await apiClient.get("/market-data/ohlcv", {
        params: { symbol, exchange, from_date: fromDate, to_date: toDate, interval },
      });
      setData(res.data);
      if (res.data.length === 0) {
        setError("No data available for the selected date range.");
        setFetchMsg(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load chart data");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange, fromDate, toDate, interval, user?.is_superadmin]);

  // Fetch on mount and when params change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load older data when user scrolls past the left edge
  const loadOlderData = useCallback(async () => {
    if (loadingOlderRef.current || noMoreDataRef.current || !symbol || replayMode) return;
    loadingOlderRef.current = true;

    const lookbackDays = SCROLL_LOOKBACK[interval] || 180;
    const currentEarliest = earliestDateRef.current;
    const newFrom = new Date(currentEarliest);
    newFrom.setDate(newFrom.getDate() - lookbackDays);
    const newFromStr = newFrom.toISOString().slice(0, 10);

    try {
      // Sync from Kite if superadmin
      if (user?.is_superadmin) {
        const kiteInterval = INTERVAL_TO_KITE[interval] || "day";
        try {
          await apiClient.post("/admin/fetch-historical", {
            symbol,
            exchange,
            from_date: newFromStr,
            to_date: currentEarliest,
            interval: kiteInterval,
          });
        } catch {
          // non-fatal
        }
      }

      // Load from DB for the extended range
      const res = await apiClient.get("/market-data/ohlcv", {
        params: {
          symbol,
          exchange,
          from_date: newFromStr,
          to_date: currentEarliest,
          interval,
        },
      });

      // Deduplicate against existing data
      const existingTimes = new Set(dataRef.current.map((b) => b.time));
      const newBars: OHLCVBar[] = (res.data as OHLCVBar[]).filter(
        (b) => !existingTimes.has(b.time)
      );

      if (newBars.length === 0) {
        noMoreDataRef.current = true;
      } else {
        const merged = [...newBars, ...dataRef.current];
        earliestDateRef.current = newFromStr;
        isScrollLoadRef.current = true;
        setData(merged);
      }
    } catch {
      // Silently fail for scroll loads
    } finally {
      loadingOlderRef.current = false;
    }
  }, [symbol, exchange, interval, user?.is_superadmin, replayMode]);

  // Keep loadOlderData ref current for use in chart event handlers (avoids stale closures)
  useEffect(() => {
    loadOlderDataRef.current = loadOlderData;
  }, [loadOlderData]);

  // Live polling: fetch latest candle every 5s for intraday intervals
  useEffect(() => {
    // Only poll for intraday intervals, when not in replay mode, and when we have a chart
    if (interval === "1d" || replayMode || !symbol) return;

    const pollLatest = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);

        // Sync fresh data from Kite for superadmin
        if (user?.is_superadmin) {
          const kiteInterval = INTERVAL_TO_KITE[interval] || "day";
          await apiClient.post("/admin/fetch-historical", {
            symbol, exchange, from_date: today, to_date: today, interval: kiteInterval,
          }, { _suppressToast: true } as any).catch(() => {});
        }

        const res = await apiClient.get("/market-data/ohlcv", {
          params: { symbol, exchange, from_date: today, to_date: today, interval },
          _suppressToast: true,
        } as any);
        const bars: OHLCVBar[] = res.data || [];
        if (bars.length === 0 || !candleSeriesRef.current || !volumeSeriesRef.current) return;

        // Get the latest bar from the API
        const latestBar = bars[bars.length - 1];
        const ts = Math.floor(new Date(latestBar.time).getTime() / 1000) + timezoneOffset;

        // Update the last candle (or add new one) in-place
        candleSeriesRef.current.update({
          time: ts,
          open: latestBar.open,
          high: latestBar.high,
          low: latestBar.low,
          close: latestBar.close,
        });
        volumeSeriesRef.current.update({
          time: ts,
          value: latestBar.volume,
          color: latestBar.close >= latestBar.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
        });

        // Also update the data array so replay/scroll don't lose it
        const existing = dataRef.current;
        if (existing.length > 0) {
          const lastTime = existing[existing.length - 1].time;
          const latestTime = latestBar.time;
          if (lastTime === latestTime) {
            existing[existing.length - 1] = latestBar;
          } else if (new Date(latestTime) > new Date(lastTime)) {
            existing.push(latestBar);
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    const timer = window.setInterval(pollLatest, 10000);
    // Also run once immediately
    pollLatest();

    return () => clearInterval(timer);
  }, [symbol, exchange, interval, replayMode, user?.is_superadmin]);

  // --- Replay functions ---

  // Update chart to show data up to a given index (uses refs, no stale closures)
  const updateChartToIndex = useCallback((index: number) => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || dataRef.current.length === 0) return;

    const isDaily = intervalRef.current === "1d";
    const parseTime = (timeStr: string) => {
      if (isDaily) return timeStr.slice(0, 10);
      return Math.floor(new Date(timeStr).getTime() / 1000) + timezoneOffset;
    };

    const slice = dataRef.current.slice(0, index + 1);
    const candleData = slice.map((bar) => ({
      time: parseTime(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    const volumeData = slice.map((bar) => ({
      time: parseTime(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
    }));

    candleSeriesRef.current.setData(candleData as any);
    volumeSeriesRef.current.setData(volumeData as any);

    if (chartRef.current) {
      const sliceVolumes = dataRef.current.slice(0, index + 1).map((b) => b.volume);
      applyIndicators(chartRef.current, candleSeriesRef.current, candleData as CandleData[], sliceVolumes, indicatorsRef.current, indicatorSeriesRef);
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, []);

  const enterReplay = useCallback(() => {
    if (dataRef.current.length === 0) return;
    setReplayMode(true);
    setIsPlaying(false);
    setReplaySpeed(1);
    setReplayIndex(0);
    replayIndexRef.current = 0;
    if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    // Show just the first bar
    updateChartToIndex(0);
  }, [updateChartToIndex]);

  const exitReplay = useCallback(() => {
    setReplayMode(false);
    setIsPlaying(false);
    if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    // Restore full data
    if (candleSeriesRef.current && volumeSeriesRef.current && dataRef.current.length > 0) {
      updateChartToIndex(dataRef.current.length - 1);
      if (chartRef.current) chartRef.current.timeScale().fitContent();
    }
  }, [updateChartToIndex]);

  const stepForward = useCallback(() => {
    if (replayIndexRef.current >= dataRef.current.length - 1) return;
    const next = replayIndexRef.current + 1;
    replayIndexRef.current = next;
    setReplayIndex(next);
    updateChartToIndex(next);
  }, [updateChartToIndex]);

  const resetReplay = useCallback(() => {
    setIsPlaying(false);
    if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    replayIndexRef.current = 0;
    setReplayIndex(0);
    updateChartToIndex(0);
  }, [updateChartToIndex]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    } else {
      // If at the end, reset to beginning
      if (replayIndexRef.current >= dataRef.current.length - 1) {
        replayIndexRef.current = 0;
        setReplayIndex(0);
        updateChartToIndex(0);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, updateChartToIndex]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    replayIndexRef.current = idx;
    setReplayIndex(idx);
    updateChartToIndex(idx);
  }, [updateChartToIndex]);

  // Play timer
  useEffect(() => {
    if (!isPlaying || !replayMode) return;

    const intervalMs = Math.max(500 / replaySpeed, 20);
    const timer = window.setInterval(() => {
      const next = replayIndexRef.current + 1;
      if (next >= dataRef.current.length) {
        setIsPlaying(false);
        return;
      }
      replayIndexRef.current = next;
      setReplayIndex(next);
      updateChartToIndex(next);
    }, intervalMs) as unknown as number;

    replayTimerRef.current = timer;

    return () => { clearInterval(timer); replayTimerRef.current = null; };
  }, [isPlaying, replayMode, replaySpeed, updateChartToIndex]);

  // Render chart
  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const isDaily = interval === "1d";

    const parseTime = (timeStr: string) => {
      if (isDaily) {
        return timeStr.slice(0, 10); // "YYYY-MM-DD"
      }
      // For intraday, convert to unix timestamp (seconds) + timezone offset
      return Math.floor(new Date(timeStr).getTime() / 1000) + timezoneOffset;
    };

    const candleData = data.map((bar) => ({
      time: parseTime(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    const volumeData = data.map((bar) => ({
      time: parseTime(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
    }));

    // Scroll load: update series data in-place, preserve scroll position
    if (
      isScrollLoadRef.current &&
      chartRef.current &&
      candleSeriesRef.current &&
      volumeSeriesRef.current
    ) {
      isScrollLoadRef.current = false;

      // Save current visible time range so we can restore it after data update
      const visibleRange = chartRef.current.timeScale().getVisibleRange();

      candleSeriesRef.current.setData(candleData as any);
      volumeSeriesRef.current.setData(volumeData as any);

      // Restore scroll position so the view doesn't jump
      if (visibleRange) {
        chartRef.current.timeScale().setVisibleRange(visibleRange);
      }
      // Update indicator data with the full range
      rawCandlesRef.current = candleData as CandleData[];
      rawVolumesRef.current = data.map((b) => b.volume);
      applyIndicators(chartRef.current, candleSeriesRef.current, rawCandlesRef.current, rawVolumesRef.current, indicators, indicatorSeriesRef);
      return;
    }
    isScrollLoadRef.current = false;

    // Clean up old chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (!chartContainerRef.current) return;

      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
        },
        grid: {
          vertLines: { color: "#1f2937" },
          horzLines: { color: "#1f2937" },
        },
        crosshair: {
          mode: 0, // Normal mode
        },
        timeScale: {
          borderColor: "#374151",
          timeVisible: interval !== "1d",
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: "#374151",
        },
      });

      // Candlestick series
      const candleSeries = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderDownColor: "#ef4444",
        borderUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        wickUpColor: "#22c55e",
      });

      // Volume series
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      candleSeries.setData(candleData as any);
      volumeSeries.setData(volumeData as any);
      chart.timeScale().fitContent();

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      rawCandlesRef.current = candleData as CandleData[];
      rawVolumesRef.current = data.map((b) => b.volume);

      // Apply indicators
      applyIndicators(chart, candleSeries, rawCandlesRef.current, rawVolumesRef.current, indicators, indicatorSeriesRef);

      // Infinite scroll: detect when user scrolls near the left edge
      chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange: any) => {
        if (logicalRange && logicalRange.from < 10) {
          loadOlderDataRef.current?.();
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

      return () => {
        window.removeEventListener("resize", handleResize);
      };
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, interval]);

  // Re-apply indicators when config changes
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || rawCandlesRef.current.length === 0) return;
    applyIndicators(chartRef.current, candleSeriesRef.current, rawCandlesRef.current, rawVolumesRef.current, indicators, indicatorSeriesRef);
  }, [indicators]);

  if (!symbol) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-muted-foreground">No instrument selected</p>
        <Button variant="outline" asChild>
          <Link href="/market-data">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Market Data
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/market-data">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {exchange}:{symbol}
            </h1>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              {replayMode ? "Replay Mode" : "OHLCV Chart"}
              {!replayMode && interval !== "1d" && data.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-green-500">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  Live
                </span>
              )}
            </p>
          </div>
        </div>
        {!replayMode && data.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={enterReplay}
            className="text-purple-600 border-purple-500/50 hover:bg-purple-500/10"
          >
            <Play className="h-4 w-4 mr-2" />
            Replay
          </Button>
        )}
      </div>

      {/* Controls — normal mode */}
      {!replayMode && (
        <div className="flex items-center gap-4 flex-shrink-0 flex-wrap">
          {/* Interval buttons */}
          <div className="flex items-center gap-1">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setInterval(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  interval === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Indicators button */}
          <div className="relative">
            <button
              onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                showIndicatorPanel || activeCount > 0
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
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

          <div className="flex items-center gap-2">
            <Label htmlFor="from" className="text-sm whitespace-nowrap">From</Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="to" className="text-sm whitespace-nowrap">To</Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40 h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* Controls — replay mode */}
      {replayMode && (
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={togglePlay}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          {/* Step forward */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={stepForward}
            disabled={isPlaying || replayIndex >= data.length - 1}
          >
            <SkipForward className="h-4 w-4" />
          </Button>

          {/* Reset */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={resetReplay}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Speed buttons */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Speed:</span>
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setReplaySpeed(s)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  replaySpeed === s
                    ? "bg-purple-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Progress slider */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input
              type="range"
              min={0}
              max={Math.max(data.length - 1, 0)}
              value={replayIndex}
              onChange={handleSeek}
              className="flex-1 h-1.5 accent-purple-600 cursor-pointer"
            />
            <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
              {replayIndex + 1} / {data.length}
            </span>
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Exit replay */}
          <Button
            variant="ghost"
            size="sm"
            onClick={exitReplay}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Exit Replay
          </Button>
        </div>
      )}

      {/* Fetch status message */}
      {fetchMsg && !replayMode && (
        <div className="text-sm text-muted-foreground flex-shrink-0">{fetchMsg}</div>
      )}

      {/* Chart area */}
      <div className="flex-1 min-h-0 rounded-lg border bg-card relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              {fetchMsg && <p className="text-sm text-muted-foreground">{fetchMsg}</p>}
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">{error}</p>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full min-h-[400px]" />
      </div>
    </div>
  );
}
