"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Loader2, AlertTriangle, Download } from "lucide-react";
import type { SessionRun, TradingTrade } from "@/types/trading";

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------
function KeyMetric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "green" | "red";
}) {
  return (
    <div className="bg-card border rounded-lg p-3">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-lg font-bold",
          color === "green"
            ? "text-green-500"
            : color === "red"
            ? "text-red-500"
            : ""
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red";
}) {
  return (
    <div className="bg-card border rounded-lg p-3 text-center">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-base font-bold",
          color === "green"
            ? "text-green-500"
            : color === "red"
            ? "text-red-500"
            : ""
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compute detailed trade stats (All / Long / Short breakdown)
// ---------------------------------------------------------------------------
function computeDetailedStats(trades: TradingTrade[], initialCapital: number) {
  const all = trades.filter((t) => t.net_pnl != null);
  const longTrades = all.filter((t) => t.side === "LONG" || t.side === "BUY");
  const shortTrades = all.filter((t) => t.side === "SHORT" || t.side === "SELL");

  function analyze(list: TradingTrade[]) {
    if (list.length === 0) {
      return {
        total: 0, winners: 0, losers: 0, openTrades: 0, winRate: 0,
        grossProfit: 0, grossLoss: 0, netProfit: 0, profitFactor: 0,
        avgTrade: 0, avgWin: 0, avgLoss: 0,
        largestWin: 0, largestLoss: 0,
        maxConsecWins: 0, maxConsecLosses: 0, totalCharges: 0,
        expectedPayoff: 0, ratioAvgWinLoss: 0,
        largestWinPctOfGross: 0, largestLossPctOfGross: 0,
      };
    }

    const wins = list.filter((t) => (t.net_pnl ?? 0) > 0);
    const losses = list.filter((t) => (t.net_pnl ?? 0) < 0);
    const grossProfit = wins.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.net_pnl ?? 0), 0));
    const netProfit = list.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
    const totalCharges = list.reduce((s, t) => s + (t.charges ?? 0), 0);

    let maxW = 0, maxL = 0, curW = 0, curL = 0;
    for (const t of list) {
      if ((t.net_pnl ?? 0) > 0) { curW++; curL = 0; maxW = Math.max(maxW, curW); }
      else if ((t.net_pnl ?? 0) < 0) { curL++; curW = 0; maxL = Math.max(maxL, curL); }
      else { curW = 0; curL = 0; }
    }

    const pnls = list.map((t) => t.net_pnl ?? 0);
    const winPnls = wins.map((t) => t.net_pnl ?? 0);
    const lossPnls = losses.map((t) => t.net_pnl ?? 0);

    const avgWin = winPnls.length > 0 ? grossProfit / winPnls.length : 0;
    const avgLossVal = lossPnls.length > 0 ? -grossLoss / lossPnls.length : 0;
    const winRateVal = list.length > 0 ? (wins.length / list.length) * 100 : 0;
    const lWin = winPnls.length > 0 ? Math.max(...winPnls) : 0;
    const lLoss = lossPnls.length > 0 ? Math.min(...lossPnls) : 0;

    return {
      total: list.length,
      winners: wins.length,
      losers: losses.length,
      openTrades: list.filter((t) => t.exit_price == null).length,
      winRate: winRateVal,
      grossProfit,
      grossLoss,
      netProfit,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9999 : 0,
      avgTrade: pnls.length > 0 ? netProfit / pnls.length : 0,
      avgWin,
      avgLoss: avgLossVal,
      largestWin: lWin,
      largestLoss: lLoss,
      maxConsecWins: maxW,
      maxConsecLosses: maxL,
      totalCharges,
      expectedPayoff: list.length > 0
        ? (winRateVal / 100) * avgWin + ((100 - winRateVal) / 100) * avgLossVal
        : 0,
      ratioAvgWinLoss: avgLossVal !== 0 ? avgWin / Math.abs(avgLossVal) : 0,
      largestWinPctOfGross: grossProfit > 0 ? (lWin / grossProfit) * 100 : 0,
      largestLossPctOfGross: grossLoss > 0 ? (Math.abs(lLoss) / grossLoss) * 100 : 0,
    };
  }

  return {
    all: analyze(all),
    long: analyze(longTrades),
    short: analyze(shortTrades),
  };
}

