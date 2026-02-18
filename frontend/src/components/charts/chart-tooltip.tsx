"use client";

import { useEffect, useState, useRef } from "react";

interface OHLCVData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * ChartTooltip — fixed legend at top-left of the chart container that updates
 * on crosshair move.  Shows O / H / L / C / V and % change from open.
 *
 * Usage:
 *   <div style={{ position: "relative" }}>
 *     <ChartTooltip chart={chart} candleSeries={candleSeries} volumeSeries={volumeSeries} />
 *     <div ref={chartContainerRef} className="w-full h-full" />
 *   </div>
 */
export function ChartTooltip({
  chart,
  candleSeries,
  volumeSeries,
}: {
  chart: any;
  candleSeries: any;
  volumeSeries?: any;
}) {
  const [data, setData] = useState<OHLCVData | null>(null);
  const candleRef = useRef<any>(candleSeries);
  const volumeRef = useRef<any>(volumeSeries);

  useEffect(() => { candleRef.current = candleSeries; }, [candleSeries]);
  useEffect(() => { volumeRef.current = volumeSeries; }, [volumeSeries]);

  useEffect(() => {
    if (!chart) return;

    const handler = (param: any) => {
      if (!param.time || !param.seriesData) {
        setData(null);
        return;
      }

      const candle = candleRef.current
        ? param.seriesData.get(candleRef.current)
        : null;
      const vol = volumeRef.current
        ? param.seriesData.get(volumeRef.current)
        : null;

      if (!candle) {
        setData(null);
        return;
      }

      // Format time
      let timeStr = "";
      if (typeof param.time === "object") {
        // { year, month, day }
        const t = param.time as { year: number; month: number; day: number };
        timeStr = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
      } else if (typeof param.time === "number") {
        // Unix timestamp (UTC seconds) — convert to IST
        const d = new Date((param.time - 19800) * 1000); // remove IST offset we added
        const day = String(d.getUTCDate()).padStart(2, "0");
        const mon = String(d.getUTCMonth() + 1).padStart(2, "0");
        const hr = String(d.getUTCHours()).padStart(2, "0");
        const min = String(d.getUTCMinutes()).padStart(2, "0");
        timeStr = `${day}/${mon} ${hr}:${min}`;
      } else {
        timeStr = String(param.time);
      }

      setData({
        time: timeStr,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: vol?.value ?? undefined,
      });
    };

    chart.subscribeCrosshairMove(handler);
    return () => {
      try { chart.unsubscribeCrosshairMove(handler); } catch {}
    };
  }, [chart]);

  if (!data) return null;

  const change = data.open !== 0 ? ((data.close - data.open) / data.open) * 100 : 0;
  const isUp = data.close >= data.open;

  const fmt = (v: number) => v.toFixed(2);
  const fmtVol = (v: number) => {
    if (v >= 1_00_00_000) return (v / 1_00_00_000).toFixed(2) + " Cr";
    if (v >= 1_00_000) return (v / 1_00_000).toFixed(2) + " L";
    if (v >= 1000) return (v / 1000).toFixed(1) + " K";
    return v.toFixed(0);
  };

  return (
    <div className="absolute top-1 left-1 z-20 pointer-events-none flex items-center gap-2 text-[11px] font-mono px-1.5 py-0.5 rounded bg-background/80 backdrop-blur-sm border border-border/50">
      <span className="text-muted-foreground">{data.time}</span>
      <span className="text-muted-foreground">O</span>
      <span className={isUp ? "text-green-500" : "text-red-500"}>{fmt(data.open)}</span>
      <span className="text-muted-foreground">H</span>
      <span className={isUp ? "text-green-500" : "text-red-500"}>{fmt(data.high)}</span>
      <span className="text-muted-foreground">L</span>
      <span className={isUp ? "text-green-500" : "text-red-500"}>{fmt(data.low)}</span>
      <span className="text-muted-foreground">C</span>
      <span className={isUp ? "text-green-500" : "text-red-500"}>{fmt(data.close)}</span>
      <span className={isUp ? "text-green-500" : "text-red-500"}>
        ({change >= 0 ? "+" : ""}{change.toFixed(2)}%)
      </span>
      {data.volume !== undefined && (
        <>
          <span className="text-muted-foreground">V</span>
          <span className="text-blue-400">{fmtVol(data.volume)}</span>
        </>
      )}
    </div>
  );
}
