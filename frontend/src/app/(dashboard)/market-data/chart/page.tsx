"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import apiClient from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

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

export default function ChartPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuthStore();

  const symbol = searchParams.get("symbol") || "";
  const exchange = searchParams.get("exchange") || "NSE";

  const [interval, setInterval] = useState("1d");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [data, setData] = useState<OHLCVBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/market-data/ohlcv", {
        params: {
          symbol,
          exchange,
          from_date: fromDate,
          to_date: toDate,
          interval,
        },
      });
      setData(res.data);
      if (res.data.length === 0) {
        setError("No data available for the selected date range. Try fetching historical data first.");
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load chart data");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange, fromDate, toDate, interval]);

  const handleFetchFromKite = async () => {
    setFetching(true);
    setFetchMsg(null);
    try {
      const kiteInterval = INTERVAL_TO_KITE[interval] || "day";
      const res = await apiClient.post("/admin/fetch-historical", {
        symbol,
        exchange,
        from_date: fromDate,
        to_date: toDate,
        interval: kiteInterval,
      });
      setFetchMsg(`Fetched ${res.data.count} records`);
      // Reload chart data
      await fetchData();
    } catch (err: any) {
      setFetchMsg(err.response?.data?.detail || "Failed to fetch from Kite");
    } finally {
      setFetching(false);
    }
  };

  // Fetch on mount and when params change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Render chart
  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

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

      // Transform data
      const candleData = data.map((bar) => {
        const dateStr = bar.time.slice(0, 10);
        return {
          time: dateStr,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        };
      });

      const volumeData = data.map((bar) => {
        const dateStr = bar.time.slice(0, 10);
        return {
          time: dateStr,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
        };
      });

      candleSeries.setData(candleData as any);
      volumeSeries.setData(volumeData as any);
      chart.timeScale().fitContent();

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;

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
            <p className="text-muted-foreground text-sm">
              OHLCV Chart
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
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

        {user?.is_superadmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleFetchFromKite}
            disabled={fetching}
            className="h-8"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            {fetching ? "Fetching..." : "Fetch from Kite"}
          </Button>
        )}
      </div>

      {/* Fetch status message */}
      {fetchMsg && (
        <div className="text-sm text-muted-foreground flex-shrink-0">{fetchMsg}</div>
      )}

      {/* Chart area */}
      <div className="flex-1 min-h-0 rounded-lg border bg-card relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <p className="text-muted-foreground text-sm">{error}</p>
            {user?.is_superadmin && (
              <Button
                onClick={handleFetchFromKite}
                disabled={fetching}
              >
                {fetching ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {fetching ? "Fetching from Kite..." : "Fetch Historical Data from Kite"}
              </Button>
            )}
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full min-h-[400px]" />
      </div>
    </div>
  );
}