// ---------------------------------------------------------------------------
// Compute equity run-up / drawdown stats from equity curve
// ---------------------------------------------------------------------------
function computeEquityStats(
  equityCurve: { timestamp: string; equity: number }[],
  initialCapital: number
) {
  if (!equityCurve || equityCurve.length < 2) {
    return {
      maxRunUp: 0, maxRunUpPct: 0, avgRunUp: 0, avgRunUpPct: 0,
      maxDrawdownAmt: 0, maxDrawdownPct: 0, avgDrawdownAmt: 0, avgDrawdownPct: 0,
      maxRunUpDays: 0, avgRunUpDays: 0,
      maxDrawdownDays: 0, avgDrawdownDays: 0,
      maxRunUpPctOfCapital: 0, maxDrawdownPctOfCapital: 0,
      returnOfMaxDrawdown: 0,
    };
  }

  let peak = equityCurve[0].equity;
  let peakIdx = 0;
  let trough = equityCurve[0].equity;
  let troughIdx = 0;

  const drawdowns: { amount: number; pct: number; days: number }[] = [];
  const runups: { amount: number; pct: number; days: number }[] = [];
  let inDrawdown = false;

  for (let i = 1; i < equityCurve.length; i++) {
    const v = equityCurve[i].equity;
    if (v >= peak) {
      if (inDrawdown && peak > 0) {
        const ddAmt = peak - trough;
        const ddPct = (ddAmt / peak) * 100;
        const d0 = new Date(equityCurve[peakIdx].timestamp);
        const d1 = new Date(equityCurve[i].timestamp);
        const days = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86400000));
        drawdowns.push({ amount: ddAmt, pct: ddPct, days });
      }
      if (trough < v) {
        const ruAmt = v - trough;
        const ruPct = trough > 0 ? (ruAmt / trough) * 100 : 0;
        const d0 = new Date(equityCurve[troughIdx].timestamp);
        const d1 = new Date(equityCurve[i].timestamp);
        const days = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86400000));
        runups.push({ amount: ruAmt, pct: ruPct, days });
      }
      peak = v;
      peakIdx = i;
      trough = v;
      troughIdx = i;
      inDrawdown = false;
    } else {
      inDrawdown = true;
      if (v < trough) {
        trough = v;
        troughIdx = i;
      }
    }
  }
  if (inDrawdown && peak > 0) {
    const ddAmt = peak - trough;
    const ddPct = (ddAmt / peak) * 100;
    const d0 = new Date(equityCurve[peakIdx].timestamp);
    const d1 = new Date(equityCurve[equityCurve.length - 1].timestamp);
    const days = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86400000));
    drawdowns.push({ amount: ddAmt, pct: ddPct, days });
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const maxDD = drawdowns.length > 0 ? drawdowns.reduce((a, b) => a.amount > b.amount ? a : b) : null;
  const maxRU = runups.length > 0 ? runups.reduce((a, b) => a.amount > b.amount ? a : b) : null;

  return {
    maxRunUp: maxRU?.amount ?? 0,
    maxRunUpPct: maxRU?.pct ?? 0,
    avgRunUp: avg(runups.map((r) => r.amount)),
    avgRunUpPct: avg(runups.map((r) => r.pct)),
    maxDrawdownAmt: maxDD?.amount ?? 0,
    maxDrawdownPct: maxDD?.pct ?? 0,
    avgDrawdownAmt: avg(drawdowns.map((d) => d.amount)),
    avgDrawdownPct: avg(drawdowns.map((d) => d.pct)),
    maxRunUpDays: maxRU?.days ?? 0,
    avgRunUpDays: Math.round(avg(runups.map((r) => r.days))),
    maxDrawdownDays: maxDD?.days ?? 0,
    avgDrawdownDays: Math.round(avg(drawdowns.map((d) => d.days))),
    maxRunUpPctOfCapital: initialCapital > 0 ? ((maxRU?.amount ?? 0) / initialCapital) * 100 : 0,
    maxDrawdownPctOfCapital: initialCapital > 0 ? ((maxDD?.amount ?? 0) / initialCapital) * 100 : 0,
    returnOfMaxDrawdown: maxDD && maxDD.amount > 0
      ? ((equityCurve[equityCurve.length - 1].equity - initialCapital) / maxDD.amount) * 100
      : 0,
  };
}

// ---------------------------------------------------------------------------
// SVG Chart Components
// ---------------------------------------------------------------------------

function ProfitStructureChart({
  grossProfit, grossLoss, commission, netPnl,
}: {
  grossProfit: number; grossLoss: number; commission: number; netPnl: number;
}) {
  const items = [
    { label: "Gross Profit", value: grossProfit, color: "#22c55e" },
    { label: "Commission", value: -commission, color: "#6b7280" },
    { label: "Gross Loss", value: -grossLoss, color: "#ef4444" },
    { label: "Net P&L", value: netPnl, color: "#3b82f6" },
  ];

  const maxAbs = Math.max(...items.map((d) => Math.abs(d.value)), 1);
  const barH = 28;
  const gap = 12;
  const labelW = 100;
  const valueW = 90;
  const chartW = 300;
  const totalW = labelW + chartW + valueW;
  const totalH = items.length * (barH + gap) - gap + 16;

  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${totalH}`} className="overflow-visible">
      {items.map((item, i) => {
        const y = i * (barH + gap) + 8;
        const barWidth = (Math.abs(item.value) / maxAbs) * (chartW / 2);
        const isPositive = item.value >= 0;
        const barX = labelW + chartW / 2 + (isPositive ? 0 : -barWidth);
        return (
          <g key={i}>
            <text x={labelW - 8} y={y + barH / 2 + 4} textAnchor="end" className="fill-muted-foreground" fontSize="12">{item.label}</text>
            <line x1={labelW + chartW / 2} y1={y} x2={labelW + chartW / 2} y2={y + barH} stroke="#374151" strokeWidth="1" />
            <rect x={barX} y={y + 4} width={barWidth} height={barH - 8} rx="3" fill={item.color} opacity="0.85" />
            <text x={labelW + chartW + 8} y={y + barH / 2 + 4} textAnchor="start" className="fill-foreground" fontSize="12" fontWeight="500">{formatCurrency(item.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({
  value, maxVal, label, color, formatFn,
}: {
  value: number; maxVal: number; label: string; color: string; formatFn?: (v: number) => string;
}) {
  const size = 100;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = maxVal > 0 ? Math.min(value / maxVal, 1) : 0;
  const dashLen = pct * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1f2937" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dashLen} ${circumference - dashLen}`} strokeDashoffset={circumference / 4} strokeLinecap="round" className="transition-all duration-500" />
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle" className="fill-foreground" fontSize="16" fontWeight="700">
          {formatFn ? formatFn(value) : value.toFixed(2)}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

function PnLHistogram({ trades }: { trades: TradingTrade[] }) {
  const pnls = trades.map((t) => t.net_pnl ?? 0).filter((p) => p !== 0);
  if (pnls.length === 0) {
    return <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No trade data</div>;
  }

  const minPnl = Math.min(...pnls);
  const maxPnl = Math.max(...pnls);
  const range = maxPnl - minPnl || 1;
  const bucketCount = Math.min(20, Math.max(5, Math.ceil(pnls.length / 3)));
  const bucketSize = range / bucketCount;
  const buckets: { min: number; max: number; count: number; isPositive: boolean }[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const bMin = minPnl + i * bucketSize;
    const bMax = bMin + bucketSize;
    buckets.push({
      min: bMin, max: bMax,
      count: pnls.filter((p) => p >= bMin && (i === bucketCount - 1 ? p <= bMax : p < bMax)).length,
      isPositive: bMin + bucketSize / 2 >= 0,
    });
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const chartH = 140;
  const chartW = 400;
  const barW = (chartW - 40) / bucketCount - 2;
  const marginL = 30;
  const marginB = 20;

  return (
    <svg width="100%" viewBox={`0 0 ${chartW} ${chartH + marginB}`} className="overflow-visible">
      <line x1={marginL} y1={0} x2={marginL} y2={chartH} stroke="#374151" strokeWidth="1" />
      <line x1={marginL} y1={chartH} x2={chartW} y2={chartH} stroke="#374151" strokeWidth="1" />
      {buckets.map((b, i) => {
        const barH = (b.count / maxCount) * (chartH - 10);
        const x = marginL + 4 + i * (barW + 2);
        const y = chartH - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="2" fill={b.isPositive ? "#22c55e" : "#ef4444"} opacity="0.8" />
            {b.count > 0 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="9" className="fill-muted-foreground">{b.count}</text>
            )}
          </g>
        );
      })}
      <text x={marginL + 4} y={chartH + 14} fontSize="9" className="fill-muted-foreground">{formatCurrency(minPnl)}</text>
      <text x={chartW - 4} y={chartH + 14} textAnchor="end" fontSize="9" className="fill-muted-foreground">{formatCurrency(maxPnl)}</text>
    </svg>
  );
}

function WinLossDonut({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  if (total === 0) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No trades</div>;
  }
  const winPct = wins / total;
  const size = 120;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const winDash = winPct * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ef4444" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#22c55e" strokeWidth={stroke}
          strokeDasharray={`${winDash} ${circumference - winDash}`} strokeDashoffset={circumference / 4} />
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="fill-foreground" fontSize="18" fontWeight="700">
          {(winPct * 100).toFixed(1)}%
        </text>
        <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="10">Win Rate</text>
      </svg>
      <div className="flex gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> {wins} Wins</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> {losses} Losses</span>
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-6 pb-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function PerfRow({
  label, all, long: longVal, short: shortVal, format = "number", colorize = false, isSingle = false,
}: {
  label: string; all: number | string; long?: number | string; short?: number | string;
  format?: "currency" | "percent" | "number" | "integer" | "ratio"; colorize?: boolean; isSingle?: boolean;
}) {
  const fmt = (v: number | string) => {
    if (typeof v === "string") return v;
    if (format === "currency") return formatCurrency(v);
    if (format === "percent") return `${v.toFixed(2)}%`;
    if (format === "integer") return String(Math.round(v));
    if (format === "ratio") return v.toFixed(2);
    return v.toFixed(2);
  };

  const colorFor = (v: number | string) => {
    if (!colorize || typeof v === "string") return "";
    const n = Number(v);
    if (n > 0) return "text-green-500";
    if (n < 0) return "text-red-500";
    return "";
  };

  return (
    <div className="grid grid-cols-4 py-1.5 text-[13px] border-b border-border/30 hover:bg-accent/20">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("text-right font-medium", colorFor(all))}>{fmt(all)}</div>
      {isSingle ? (
        <div className="col-span-2" />
      ) : (
        <>
          <div className={cn("text-right font-medium", colorFor(longVal ?? 0))}>{fmt(longVal ?? 0)}</div>
          <div className={cn("text-right font-medium", colorFor(shortVal ?? 0))}>{fmt(shortVal ?? 0)}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunReport Component
// ---------------------------------------------------------------------------
export default function RunReport({
  sessionId,
  runId,
  backPath,
}: {
  sessionId: string;
  runId: string;
  backPath: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState<SessionRun | null>(null);
  const [trades, setTrades] = useState<TradingTrade[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "performance" | "trades" | "logs"
  >("overview");

  const equityChartRef = useRef<HTMLDivElement>(null);
  const drawdownChartRef = useRef<HTMLDivElement>(null);

  // Fetch run details
  useEffect(() => {
    const fetchRun = async () => {
      setLoading(true);
      try {
        const [runRes, tradesRes, logsRes] = await Promise.all([
          apiClient.get(
            `/trading/sessions/${sessionId}/runs/${runId}`
          ),
          apiClient.get(
            `/trading/sessions/${sessionId}/runs/${runId}/trades`
          ),
          apiClient.get(
            `/trading/sessions/${sessionId}/runs/${runId}/logs`
          ),
        ]);
        setRun(runRes.data);
        setTrades(tradesRes.data);
        setLogs(logsRes.data);
      } catch (err: any) {
        setError(
          err?.response?.data?.detail || "Failed to load run report"
        );
      } finally {
        setLoading(false);
      }
    };
    fetchRun();
  }, [sessionId, runId]);

  // Render equity + drawdown charts
  useEffect(() => {
    if (!run?.equity_curve?.length || activeTab !== "overview") return;

    let equityChart: any = null;
    let ddChart: any = null;

    const renderCharts = async () => {
      const { createChart, LineType, ColorType } = await import(
        "lightweight-charts"
      );

      // --- Equity Curve ---
      if (equityChartRef.current) {
        equityChartRef.current.innerHTML = "";
        equityChart = createChart(equityChartRef.current, {
          width: equityChartRef.current.clientWidth,
          height: 280,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#9ca3af",
            fontSize: 11,
          },
          grid: {
            vertLines: { color: "rgba(156,163,175,0.08)" },
            horzLines: { color: "rgba(156,163,175,0.08)" },
          },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true },
          crosshair: {
            horzLine: { visible: true, labelVisible: true },
            vertLine: { visible: true, labelVisible: true },
          },
        });

        const equityData = run.equity_curve!.map((pt) => ({
          time: (new Date(pt.timestamp).getTime() / 1000) as any,
          value: pt.equity,
        }));

        const series = equityChart.addAreaSeries({
          lineColor: "#3b82f6",
          topColor: "rgba(59,130,246,0.25)",
          bottomColor: "rgba(59,130,246,0.02)",
          lineWidth: 2,
          lineType: LineType.Curved,
        });
        series.setData(equityData);

        // Initial capital reference line
        const initialLine = equityChart.addLineSeries({
          color: "rgba(156,163,175,0.4)",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        if (equityData.length >= 2) {
          initialLine.setData([
            { time: equityData[0].time, value: run.initial_capital },
            {
              time: equityData[equityData.length - 1].time,
              value: run.initial_capital,
            },
          ]);
        }

        equityChart.timeScale().fitContent();
      }

      // --- Drawdown Curve ---
      if (
        drawdownChartRef.current &&
        run.drawdown_curve?.length
      ) {
        drawdownChartRef.current.innerHTML = "";
        ddChart = createChart(drawdownChartRef.current, {
          width: drawdownChartRef.current.clientWidth,
          height: 180,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#9ca3af",
            fontSize: 11,
          },
          grid: {
            vertLines: { color: "rgba(156,163,175,0.08)" },
            horzLines: { color: "rgba(156,163,175,0.08)" },
          },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true },
        });

        const ddData = run.drawdown_curve!.map((pt) => ({
          time: (new Date(pt.timestamp).getTime() / 1000) as any,
          value: pt.drawdown_percent,
        }));

        const ddSeries = ddChart.addAreaSeries({
          lineColor: "#ef4444",
          topColor: "rgba(239,68,68,0.02)",
          bottomColor: "rgba(239,68,68,0.2)",
          lineWidth: 2,
          lineType: LineType.Curved,
          invertFilledArea: true,
        });
        ddSeries.setData(ddData);
        ddChart.timeScale().fitContent();
      }
    };

    renderCharts();

    const handleResize = () => {
      if (equityChart && equityChartRef.current) {
        equityChart.applyOptions({
          width: equityChartRef.current.clientWidth,
        });
      }
      if (ddChart && drawdownChartRef.current) {
        ddChart.applyOptions({
          width: drawdownChartRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      equityChart?.remove();
      ddChart?.remove();
    };
  }, [run, activeTab]);

  const stats = useMemo(
    () => computeDetailedStats(trades, run?.initial_capital ?? 100000),
    [trades, run?.initial_capital]
  );

  const eqStats = useMemo(
    () => computeEquityStats(run?.equity_curve ?? [], run?.initial_capital ?? 100000),
    [run?.equity_curve, run?.initial_capital]
  );

  const netPnl = run
    ? (run.final_capital ?? run.initial_capital) - run.initial_capital
    : 0;

  // CSV export
  const exportCSV = () => {
    if (!trades.length) return;
    const headers = [
      "Trade #",
      "Side",
      "Symbol",
      "Entry Time",
      "Exit Time",
      "Entry Price",
      "Exit Price",
      "Qty",
      "P&L",
      "P&L %",
      "Charges",
      "Net P&L",
    ];
    const rows = trades.map((t, i) => [
      i + 1,
      t.side,
      t.tradingsymbol,
      t.entry_at,
      t.exit_at || "",
      t.entry_price,
      t.exit_price ?? "",
      t.quantity,
      t.pnl ?? "",
      t.pnl_percent ?? "",
      t.charges,
      t.net_pnl ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${run?.run_number ?? runId}-trades.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push(backPath)}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </button>
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          {error || "Run not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(backPath)}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </button>
          <h1 className="text-xl font-bold">
            Run #{run.run_number} Report
          </h1>
          <span
            className={cn(
              "px-2 py-0.5 rounded text-xs font-semibold",
              run.status === "completed"
                ? "bg-green-100 text-green-800"
                : run.status === "running"
                ? "bg-blue-100 text-blue-800"
                : "bg-red-100 text-red-800"
            )}
          >
            {run.status}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(run.started_at).toLocaleString("en-IN")}
          {run.stopped_at &&
            ` — ${new Date(run.stopped_at).toLocaleString("en-IN")}`}
        </div>
      </div>

      {/* Error banner */}
      {run.error_message && (
        <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          {run.error_message}
        </div>
      )}

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KeyMetric
          label="Net Profit"
          value={formatCurrency(netPnl)}
          sub={
            run.total_return != null
              ? `${formatPercent(run.total_return * 100)}`
              : ""
          }
          color={netPnl >= 0 ? "green" : "red"}
        />
        <KeyMetric
          label="Total Trades"
          value={String(run.total_trades ?? 0)}
          sub={`${stats.all.winners}W / ${stats.all.losers}L`}
        />
        <KeyMetric
          label="Win Rate"
          value={
            run.win_rate != null
              ? `${(run.win_rate * 100).toFixed(1)}%`
              : "—"
          }
          color={
            run.win_rate != null && run.win_rate >= 0.5
              ? "green"
              : "red"
          }
        />
        <KeyMetric
          label="Profit Factor"
          value={
            run.profit_factor != null
              ? run.profit_factor.toFixed(2)
              : "—"
          }
          color={
            run.profit_factor != null && run.profit_factor >= 1
              ? "green"
              : "red"
          }
        />
        <KeyMetric
          label="Max Drawdown"
          value={
            run.max_drawdown != null
              ? `${(Math.abs(run.max_drawdown) * 100).toFixed(2)}%`
              : "—"
          }
          color="red"
        />
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4">
          {(["overview", "performance", "trades", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "pb-3 text-sm font-medium border-b-2 transition-colors capitalize",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "overview"
                ? "Overview"
                : tab === "performance"
                ? "Performance"
                : tab === "trades"
                ? `Trade Log (${trades.length})`
                : `Logs (${logs.length})`}
            </button>
          ))}
        </nav>
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="CAGR"
              value={
                run.cagr != null
                  ? `${(run.cagr * 100).toFixed(2)}%`
                  : "—"
              }
              color={
                run.cagr != null
                  ? run.cagr >= 0
                    ? "green"
                    : "red"
                  : undefined
              }
            />
            <SummaryCard
              label="Sharpe Ratio"
              value={
                run.sharpe_ratio != null
                  ? run.sharpe_ratio.toFixed(2)
                  : "—"
              }
              color={
                run.sharpe_ratio != null
                  ? run.sharpe_ratio >= 1
                    ? "green"
                    : "red"
                  : undefined
              }
            />
            <SummaryCard
              label="Sortino Ratio"
              value={
                run.sortino_ratio != null
                  ? run.sortino_ratio.toFixed(2)
                  : "—"
              }
              color={
                run.sortino_ratio != null
                  ? run.sortino_ratio >= 1
                    ? "green"
                    : "red"
                  : undefined
              }
            />
            <SummaryCard
              label="Avg Trade P&L"
              value={
                run.avg_trade_pnl != null
                  ? formatCurrency(run.avg_trade_pnl)
                  : "—"
              }
              color={
                run.avg_trade_pnl != null
                  ? run.avg_trade_pnl >= 0
                    ? "green"
                    : "red"
                  : undefined
              }
            />
          </div>

          {/* Equity Curve */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Equity Curve</CardTitle>
            </CardHeader>
            <CardContent>
              {run.equity_curve?.length ? (
                <div ref={equityChartRef} />
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                  No equity curve data
                </div>
              )}
            </CardContent>
          </Card>

          {/* Drawdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Drawdown</CardTitle>
            </CardHeader>
            <CardContent>
              {run.drawdown_curve?.length ? (
                <div ref={drawdownChartRef} />
              ) : (
                <div className="h-[180px] flex items-center justify-center text-muted-foreground">
                  No drawdown data
                </div>
              )}
            </CardContent>
          </Card>

          {/* Capital summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Capital Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">
                    Initial Capital
                  </span>
                  <div className="font-medium">
                    {formatCurrency(run.initial_capital)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Final Capital
                  </span>
                  <div className="font-medium">
                    {formatCurrency(
                      run.final_capital ?? run.initial_capital
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Gross Profit
                  </span>
                  <div className="font-medium text-green-500">
                    {formatCurrency(stats.all.grossProfit)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Gross Loss
                  </span>
                  <div className="font-medium text-red-500">
                    {formatCurrency(-stats.all.grossLoss)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* PERFORMANCE TAB */}
      {activeTab === "performance" && (
        <div className="space-y-1">
          {/* Performance */}
          <SectionHeader title="Performance" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Profit Structure</CardTitle>
              </CardHeader>
              <CardContent>
                <ProfitStructureChart
                  grossProfit={stats.all.grossProfit}
                  grossLoss={stats.all.grossLoss}
                  commission={stats.all.totalCharges}
                  netPnl={stats.all.netProfit}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Benchmarking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-around py-2">
                  <DonutChart value={stats.all.winRate} maxVal={100} label="% Profitable" color="#22c55e" formatFn={(v) => `${v.toFixed(1)}%`} />
                  <DonutChart value={stats.all.ratioAvgWinLoss} maxVal={Math.max(stats.all.ratioAvgWinLoss * 1.5, 3)} label="Avg Win / Avg Loss" color="#3b82f6" formatFn={(v) => v.toFixed(2)} />
                  <DonutChart value={run.sharpe_ratio ?? 0} maxVal={Math.max(Math.abs(run.sharpe_ratio ?? 0) * 2, 3)} label="Sharpe Ratio" color="#a855f7" formatFn={(v) => v.toFixed(2)} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Returns */}
          <SectionHeader title="Returns" />
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div></div>
                <div className="text-right">All Trades</div>
                <div className="text-right">Long Trades</div>
                <div className="text-right">Short Trades</div>
              </div>
              <PerfRow label="Initial Capital" all={run.initial_capital} long={run.initial_capital} short={run.initial_capital} format="currency" />
              <PerfRow label="Net P&L" all={stats.all.netProfit} long={stats.long.netProfit} short={stats.short.netProfit} format="currency" colorize />
              <PerfRow
                label="Net P&L %"
                all={run.initial_capital > 0 ? (stats.all.netProfit / run.initial_capital) * 100 : 0}
                long={run.initial_capital > 0 ? (stats.long.netProfit / run.initial_capital) * 100 : 0}
                short={run.initial_capital > 0 ? (stats.short.netProfit / run.initial_capital) * 100 : 0}
                format="percent" colorize
              />
              <PerfRow label="Gross Profit" all={stats.all.grossProfit} long={stats.long.grossProfit} short={stats.short.grossProfit} format="currency" colorize />
              <PerfRow label="Gross Loss" all={-stats.all.grossLoss} long={-stats.long.grossLoss} short={-stats.short.grossLoss} format="currency" colorize />
              <PerfRow label="Profit Factor" all={stats.all.profitFactor} long={stats.long.profitFactor} short={stats.short.profitFactor} format="ratio" />
              <PerfRow label="Commission Paid" all={stats.all.totalCharges} long={stats.long.totalCharges} short={stats.short.totalCharges} format="currency" />
              <PerfRow label="Expected Payoff" all={stats.all.expectedPayoff} long={stats.long.expectedPayoff} short={stats.short.expectedPayoff} format="currency" colorize />
            </CardContent>
          </Card>

          {/* Risk-Adjusted Performance */}
          <SectionHeader title="Risk-Adjusted Performance" />
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div></div>
                <div className="text-right">Value</div>
                <div className="text-right" />
                <div className="text-right" />
              </div>
              <PerfRow label="Sharpe Ratio" all={run.sharpe_ratio ?? 0} format="ratio" isSingle />
              <PerfRow label="Sortino Ratio" all={run.sortino_ratio ?? 0} format="ratio" isSingle />
              <PerfRow label="Max Drawdown %" all={run.max_drawdown != null ? Math.abs(run.max_drawdown) * 100 : 0} format="percent" isSingle />
              <PerfRow label="Max Drawdown Amount" all={eqStats.maxDrawdownAmt} format="currency" isSingle />
            </CardContent>
          </Card>

          {/* Trades Analysis */}
          <SectionHeader title="Trades Analysis" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">P&L Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <PnLHistogram trades={trades} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Win / Loss Ratio</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-4">
                <WinLossDonut wins={stats.all.winners} losses={stats.all.losers} />
              </CardContent>
            </Card>
          </div>

          {/* Details table */}
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div></div>
                <div className="text-right">All Trades</div>
                <div className="text-right">Long Trades</div>
                <div className="text-right">Short Trades</div>
              </div>
              <PerfRow label="Total Trades" all={stats.all.total} long={stats.long.total} short={stats.short.total} format="integer" />
              <PerfRow label="Total Open Trades" all={stats.all.openTrades} long={stats.long.openTrades} short={stats.short.openTrades} format="integer" />
              <PerfRow label="Winning Trades" all={stats.all.winners} long={stats.long.winners} short={stats.short.winners} format="integer" />
              <PerfRow label="Losing Trades" all={stats.all.losers} long={stats.long.losers} short={stats.short.losers} format="integer" />
              <PerfRow label="Percent Profitable" all={stats.all.winRate} long={stats.long.winRate} short={stats.short.winRate} format="percent" />
              <PerfRow label="Avg P&L" all={stats.all.avgTrade} long={stats.long.avgTrade} short={stats.short.avgTrade} format="currency" colorize />
              <PerfRow label="Avg Winning Trade" all={stats.all.avgWin} long={stats.long.avgWin} short={stats.short.avgWin} format="currency" colorize />
              <PerfRow label="Avg Losing Trade" all={stats.all.avgLoss} long={stats.long.avgLoss} short={stats.short.avgLoss} format="currency" colorize />
              <PerfRow label="Ratio Avg Win / Avg Loss" all={stats.all.ratioAvgWinLoss} long={stats.long.ratioAvgWinLoss} short={stats.short.ratioAvgWinLoss} format="ratio" />
              <PerfRow label="Largest Winning Trade" all={stats.all.largestWin} long={stats.long.largestWin} short={stats.short.largestWin} format="currency" colorize />
              <PerfRow label="Largest Losing Trade" all={stats.all.largestLoss} long={stats.long.largestLoss} short={stats.short.largestLoss} format="currency" colorize />
              <PerfRow label="Largest Winner % of Gross Profit" all={stats.all.largestWinPctOfGross} long={stats.long.largestWinPctOfGross} short={stats.short.largestWinPctOfGross} format="percent" />
              <PerfRow label="Largest Loser % of Gross Loss" all={stats.all.largestLossPctOfGross} long={stats.long.largestLossPctOfGross} short={stats.short.largestLossPctOfGross} format="percent" />
              <PerfRow label="Max Consecutive Wins" all={stats.all.maxConsecWins} long={stats.long.maxConsecWins} short={stats.short.maxConsecWins} format="integer" />
              <PerfRow label="Max Consecutive Losses" all={stats.all.maxConsecLosses} long={stats.long.maxConsecLosses} short={stats.short.maxConsecLosses} format="integer" />
            </CardContent>
          </Card>

          {/* Capital Efficiency */}
          <SectionHeader title="Capital Efficiency" />
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div></div>
                <div className="text-right">Value</div>
                <div className="text-right" />
                <div className="text-right" />
              </div>
              <PerfRow label="Annualized Return (CAGR)" all={run.cagr != null ? run.cagr * 100 : 0} format="percent" colorize isSingle />
              <PerfRow label="Return on Initial Capital" all={run.initial_capital > 0 ? (stats.all.netProfit / run.initial_capital) * 100 : 0} format="percent" colorize isSingle />
              <PerfRow label="Account Size Required" all={run.initial_capital + eqStats.maxDrawdownAmt} format="currency" isSingle />
              <PerfRow label="Net Profit as % of Largest Loss" all={stats.all.largestLoss !== 0 ? (stats.all.netProfit / Math.abs(stats.all.largestLoss)) * 100 : 0} format="percent" colorize isSingle />
            </CardContent>
          </Card>

          {/* Run-ups and Drawdowns */}
          <SectionHeader title="Run-ups and Drawdowns" />
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div></div>
                <div className="text-right">Value</div>
                <div className="text-right" />
                <div className="text-right" />
              </div>
              <PerfRow label="Max Equity Run-up" all={eqStats.maxRunUp} format="currency" colorize isSingle />
              <PerfRow label="Max Equity Run-up %" all={eqStats.maxRunUpPct} format="percent" isSingle />
              <PerfRow label="Max Equity Run-up Duration" all={`${eqStats.maxRunUpDays} days`} isSingle />
              <PerfRow label="Avg Equity Run-up" all={eqStats.avgRunUp} format="currency" isSingle />
              <PerfRow label="Avg Equity Run-up Duration" all={`${eqStats.avgRunUpDays} days`} isSingle />
              <PerfRow label="Max Run-up as % of Capital" all={eqStats.maxRunUpPctOfCapital} format="percent" isSingle />

              <div className="h-3" />

              <PerfRow label="Max Equity Drawdown" all={-eqStats.maxDrawdownAmt} format="currency" colorize isSingle />
              <PerfRow label="Max Equity Drawdown %" all={-eqStats.maxDrawdownPct} format="percent" colorize isSingle />
              <PerfRow label="Max Equity Drawdown Duration" all={`${eqStats.maxDrawdownDays} days`} isSingle />
              <PerfRow label="Avg Equity Drawdown" all={-eqStats.avgDrawdownAmt} format="currency" colorize isSingle />
              <PerfRow label="Avg Equity Drawdown Duration" all={`${eqStats.avgDrawdownDays} days`} isSingle />
              <PerfRow label="Max Drawdown as % of Capital" all={-eqStats.maxDrawdownPctOfCapital} format="percent" colorize isSingle />
              <PerfRow label="Return / Max Drawdown" all={eqStats.returnOfMaxDrawdown} format="percent" colorize isSingle />
            </CardContent>
          </Card>
        </div>
      )}

      {/* TRADE LOG TAB */}
      {activeTab === "trades" && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Trade Log</CardTitle>
            {trades.length > 0 && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            )}
          </CardHeader>
          <CardContent>
            {trades.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                No trades recorded
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium w-24">
                        Trade #
                      </th>
                      <th className="pb-2 pr-4 font-medium w-16">
                        Type
                      </th>
                      <th className="pb-2 pr-4 font-medium">
                        Date and Time
                      </th>
                      <th className="pb-2 pr-4 font-medium">Signal</th>
                      <th className="pb-2 pr-4 font-medium text-right">
                        Price
                      </th>
                      <th className="pb-2 pr-4 font-medium text-right">
                        Qty
                      </th>
                      <th className="pb-2 pr-4 font-medium text-right">
                        Net P&L
                      </th>
                      <th className="pb-2 pr-4 font-medium text-right">
                        Charges
                      </th>
                      <th className="pb-2 font-medium text-right">
                        Cumulative P&L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totalTrades = trades.length;
                      const cumPnls: number[] = [];
                      let running = 0;
                      for (const t of trades) {
                        running += t.net_pnl ?? 0;
                        cumPnls.push(running);
                      }
                      const reversed = [...trades].reverse();
                      return reversed.map((t, i) => {
                        const origIdx = totalTrades - 1 - i;
                        const cumPnl = cumPnls[origIdx];
                        const tradeNum = totalTrades - i;
                        const isLong =
                          t.side === "LONG" || t.side === "BUY";
                        const isOpen = t.exit_price == null;
                        const cumPnlPct =
                          run.initial_capital > 0
                            ? (cumPnl / run.initial_capital) * 100
                            : 0;

                        return (
                          <React.Fragment key={i}>
                            {/* Exit row */}
                            <tr className="border-b border-border/30 hover:bg-accent/30">
                              <td
                                rowSpan={2}
                                className="py-2 pr-4 align-top"
                              >
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-muted-foreground font-medium">
                                    {tradeNum}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-xs font-semibold",
                                      isLong
                                        ? "text-green-500"
                                        : "text-red-500"
                                    )}
                                  >
                                    {isLong ? "Long" : "Short"}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">
                                Exit
                              </td>
                              <td className="py-2 pr-4 whitespace-nowrap">
                                {isOpen
                                  ? "—"
                                  : t.exit_at
                                  ? new Date(
                                      t.exit_at
                                    ).toLocaleString("en-IN", {
                                      month: "short",
                                      day: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    })
                                  : "—"}
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">
                                {isOpen
                                  ? "Open"
                                  : isLong
                                  ? "short"
                                  : "long"}
                              </td>
                              <td className="py-2 pr-4 text-right">
                                {t.exit_price != null
                                  ? formatCurrency(t.exit_price)
                                  : "—"}
                              </td>
                              <td
                                rowSpan={2}
                                className="py-2 pr-4 text-right align-middle"
                              >
                                {t.quantity}
                              </td>
                              <td
                                rowSpan={2}
                                className="py-2 pr-4 text-right align-middle"
                              >
                                <div
                                  className={cn(
                                    "font-medium",
                                    t.net_pnl != null
                                      ? t.net_pnl >= 0
                                        ? "text-green-500"
                                        : "text-red-500"
                                      : ""
                                  )}
                                >
                                  {t.net_pnl != null
                                    ? formatCurrency(t.net_pnl)
                                    : "—"}
                                </div>
                                {t.pnl_percent != null && (
                                  <div
                                    className={cn(
                                      "text-xs",
                                      t.pnl_percent >= 0
                                        ? "text-green-500"
                                        : "text-red-500"
                                    )}
                                  >
                                    {formatPercent(t.pnl_percent)}
                                  </div>
                                )}
                              </td>
                              <td
                                rowSpan={2}
                                className="py-2 pr-4 text-right align-middle text-muted-foreground"
                              >
                                {formatCurrency(t.charges)}
                              </td>
                              <td
                                rowSpan={2}
                                className="py-2 text-right align-middle"
                              >
                                <div
                                  className={cn(
                                    "font-medium",
                                    cumPnl >= 0
                                      ? "text-green-500"
                                      : "text-red-500"
                                  )}
                                >
                                  {formatCurrency(cumPnl)}
                                </div>
                                <div
                                  className={cn(
                                    "text-xs",
                                    cumPnlPct >= 0
                                      ? "text-green-500"
                                      : "text-red-500"
                                  )}
                                >
                                  {cumPnlPct >= 0 ? "+" : ""}
                                  {cumPnlPct.toFixed(2)}%
                                </div>
                              </td>
                            </tr>
                            {/* Entry row */}
                            <tr
                              className={cn(
                                "hover:bg-accent/30",
                                i < trades.length - 1
                                  ? "border-b border-border"
                                  : ""
                              )}
                            >
                              <td className="py-2 pr-4 text-muted-foreground">
                                Entry
                              </td>
                              <td className="py-2 pr-4 whitespace-nowrap">
                                {t.entry_at
                                  ? new Date(
                                      t.entry_at
                                    ).toLocaleString("en-IN", {
                                      month: "short",
                                      day: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    })
                                  : "—"}
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">
                                {isLong ? "long" : "short"}
                              </td>
                              <td className="py-2 pr-4 text-right">
                                {formatCurrency(t.entry_price)}
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* LOGS TAB */}
      {activeTab === "logs" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Session Logs ({logs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                No logs recorded
              </div>
            ) : (
              <div className="space-y-0.5 font-mono text-[11px] max-h-[500px] overflow-y-auto">
                {logs.map((log: any) => (
                  <div
                    key={log.id}
                    className={cn(
                      "px-2 py-1 rounded flex gap-2",
                      log.level === "ERROR"
                        ? "bg-red-500/10 text-red-400"
                        : log.level === "WARNING"
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "text-muted-foreground"
                    )}
                  >
                    <span className="text-[10px] opacity-60 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1 rounded shrink-0",
                        log.level === "ERROR"
                          ? "bg-red-500/20 text-red-400"
                          : log.level === "WARNING"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-blue-500/10 text-blue-400"
                      )}
                    >
                      {log.level}
                    </span>
                    <span className="text-[10px] px-1 rounded bg-accent/50 shrink-0">
                      {log.source}
                    </span>
                    <span className="break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
