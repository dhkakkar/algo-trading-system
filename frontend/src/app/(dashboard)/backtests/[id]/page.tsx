"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useBacktestStore } from "@/stores/backtest-store";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Download,
  Settings2,
  Grid3X3,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BacktestTrade } from "@/types/backtest";
import {
  IndicatorConfig,
  DEFAULT_INDICATORS,
  CandleData,
  IndicatorPanel,
  applyIndicators,
} from "@/components/charts/chart-indicators";
import { DrawingToolbar } from "@/components/charts/drawing-tools";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

// ---------------------------------------------------------------------------
// Compute detailed trade statistics from the trades array (client-side)
// ---------------------------------------------------------------------------
function computeDetailedStats(trades: BacktestTrade[], initialCapital: number) {
  const all = trades.filter((t) => t.net_pnl != null);
  const longTrades = all.filter((t) => t.side === "LONG");
  const shortTrades = all.filter((t) => t.side === "SHORT");

  function analyze(list: BacktestTrade[]) {
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

    // Consecutive streaks
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
  equityCurve: { date: string; value: number }[],
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

  // Track drawdown periods
  let peak = equityCurve[0].value;
  let peakIdx = 0;
  let trough = equityCurve[0].value;
  let troughIdx = 0;

  const drawdowns: { amount: number; pct: number; days: number }[] = [];
  const runups: { amount: number; pct: number; days: number }[] = [];
  let inDrawdown = false;

  for (let i = 1; i < equityCurve.length; i++) {
    const v = equityCurve[i].value;
    if (v >= peak) {
      if (inDrawdown && peak > 0) {
        const ddAmt = peak - trough;
        const ddPct = (ddAmt / peak) * 100;
        const d0 = new Date(equityCurve[peakIdx].date);
        const d1 = new Date(equityCurve[i].date);
        const days = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86400000));
        drawdowns.push({ amount: ddAmt, pct: ddPct, days });
      }
      // Track run-up from last trough
      if (trough < v) {
        const ruAmt = v - trough;
        const ruPct = trough > 0 ? (ruAmt / trough) * 100 : 0;
        const d0 = new Date(equityCurve[troughIdx].date);
        const d1 = new Date(equityCurve[i].date);
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
  // Handle final drawdown if still in one
  if (inDrawdown && peak > 0) {
    const ddAmt = peak - trough;
    const ddPct = (ddAmt / peak) * 100;
    const d0 = new Date(equityCurve[peakIdx].date);
    const d1 = new Date(equityCurve[equityCurve.length - 1].date);
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
      ? ((equityCurve[equityCurve.length - 1].value - initialCapital) / maxDD.amount) * 100
      : 0,
  };
}

// ---------------------------------------------------------------------------
// SVG Chart Components
// ---------------------------------------------------------------------------

/** Horizontal bar chart for Profit Structure */
function ProfitStructureChart({
  grossProfit,
  grossLoss,
  commission,
  netPnl,
}: {
  grossProfit: number;
  grossLoss: number;
  commission: number;
  netPnl: number;
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
            <text x={labelW - 8} y={y + barH / 2 + 4} textAnchor="end" className="fill-muted-foreground" fontSize="12">
              {item.label}
            </text>
            {/* Center line */}
            <line x1={labelW + chartW / 2} y1={y} x2={labelW + chartW / 2} y2={y + barH} stroke="#374151" strokeWidth="1" />
            <rect x={barX} y={y + 4} width={barWidth} height={barH - 8} rx="3" fill={item.color} opacity="0.85" />
            <text x={labelW + chartW + 8} y={y + barH / 2 + 4} textAnchor="start" className="fill-foreground" fontSize="12" fontWeight="500">
              {formatCurrency(item.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Donut / Gauge chart */
function DonutChart({
  value,
  maxVal,
  label,
  color,
  formatFn,
}: {
  value: number;
  maxVal: number;
  label: string;
  color: string;
  formatFn?: (v: number) => string;
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
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#1f2937" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dashLen} ${circumference - dashLen}`}
          strokeDashoffset={circumference / 4}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle" className="fill-foreground" fontSize="16" fontWeight="700">
          {formatFn ? formatFn(value) : value.toFixed(2)}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

/** PnL Distribution Histogram */
function PnLHistogram({ trades }: { trades: BacktestTrade[] }) {
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
      min: bMin,
      max: bMax,
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
      {/* Y axis */}
      <line x1={marginL} y1={0} x2={marginL} y2={chartH} stroke="#374151" strokeWidth="1" />
      {/* X axis */}
      <line x1={marginL} y1={chartH} x2={chartW} y2={chartH} stroke="#374151" strokeWidth="1" />
      {buckets.map((b, i) => {
        const barH = (b.count / maxCount) * (chartH - 10);
        const x = marginL + 4 + i * (barW + 2);
        const y = chartH - barH;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={barH} rx="2"
              fill={b.isPositive ? "#22c55e" : "#ef4444"} opacity="0.8"
            />
            {b.count > 0 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="9" className="fill-muted-foreground">
                {b.count}
              </text>
            )}
          </g>
        );
      })}
      {/* Labels */}
      <text x={marginL + 4} y={chartH + 14} fontSize="9" className="fill-muted-foreground">
        {formatCurrency(minPnl)}
      </text>
      <text x={chartW - 4} y={chartH + 14} textAnchor="end" fontSize="9" className="fill-muted-foreground">
        {formatCurrency(maxPnl)}
      </text>
    </svg>
  );
}

/** Win/Loss ratio donut */
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
        {/* Loss portion (background) */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ef4444" strokeWidth={stroke} />
        {/* Win portion */}
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#22c55e" strokeWidth={stroke}
          strokeDasharray={`${winDash} ${circumference - winDash}`}
          strokeDashoffset={circumference / 4}
        />
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="fill-foreground" fontSize="18" fontWeight="700">
          {(winPct * 100).toFixed(1)}%
        </text>
        <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          Win Rate
        </text>
      </svg>
      <div className="flex gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> {wins} Wins
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> {losses} Losses
        </span>
      </div>
    </div>
  );
}

/** Section header component */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-6 pb-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

/** Performance stat row with label and 3 columns */
function PerfRow({
  label,
  all,
  long: longVal,
  short: shortVal,
  format = "number",
  colorize = false,
  isSingle = false,
}: {
  label: string;
  all: number | string;
  long?: number | string;
  short?: number | string;
  format?: "currency" | "percent" | "number" | "integer" | "ratio";
  colorize?: boolean;
  isSingle?: boolean;
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
// Main page
// ---------------------------------------------------------------------------
export default function BacktestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const backtestId = params.id as string;

  const {
    currentBacktest: bt,
    trades,
    loading,
    error,
    progress,
    fetchBacktest,
    fetchTrades,
    setProgress,
    markCompleted,
    markFailed,
  } = useBacktestStore();

  const equityChartRef = useRef<HTMLDivElement>(null);
  const drawdownChartRef = useRef<HTMLDivElement>(null);
  const tradeChartRef = useRef<HTMLDivElement>(null);
  const tradeChartObjRef = useRef<any>(null);
  const equityChartObjRef = useRef<any>(null);
  const drawdownChartObjRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "performance" | "trades" | "chart" | "logs">("overview");
  const [logs, setLogs] = useState<{ level: string; source: string; message: string; timestamp: string }[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<string>("");
  const [chartOHLCV, setChartOHLCV] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const indicatorSeriesRef = useRef<Record<string, any>>({});
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("backtest_chart_indicators");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return DEFAULT_INDICATORS;
  });
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [chartReady, setChartReady] = useState(0);
  const [showGrid, setShowGrid] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("chart_grid_visible") !== "false";
    }
    return true;
  });

  // Replay state for trade chart
  const REPLAY_SPEEDS = [1, 2, 5, 10, 25, 50];
  const [replayMode, setReplayMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const replayIndexRef = useRef(0);
  const replayTimerRef = useRef<number | null>(null);
  const [showReplayPicker, setShowReplayPicker] = useState(false);
  const [replayStartDate, setReplayStartDate] = useState("");
  const [replayStartTime, setReplayStartTime] = useState("09:15");
  const candleSeriesRefBT = useRef<any>(null);
  const volumeSeriesRefBT = useRef<any>(null);
  const chartOHLCVRef = useRef<any[]>([]);
  const indicatorsRef = useRef<IndicatorConfig>(indicators);

  // Keep refs in sync
  useEffect(() => { chartOHLCVRef.current = chartOHLCV; }, [chartOHLCV]);
  useEffect(() => { indicatorsRef.current = indicators; }, [indicators]);

  // Persist grid preference and apply to all charts
  useEffect(() => {
    localStorage.setItem("chart_grid_visible", String(showGrid));
    const gridColor = showGrid ? "rgba(42,46,57,0.6)" : "transparent";
    const opts = { grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } } };
    equityChartObjRef.current?.applyOptions(opts);
    drawdownChartObjRef.current?.applyOptions(opts);
    tradeChartObjRef.current?.applyOptions(opts);
  }, [showGrid]);

  // Derive traded options symbols (for instrument tabs)
  const allChartSymbols = useMemo(() => {
    const base = bt?.instruments || [];
    const optionSyms: string[] = [];
    const seen = new Set<string>();
    trades.forEach((t) => {
      const key = `${t.exchange}:${t.symbol}`;
      if (t.exchange?.toUpperCase() === "NFO" && !seen.has(key)) {
        seen.add(key);
        optionSyms.push(key);
      }
    });
    return [...base, ...optionSyms];
  }, [bt?.instruments, trades]);

  // Compute detailed stats from trades
  const stats = useMemo(
    () => computeDetailedStats(trades, bt?.initial_capital ?? 100000),
    [trades, bt?.initial_capital]
  );

  // Compute equity curve run-up / drawdown stats
  const eqStats = useMemo(
    () => computeEquityStats(bt?.equity_curve ?? [], bt?.initial_capital ?? 100000),
    [bt?.equity_curve, bt?.initial_capital]
  );

  useEffect(() => {
    fetchBacktest(backtestId);
    fetchTrades(backtestId);
  }, [backtestId]);

  // Poll for progress when backtest is running/pending
  useEffect(() => {
    if (!bt || (bt.status !== "running" && bt.status !== "pending")) return;

    const poll = async () => {
      try {
        const res = await apiClient.get(`/backtests/${backtestId}/progress`, { _suppressToast: true } as any);
        const data = res.data;
        if (data.status === "running" && data.percent != null) {
          setProgress(backtestId, data.percent, data.current_date || "");
        }
        if (data.status === "completed") {
          markCompleted(backtestId);
          fetchBacktest(backtestId);
          fetchTrades(backtestId);
        } else if (data.status === "failed") {
          markFailed(backtestId);
          fetchBacktest(backtestId);
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    poll(); // Initial check
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [bt?.status, backtestId]);

  // Fetch logs when backtest completes (needed for chart markers and log tab)
  useEffect(() => {
    if (!bt || (bt.status !== "completed" && bt.status !== "failed")) return;
    if (logs.length > 0) return; // already fetched
    setLogsLoading(true);
    apiClient
      .get(`/backtests/${backtestId}/logs`)
      .then((res) => setLogs(res.data || []))
      .catch(() => setLogs([]))
      .finally(() => setLogsLoading(false));
  }, [bt?.id, bt?.status]);

  // Helper: convert date strings to UNIX timestamps, deduplicate, sort
  const prepareTimeseriesData = (
    points: { date: string; value: number }[]
  ) => {
    const map = new Map<number, number>();
    for (const p of points) {
      const d = new Date(p.date);
      if (isNaN(d.getTime())) continue;
      const ts = Math.floor(d.getTime() / 1000);
      map.set(ts, p.value); // last value wins for duplicates
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as any, value }));
  };

  // Render equity curve chart
  useEffect(() => {
    if (!bt?.equity_curve?.length || !equityChartRef.current) return;

    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then(({ createChart, ColorType, CrosshairMode, LineStyle }) => {
      if (!equityChartRef.current) return;
      equityChartRef.current.innerHTML = "";

      const gridColor = showGrid ? "rgba(42,46,57,0.6)" : "transparent";
      const chart = createChart(equityChartRef.current, {
        width: equityChartRef.current.clientWidth,
        height: 350,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: gridColor },
          horzLines: { color: gridColor },
        },
        rightPriceScale: {
          borderColor: "#2a2e39",
          autoScale: true,
        },
        timeScale: {
          borderColor: "#2a2e39",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: LineStyle.Dashed },
          horzLine: { color: "rgba(255,255,255,0.2)", width: 1, style: LineStyle.Dashed },
        },
      });

      // Equity curve series
      const equitySeries = chart.addAreaSeries({
        lineColor: "#2962ff",
        topColor: "rgba(41,98,255,0.28)",
        bottomColor: "rgba(41,98,255,0.02)",
        lineWidth: 2,
        priceFormat: { type: "custom", formatter: (p: any) => "₹" + Number(p).toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
      });

      const data = prepareTimeseriesData(
        bt.equity_curve!.map((p) => ({ date: p.date, value: p.value }))
      );
      equitySeries.setData(data);

      // Initial capital reference line
      if (data.length >= 2) {
        const capitalLine = chart.addLineSeries({
          color: "rgba(255,255,255,0.25)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceFormat: { type: "custom", formatter: (p: any) => "₹" + Number(p).toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
          crosshairMarkerVisible: false,
          lastValueVisible: false,
        });
        capitalLine.setData([
          { time: data[0].time, value: bt.initial_capital },
          { time: data[data.length - 1].time, value: bt.initial_capital },
        ]);
      }

      chart.timeScale().fitContent();
      equityChartObjRef.current = chart;

      const handleResize = () => {
        if (equityChartRef.current) {
          chart.applyOptions({ width: equityChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", handleResize);

      cleanup = () => {
        window.removeEventListener("resize", handleResize);
        equityChartObjRef.current = null;
        chart.remove();
      };
    });

    return () => cleanup?.();
  }, [bt?.equity_curve, bt?.initial_capital]);

  // Render drawdown chart
  useEffect(() => {
    if (!bt?.drawdown_curve?.length || !drawdownChartRef.current) return;

    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then(({ createChart, ColorType, CrosshairMode, LineStyle }) => {
      if (!drawdownChartRef.current) return;
      drawdownChartRef.current.innerHTML = "";

      const gridColor = showGrid ? "rgba(42,46,57,0.6)" : "transparent";
      const chart = createChart(drawdownChartRef.current, {
        width: drawdownChartRef.current.clientWidth,
        height: 220,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: gridColor },
          horzLines: { color: gridColor },
        },
        rightPriceScale: {
          borderColor: "#2a2e39",
          autoScale: true,
        },
        timeScale: {
          borderColor: "#2a2e39",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: LineStyle.Dashed },
          horzLine: { color: "rgba(255,255,255,0.2)", width: 1, style: LineStyle.Dashed },
        },
      });

      const series = chart.addAreaSeries({
        lineColor: "#ef4444",
        topColor: "rgba(239,68,68,0.02)",
        bottomColor: "rgba(239,68,68,0.28)",
        lineWidth: 2,
        invertFilledArea: true,
        priceFormat: { type: "custom", formatter: (p: any) => Number(p).toFixed(2) + "%" },
      });

      const data = prepareTimeseriesData(
        bt.drawdown_curve!.map((p) => ({ date: p.date, value: -Math.abs(p.drawdown) }))
      );
      series.setData(data);
      chart.timeScale().fitContent();
      drawdownChartObjRef.current = chart;

      const handleResize = () => {
        if (drawdownChartRef.current) {
          chart.applyOptions({ width: drawdownChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", handleResize);

      cleanup = () => {
        window.removeEventListener("resize", handleResize);
        drawdownChartObjRef.current = null;
        chart.remove();
      };
    });

    return () => cleanup?.();
  }, [bt?.drawdown_curve]);

  // Parse "NSE:NIFTY 50" → { exchange: "NSE", symbol: "NIFTY 50" }
  const parseInstrument = (raw: string) => {
    const idx = raw.indexOf(":");
    if (idx > 0) return { exchange: raw.slice(0, idx), symbol: raw.slice(idx + 1) };
    return { exchange: "NSE", symbol: raw };
  };

  // --- Replay functions for backtest chart ---
  const updateBTChartToIndex = useCallback((index: number) => {
    if (!candleSeriesRefBT.current || !volumeSeriesRefBT.current || chartOHLCVRef.current.length === 0 || !bt) return;

    const isDaily = bt.timeframe === "1d";
    const parseTime = (timeStr: string) => {
      if (isDaily) return timeStr.slice(0, 10);
      return Math.floor(new Date(timeStr).getTime() / 1000) + 19800;
    };

    const slice = chartOHLCVRef.current.slice(0, index + 1);
    const candleData = slice.map((bar: any) => ({
      time: parseTime(bar.time),
      open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close),
    }));
    const volumeData = slice.map((bar: any) => ({
      time: parseTime(bar.time),
      value: Number(bar.volume),
      color: Number(bar.close) >= Number(bar.open) ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
    }));

    candleSeriesRefBT.current.setData(candleData as any);
    volumeSeriesRefBT.current.setData(volumeData as any);

    // Filter trade markers to only show trades before current bar time
    const currentBarTime = slice[slice.length - 1]?.time;
    if (currentBarTime && tradeChartObjRef.current) {
      const rawInst = chartSymbol || bt.instruments?.[0] || "";
      const parsed = parseInstrument(rawInst);
      const isUnderlying = (bt.instruments || []).some(
        (inst: string) => parseInstrument(inst).symbol.toUpperCase() === parsed.symbol.toUpperCase()
      );
      const symbolTrades = isUnderlying
        ? trades
        : trades.filter((t) => t.symbol.toUpperCase() === parsed.symbol.toUpperCase());

      const barMs = new Date(currentBarTime).getTime();
      const markers: any[] = [];
      symbolTrades.forEach((t, i) => {
        const entryMs = new Date(t.entry_at).getTime();
        if (entryMs > barMs) return;
        const isLong = t.side === "LONG" || t.side === "BUY";
        const tradeNum = i + 1;
        const sym = t.symbol.toUpperCase();
        const optType = sym.endsWith("CE") ? "CE" : sym.endsWith("PE") ? "PE" : "";

        markers.push({
          time: parseTime(t.entry_at),
          position: isLong ? "belowBar" : "aboveBar",
          color: "#22c55e",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: isUnderlying && optType ? `${isLong ? "Buy" : "Sell"} ${optType} #${tradeNum}` : `#${tradeNum}`,
        });

        if (t.exit_at) {
          const exitMs = new Date(t.exit_at).getTime();
          if (exitMs <= barMs) {
            markers.push({
              time: parseTime(t.exit_at),
              position: isLong ? "aboveBar" : "belowBar",
              color: "#ef4444",
              shape: isLong ? "arrowDown" : "arrowUp",
              text: isUnderlying ? `Exit #${tradeNum}` : `#${tradeNum}`,
            });
          }
        }
      });

      // Trigger markers from logs
      if (isUnderlying && logs.length > 0) {
        logs.forEach((log) => {
          const logMs = new Date(log.timestamp).getTime();
          if (logMs > barMs) return;
          if (log.message.startsWith("BULL TRIGGER NEGATED") || log.message.startsWith("Bull trigger INVALIDATED")) {
            markers.push({ time: parseTime(log.timestamp), position: "belowBar", color: "#6b7280", shape: "circle", text: "X Bull" });
          } else if (log.message.startsWith("BEAR TRIGGER NEGATED") || log.message.startsWith("Bear trigger INVALIDATED")) {
            markers.push({ time: parseTime(log.timestamp), position: "aboveBar", color: "#6b7280", shape: "circle", text: "X Bear" });
          } else if (log.message.startsWith("BULL TRIGGER")) {
            markers.push({ time: parseTime(log.timestamp), position: "belowBar", color: "#3b82f6", shape: "circle", text: "Bull" });
          } else if (log.message.startsWith("BEAR TRIGGER")) {
            markers.push({ time: parseTime(log.timestamp), position: "aboveBar", color: "#f97316", shape: "circle", text: "Bear" });
          } else if (log.message.includes("rejected") || log.message.startsWith("ORDER REJECTED")) {
            markers.push({ time: parseTime(log.timestamp), position: "aboveBar", color: "#ef4444", shape: "square", text: "REJECTED" });
          }
        });
      }

      markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      candleSeriesRefBT.current.setMarkers(markers);
    }

    // Apply indicators to sliced data
    if (tradeChartObjRef.current && candleSeriesRefBT.current) {
      const sliceVolumes = slice.map((b: any) => Number(b.volume));
      applyIndicators(tradeChartObjRef.current, candleSeriesRefBT.current, candleData as CandleData[], sliceVolumes, indicatorsRef.current, indicatorSeriesRef);
      tradeChartObjRef.current.timeScale().scrollToRealTime();
    }
  }, [bt, chartSymbol, trades, logs]);

  const openBTReplayPicker = useCallback(() => {
    if (chartOHLCVRef.current.length === 0) return;
    const firstBar = chartOHLCVRef.current[0];
    const d = new Date(firstBar.time);
    setReplayStartDate(d.toISOString().slice(0, 10));
    setReplayStartTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setShowReplayPicker(true);
  }, []);

  const startBTReplayFromPicker = useCallback(() => {
    if (chartOHLCVRef.current.length === 0) return;
    setShowReplayPicker(false);
    const targetStr = `${replayStartDate}T${replayStartTime}:00`;
    const targetMs = new Date(targetStr).getTime();
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < chartOHLCVRef.current.length; i++) {
      const barMs = new Date(chartOHLCVRef.current[i].time).getTime();
      const diff = Math.abs(barMs - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    setReplayMode(true);
    setIsPlaying(false);
    setReplaySpeed(1);
    setReplayIndex(bestIdx);
    replayIndexRef.current = bestIdx;
    if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    updateBTChartToIndex(bestIdx);
  }, [replayStartDate, replayStartTime, updateBTChartToIndex]);

  const exitBTReplay = useCallback(() => {
    setReplayMode(false);
    setIsPlaying(false);
    if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    // Force full chart rebuild by creating a new array reference (triggers the chart useEffect)
    setChartOHLCV([...chartOHLCVRef.current]);
  }, []);

  const stepBTForward = useCallback(() => {
    if (replayIndexRef.current >= chartOHLCVRef.current.length - 1) return;
    const next = replayIndexRef.current + 1;
    replayIndexRef.current = next;
    setReplayIndex(next);
    updateBTChartToIndex(next);
  }, [updateBTChartToIndex]);

  const resetBTReplay = useCallback(() => {
    setIsPlaying(false);
    if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    replayIndexRef.current = 0;
    setReplayIndex(0);
    updateBTChartToIndex(0);
  }, [updateBTChartToIndex]);

  const toggleBTPlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    } else {
      if (replayIndexRef.current >= chartOHLCVRef.current.length - 1) {
        replayIndexRef.current = 0;
        setReplayIndex(0);
        updateBTChartToIndex(0);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, updateBTChartToIndex]);

  const handleBTSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    replayIndexRef.current = idx;
    setReplayIndex(idx);
    updateBTChartToIndex(idx);
  }, [updateBTChartToIndex]);

  // Play timer for backtest replay
  useEffect(() => {
    if (!isPlaying || !replayMode || activeTab !== "chart") return;
    const intervalMs = Math.max(500 / replaySpeed, 20);
    const timer = window.setInterval(() => {
      const next = replayIndexRef.current + 1;
      if (next >= chartOHLCVRef.current.length) {
        setIsPlaying(false);
        return;
      }
      replayIndexRef.current = next;
      setReplayIndex(next);
      updateBTChartToIndex(next);
    }, intervalMs) as unknown as number;
    replayTimerRef.current = timer;
    return () => { clearInterval(timer); replayTimerRef.current = null; };
  }, [isPlaying, replayMode, replaySpeed, activeTab, updateBTChartToIndex]);

  // Re-apply indicators when config changes (works in both normal and replay mode)
  useEffect(() => {
    if (!tradeChartObjRef.current || !candleSeriesRefBT.current || !bt || chartOHLCVRef.current.length === 0) return;
    const isDaily = bt.timeframe === "1d";
    const parseTime = (timeStr: string) => {
      if (isDaily) return timeStr.slice(0, 10);
      return Math.floor(new Date(timeStr).getTime() / 1000) + 19800;
    };
    const data = replayMode
      ? chartOHLCVRef.current.slice(0, replayIndexRef.current + 1)
      : chartOHLCVRef.current;
    if (data.length === 0) return;
    const candleData = data.map((bar: any) => ({
      time: parseTime(bar.time), open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close),
    }));
    const volumes = data.map((b: any) => Number(b.volume));
    applyIndicators(tradeChartObjRef.current, candleSeriesRefBT.current, candleData as CandleData[], volumes, indicators, indicatorSeriesRef);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, bt]);

  // Exit replay when chart symbol changes
  useEffect(() => {
    if (replayMode) {
      setReplayMode(false);
      setIsPlaying(false);
      if (replayTimerRef.current !== null) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSymbol]);

  // Fetch OHLCV data when chart tab is active
  useEffect(() => {
    if (activeTab !== "chart" || !bt || bt.status !== "completed") return;
    const rawInst = chartSymbol || bt.instruments?.[0] || "";
    if (!rawInst) return;
    const { exchange, symbol } = parseInstrument(rawInst);

    setChartLoading(true);
    apiClient
      .get("/market-data/ohlcv", {
        params: {
          symbol,
          exchange,
          from_date: bt.start_date,
          to_date: bt.end_date,
          interval: bt.timeframe,
        },
      })
      .then((res) => setChartOHLCV(res.data))
      .catch(() => setChartOHLCV([]))
      .finally(() => setChartLoading(false));
  }, [activeTab, bt?.id, bt?.status, chartSymbol]);

  // Persist indicator changes
  useEffect(() => {
    localStorage.setItem("backtest_chart_indicators", JSON.stringify(indicators));
  }, [indicators]);

  // Render trade signal chart
  useEffect(() => {
    if (activeTab !== "chart" || !chartOHLCV.length || !tradeChartRef.current || !bt) return;
    // Don't rebuild chart when in replay mode — replay functions handle data updates
    if (replayMode) return;

    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (!tradeChartRef.current) return;
      tradeChartRef.current.innerHTML = "";
      // Reset indicator series refs — old chart is destroyed, stale refs cause silent failures
      indicatorSeriesRef.current = {};
      candleSeriesRefBT.current = null;
      volumeSeriesRefBT.current = null;

      const isDaily = bt.timeframe === "1d";
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      const parseTime = (timeStr: string) => {
        if (isDaily) return timeStr.slice(0, 10);
        return Math.floor(new Date(timeStr).getTime() / 1000) + 19800;
      };

      const gridColor = showGrid ? "rgba(42,46,57,0.6)" : "transparent";
      const chart = createChart(tradeChartRef.current, {
        width: tradeChartRef.current.clientWidth,
        height: 500,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: gridColor },
          horzLines: { color: gridColor },
        },
        crosshair: { mode: 0 },
        timeScale: {
          borderColor: "#2a2e39",
          timeVisible: !isDaily,
          secondsVisible: false,
          tickMarkFormatter: !isDaily
            ? (time: number, tickMarkType: number) => {
                const d = new Date(time * 1000);
                const day = d.getUTCDate();
                const mon = MONTHS[d.getUTCMonth()];
                if (tickMarkType >= 3) {
                  // Time-level tick: show date + time
                  const h = String(d.getUTCHours()).padStart(2, "0");
                  const m = String(d.getUTCMinutes()).padStart(2, "0");
                  return `${day} ${mon} ${h}:${m}`;
                }
                if (tickMarkType === 2) return `${day} ${mon}`;
                if (tickMarkType === 1) return `${mon} ${d.getUTCFullYear()}`;
                return `${d.getUTCFullYear()}`;
              }
            : undefined,
        },
        rightPriceScale: { borderColor: "#2a2e39" },
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

      const candleData = chartOHLCV.map((bar: any) => ({
        time: parseTime(bar.time),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
      }));
      candleSeries.setData(candleData as any);

      // Volume series
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      volumeSeries.setData(
        chartOHLCV.map((bar: any) => ({
          time: parseTime(bar.time),
          value: Number(bar.volume),
          color: Number(bar.close) >= Number(bar.open)
            ? "rgba(34,197,94,0.3)"
            : "rgba(239,68,68,0.3)",
        })) as any
      );

      // Store refs for replay mode
      candleSeriesRefBT.current = candleSeries;
      volumeSeriesRefBT.current = volumeSeries;

      // Trade entry/exit markers + connecting lines
      const rawInst = chartSymbol || bt.instruments?.[0] || "";
      const parsed = parseInstrument(rawInst);

      // Determine if this chart shows an underlying instrument vs an options symbol
      const isUnderlying = (bt.instruments || []).some(
        (inst) => parseInstrument(inst).symbol.toUpperCase() === parsed.symbol.toUpperCase()
      );

      // On underlying chart: show ALL trades (they were triggered by this underlying)
      // On options chart: filter to only trades on that specific options symbol
      const symbolTrades = isUnderlying
        ? trades
        : trades.filter((t) => t.symbol.toUpperCase() === parsed.symbol.toUpperCase());

      // Build time → close lookup for underlying price (for connecting lines)
      const priceAtTime: Record<string, number> = {};
      if (isUnderlying) {
        chartOHLCV.forEach((bar: any) => {
          priceAtTime[String(parseTime(bar.time))] = Number(bar.close);
        });
      }

      const markers: any[] = [];
      symbolTrades.forEach((t, i) => {
        const isLong = t.side === "LONG" || t.side === "BUY";
        const tradeNum = i + 1;
        // Determine option type from symbol (ends with CE or PE)
        const sym = t.symbol.toUpperCase();
        const optType = sym.endsWith("CE") ? "CE" : sym.endsWith("PE") ? "PE" : "";

        // Entry marker
        markers.push({
          time: parseTime(t.entry_at),
          position: isLong ? "belowBar" : "aboveBar",
          color: "#22c55e",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: isUnderlying && optType
            ? `${isLong ? "Buy" : "Sell"} ${optType} #${tradeNum}`
            : `#${tradeNum}`,
        });

        // Exit marker
        if (t.exit_at) {
          markers.push({
            time: parseTime(t.exit_at),
            position: isLong ? "aboveBar" : "belowBar",
            color: "#ef4444",
            shape: isLong ? "arrowDown" : "arrowUp",
            text: isUnderlying ? `Exit #${tradeNum}` : `#${tradeNum}`,
          });
        }
      });

      // Trigger markers from logs (only on underlying chart)
      if (isUnderlying && logs.length > 0) {
        logs.forEach((log) => {
          if (log.message.startsWith("BULL TRIGGER NEGATED") || log.message.startsWith("Bull trigger INVALIDATED")) {
            markers.push({
              time: parseTime(log.timestamp),
              position: "belowBar",
              color: "#6b7280",
              shape: "circle",
              text: "X Bull",
            });
          } else if (log.message.startsWith("BEAR TRIGGER NEGATED") || log.message.startsWith("Bear trigger INVALIDATED")) {
            markers.push({
              time: parseTime(log.timestamp),
              position: "aboveBar",
              color: "#6b7280",
              shape: "circle",
              text: "X Bear",
            });
          } else if (log.message.startsWith("BULL TRIGGER")) {
            markers.push({
              time: parseTime(log.timestamp),
              position: "belowBar",
              color: "#3b82f6",
              shape: "circle",
              text: "Bull",
            });
          } else if (log.message.startsWith("BEAR TRIGGER")) {
            markers.push({
              time: parseTime(log.timestamp),
              position: "aboveBar",
              color: "#f97316",
              shape: "circle",
              text: "Bear",
            });
          } else if (log.message.includes("rejected") || log.message.startsWith("ORDER REJECTED")) {
            markers.push({
              time: parseTime(log.timestamp),
              position: "aboveBar",
              color: "#ef4444",
              shape: "square",
              text: "REJECTED",
            });
          }
        });
      }

      // Markers must be sorted by time
      markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      candleSeries.setMarkers(markers);

      // Dotted lines connecting entry → exit for each trade
      symbolTrades.forEach((t) => {
        if (!t.exit_at || t.exit_price == null) return;
        const isWin = (t.net_pnl ?? 0) >= 0;
        const lineSeries = chart.addLineSeries({
          color: isWin ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        if (isUnderlying) {
          // Use underlying close prices (not options prices) for connecting lines
          const entryVal = priceAtTime[String(parseTime(t.entry_at))];
          const exitVal = priceAtTime[String(parseTime(t.exit_at!))];
          if (entryVal != null && exitVal != null) {
            lineSeries.setData([
              { time: parseTime(t.entry_at), value: entryVal },
              { time: parseTime(t.exit_at!), value: exitVal },
            ] as any);
          }
        } else {
          // Options chart: use actual options entry/exit prices
          lineSeries.setData([
            { time: parseTime(t.entry_at), value: t.entry_price },
            { time: parseTime(t.exit_at!), value: t.exit_price },
          ] as any);
        }
      });

      // CPR levels (Pivot, TC, BC) from previous day's HLC
      if (!isDaily) {
        // Group bars by date
        const dayMap: Record<string, { high: number; low: number; close: number }> = {};
        chartOHLCV.forEach((bar: any) => {
          const dateStr = bar.time.slice(0, 10);
          if (!dayMap[dateStr]) {
            dayMap[dateStr] = { high: -Infinity, low: Infinity, close: 0 };
          }
          const h = Number(bar.high);
          const l = Number(bar.low);
          if (h > dayMap[dateStr].high) dayMap[dateStr].high = h;
          if (l < dayMap[dateStr].low) dayMap[dateStr].low = l;
          dayMap[dateStr].close = Number(bar.close); // last bar's close
        });

        const sortedDates = Object.keys(dayMap).sort();

        // Build CPR data points: each day uses previous day's HLC
        const pivotData: any[] = [];
        const tcData: any[] = [];
        const bcData: any[] = [];

        for (let di = 1; di < sortedDates.length; di++) {
          const prevDay = dayMap[sortedDates[di - 1]];
          const pivot = (prevDay.high + prevDay.low + prevDay.close) / 3;
          const bc = (prevDay.high + prevDay.low) / 2;
          const tc = 2 * pivot - bc;

          // Add CPR level for every bar on this day
          const curDate = sortedDates[di];
          chartOHLCV.forEach((bar: any) => {
            if (bar.time.slice(0, 10) === curDate) {
              const t = parseTime(bar.time);
              pivotData.push({ time: t, value: pivot });
              tcData.push({ time: t, value: tc });
              bcData.push({ time: t, value: bc });
            }
          });
        }

        if (pivotData.length > 0) {
          const pivotLine = chart.addLineSeries({
            color: "rgba(156,163,175,0.7)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            title: "Pivot",
          });
          pivotLine.setData(pivotData);

          const tcLine = chart.addLineSeries({
            color: "rgba(34,197,94,0.6)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            title: "TC",
          });
          tcLine.setData(tcData);

          const bcLine = chart.addLineSeries({
            color: "rgba(239,68,68,0.6)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            title: "BC",
          });
          bcLine.setData(bcData);
        }
      }

      // Apply indicators
      const volumes = chartOHLCV.map((b: any) => Number(b.volume));
      applyIndicators(chart, candleSeries, candleData as CandleData[], volumes, indicators, indicatorSeriesRef);

      chart.timeScale().fitContent();
      tradeChartObjRef.current = chart;
      setChartReady(c => c + 1);

      const handleResize = () => {
        if (tradeChartRef.current) {
          chart.applyOptions({ width: tradeChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", handleResize);

      cleanup = () => {
        window.removeEventListener("resize", handleResize);
        chart.remove();
        tradeChartObjRef.current = null;
        candleSeriesRefBT.current = null;
        volumeSeriesRefBT.current = null;
      };
    });

    return () => cleanup?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, chartOHLCV, trades, chartSymbol, logs]);

  if (loading && !bt) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !bt) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/backtests")}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Backtests
        </button>
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
          {error || "Backtest not found"}
        </div>
      </div>
    );
  }

  const prog = progress[backtestId];
  const isRunning = bt.status === "running" || bt.status === "pending";
  const finalEquity = bt.equity_curve?.length ? bt.equity_curve[bt.equity_curve.length - 1].value : bt.initial_capital;
  const netPnl = finalEquity - bt.initial_capital;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push("/backtests")}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Backtests
          </button>
          <h1 className="text-2xl font-bold tracking-tight">
            {bt.strategy_name || "Strategy"} — Backtest Report
          </h1>
          <p className="text-muted-foreground text-sm">
            {bt.instruments?.join(", ")} · {bt.start_date} to {bt.end_date} · {bt.timeframe} · {formatCurrency(bt.initial_capital)} capital
          </p>
        </div>
        <div className="flex items-center gap-3">
          {bt.status === "completed" && (
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border bg-background hover:bg-accent transition-colors">
                <Download className="h-4 w-4" />
                Export
              </button>
              <div className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-popover shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <button
                  onClick={() => exportTradesCSV(trades, bt.strategy_name || "backtest")}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-t-md"
                >
                  Trade Log (.csv)
                </button>
                <button
                  onClick={() => exportSummaryCSV(bt, null)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-b-md"
                >
                  Summary (.csv)
                </button>
              </div>
            </div>
          )}
          <StatusBadge status={bt.status} />
        </div>
      </div>

      {/* Progress bar for running backtests */}
      {isRunning && (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {prog
                    ? `Processing ${prog.current_date}...`
                    : "Queued, waiting to start..."}
                </span>
                <span className="font-medium">
                  {prog ? `${prog.percent.toFixed(1)}%` : "0%"}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${prog?.percent ?? 0}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error message */}
      {bt.status === "failed" && bt.error_message && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 flex items-start space-x-3">
          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">Backtest Failed</p>
            <p className="text-sm text-red-700 mt-1">{bt.error_message}</p>
          </div>
        </div>
      )}

      {/* Completed results */}
      {bt.status === "completed" && (
        <>
          {/* Key metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KeyMetric
              label="Net Profit"
              value={formatCurrency(netPnl)}
              sub={bt.total_return != null ? `${formatPercent(bt.total_return * 100)}` : ""}
              color={netPnl >= 0 ? "green" : "red"}
            />
            <KeyMetric
              label="Total Trades"
              value={String(bt.total_trades ?? 0)}
              sub={`${stats.all.winners}W / ${stats.all.losers}L`}
            />
            <KeyMetric
              label="Win Rate"
              value={bt.win_rate != null ? `${(bt.win_rate * 100).toFixed(1)}%` : "—"}
              color={bt.win_rate != null && bt.win_rate >= 0.5 ? "green" : "red"}
            />
            <KeyMetric
              label="Profit Factor"
              value={bt.profit_factor != null ? bt.profit_factor.toFixed(2) : "—"}
              color={bt.profit_factor != null && bt.profit_factor >= 1 ? "green" : "red"}
            />
            <KeyMetric
              label="Max Drawdown"
              value={bt.max_drawdown != null ? `${(Math.abs(bt.max_drawdown) * 100).toFixed(2)}%` : "—"}
              color="red"
            />
          </div>

          {/* Tab Navigation */}
          <div className="border-b">
            <nav className="flex space-x-8">
              {(["overview", "performance", "trades", "chart", "logs"] as const).map((tab) => (
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
                    ? "Performance Summary"
                    : tab === "trades"
                    ? `Trade Log (${trades.length})`
                    : tab === "chart"
                    ? "Trade Chart"
                    : `Logs (${logs.length})`}
                </button>
              ))}
            </nav>
          </div>

          {/* ============================================================ */}
          {/* OVERVIEW TAB — Charts */}
          {/* ============================================================ */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard label="CAGR" value={bt.cagr != null ? formatPercent(bt.cagr * 100) : "—"} color={bt.cagr != null && bt.cagr >= 0 ? "green" : "red"} />
                <SummaryCard label="Sharpe Ratio" value={bt.sharpe_ratio != null ? bt.sharpe_ratio.toFixed(2) : "—"} color={bt.sharpe_ratio != null ? (bt.sharpe_ratio >= 1 ? "green" : bt.sharpe_ratio >= 0 ? "yellow" : "red") : undefined} />
                <SummaryCard label="Sortino Ratio" value={bt.sortino_ratio != null ? bt.sortino_ratio.toFixed(2) : "—"} color={bt.sortino_ratio != null ? (bt.sortino_ratio >= 1 ? "green" : bt.sortino_ratio >= 0 ? "yellow" : "red") : undefined} />
                <SummaryCard label="Avg Trade P&L" value={bt.avg_trade_pnl != null ? formatCurrency(bt.avg_trade_pnl) : "—"} color={bt.avg_trade_pnl != null && bt.avg_trade_pnl >= 0 ? "green" : "red"} />
              </div>

              {/* Equity Curve */}
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Equity Curve</CardTitle>
                  <button
                    onClick={() => setShowGrid(!showGrid)}
                    className={cn(
                      "p-1 rounded-md border transition-colors",
                      showGrid
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    )}
                    title={showGrid ? "Hide grid lines" : "Show grid lines"}
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                  </button>
                </CardHeader>
                <CardContent>
                  {bt.equity_curve?.length ? (
                    <div ref={equityChartRef} />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No equity curve data
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Drawdown Chart */}
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Drawdown</CardTitle>
                  <button
                    onClick={() => setShowGrid(!showGrid)}
                    className={cn(
                      "p-1 rounded-md border transition-colors",
                      showGrid
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    )}
                    title={showGrid ? "Hide grid lines" : "Show grid lines"}
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                  </button>
                </CardHeader>
                <CardContent>
                  {bt.drawdown_curve?.length ? (
                    <div ref={drawdownChartRef} />
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      No drawdown data
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* PERFORMANCE TAB — TradingView Strategy Report */}
          {/* ============================================================ */}
          {activeTab === "performance" && (
            <div className="space-y-1">

              {/* ─── PERFORMANCE ─── */}
              <SectionHeader title="Performance" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Profit Structure */}
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

                {/* Benchmarking Donut Charts */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Benchmarking</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-around py-2">
                      <DonutChart
                        value={stats.all.winRate}
                        maxVal={100}
                        label="% Profitable"
                        color="#22c55e"
                        formatFn={(v) => `${v.toFixed(1)}%`}
                      />
                      <DonutChart
                        value={stats.all.ratioAvgWinLoss}
                        maxVal={Math.max(stats.all.ratioAvgWinLoss * 1.5, 3)}
                        label="Avg Win / Avg Loss"
                        color="#3b82f6"
                        formatFn={(v) => v.toFixed(2)}
                      />
                      <DonutChart
                        value={bt.sharpe_ratio ?? 0}
                        maxVal={Math.max(Math.abs(bt.sharpe_ratio ?? 0) * 2, 3)}
                        label="Sharpe Ratio"
                        color="#a855f7"
                        formatFn={(v) => v.toFixed(2)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ─── RETURNS ─── */}
              <SectionHeader title="Returns" />
              <Card>
                <CardContent className="pt-4">
                  {/* Column headers */}
                  <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <div></div>
                    <div className="text-right">All Trades</div>
                    <div className="text-right">Long Trades</div>
                    <div className="text-right">Short Trades</div>
                  </div>
                  <PerfRow label="Initial Capital" all={bt.initial_capital} long={bt.initial_capital} short={bt.initial_capital} format="currency" />
                  <PerfRow label="Net P&L" all={stats.all.netProfit} long={stats.long.netProfit} short={stats.short.netProfit} format="currency" colorize />
                  <PerfRow
                    label="Net P&L %"
                    all={bt.initial_capital > 0 ? (stats.all.netProfit / bt.initial_capital) * 100 : 0}
                    long={bt.initial_capital > 0 ? (stats.long.netProfit / bt.initial_capital) * 100 : 0}
                    short={bt.initial_capital > 0 ? (stats.short.netProfit / bt.initial_capital) * 100 : 0}
                    format="percent" colorize
                  />
                  <PerfRow label="Gross Profit" all={stats.all.grossProfit} long={stats.long.grossProfit} short={stats.short.grossProfit} format="currency" colorize />
                  <PerfRow label="Gross Loss" all={-stats.all.grossLoss} long={-stats.long.grossLoss} short={-stats.short.grossLoss} format="currency" colorize />
                  <PerfRow label="Profit Factor" all={stats.all.profitFactor} long={stats.long.profitFactor} short={stats.short.profitFactor} format="ratio" />
                  <PerfRow label="Commission Paid" all={stats.all.totalCharges} long={stats.long.totalCharges} short={stats.short.totalCharges} format="currency" />
                  <PerfRow label="Expected Payoff" all={stats.all.expectedPayoff} long={stats.long.expectedPayoff} short={stats.short.expectedPayoff} format="currency" colorize />
                </CardContent>
              </Card>

              {/* ─── RISK-ADJUSTED PERFORMANCE ─── */}
              <SectionHeader title="Risk-Adjusted Performance" />
              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <div></div>
                    <div className="text-right">Value</div>
                    <div className="text-right" />
                    <div className="text-right" />
                  </div>
                  <PerfRow label="Sharpe Ratio" all={bt.sharpe_ratio ?? 0} format="ratio" isSingle />
                  <PerfRow label="Sortino Ratio" all={bt.sortino_ratio ?? 0} format="ratio" isSingle />
                  <PerfRow label="Max Drawdown %" all={bt.max_drawdown != null ? Math.abs(bt.max_drawdown) * 100 : 0} format="percent" isSingle />
                  <PerfRow
                    label="Max Drawdown Amount"
                    all={eqStats.maxDrawdownAmt}
                    format="currency"
                    isSingle
                  />
                </CardContent>
              </Card>

              {/* ─── TRADES ANALYSIS ─── */}
              <SectionHeader title="Trades Analysis" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* PnL Distribution */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">P&L Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PnLHistogram trades={trades} />
                  </CardContent>
                </Card>

                {/* Win/Loss Ratio */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Win / Loss Ratio</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-center py-4">
                    <WinLossDonut wins={stats.all.winners} losses={stats.all.losers} />
                  </CardContent>
                </Card>
              </div>

              {/* Detailed trades table */}
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
                  <PerfRow
                    label="Largest Winner % of Gross Profit"
                    all={stats.all.largestWinPctOfGross}
                    long={stats.long.largestWinPctOfGross}
                    short={stats.short.largestWinPctOfGross}
                    format="percent"
                  />
                  <PerfRow
                    label="Largest Loser % of Gross Loss"
                    all={stats.all.largestLossPctOfGross}
                    long={stats.long.largestLossPctOfGross}
                    short={stats.short.largestLossPctOfGross}
                    format="percent"
                  />
                  <PerfRow label="Max Consecutive Wins" all={stats.all.maxConsecWins} long={stats.long.maxConsecWins} short={stats.short.maxConsecWins} format="integer" />
                  <PerfRow label="Max Consecutive Losses" all={stats.all.maxConsecLosses} long={stats.long.maxConsecLosses} short={stats.short.maxConsecLosses} format="integer" />
                </CardContent>
              </Card>

              {/* ─── CAPITAL EFFICIENCY ─── */}
              <SectionHeader title="Capital Efficiency" />
              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <div></div>
                    <div className="text-right">Value</div>
                    <div className="text-right" />
                    <div className="text-right" />
                  </div>
                  <PerfRow
                    label="Annualized Return (CAGR)"
                    all={bt.cagr != null ? bt.cagr * 100 : 0}
                    format="percent" colorize isSingle
                  />
                  <PerfRow
                    label="Return on Initial Capital"
                    all={bt.initial_capital > 0 ? (stats.all.netProfit / bt.initial_capital) * 100 : 0}
                    format="percent" colorize isSingle
                  />
                  <PerfRow
                    label="Account Size Required"
                    all={bt.initial_capital + eqStats.maxDrawdownAmt}
                    format="currency" isSingle
                  />
                  <PerfRow
                    label="Net Profit as % of Largest Loss"
                    all={stats.all.largestLoss !== 0 ? (stats.all.netProfit / Math.abs(stats.all.largestLoss)) * 100 : 0}
                    format="percent" colorize isSingle
                  />
                </CardContent>
              </Card>

              {/* ─── RUN-UPS AND DRAWDOWNS ─── */}
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
                  <PerfRow
                    label="Max Run-up as % of Capital"
                    all={eqStats.maxRunUpPctOfCapital}
                    format="percent" isSingle
                  />

                  <div className="h-3" />

                  <PerfRow label="Max Equity Drawdown" all={-eqStats.maxDrawdownAmt} format="currency" colorize isSingle />
                  <PerfRow label="Max Equity Drawdown %" all={-eqStats.maxDrawdownPct} format="percent" colorize isSingle />
                  <PerfRow label="Max Equity Drawdown Duration" all={`${eqStats.maxDrawdownDays} days`} isSingle />
                  <PerfRow label="Avg Equity Drawdown" all={-eqStats.avgDrawdownAmt} format="currency" colorize isSingle />
                  <PerfRow label="Avg Equity Drawdown Duration" all={`${eqStats.avgDrawdownDays} days`} isSingle />
                  <PerfRow
                    label="Max Drawdown as % of Capital"
                    all={-eqStats.maxDrawdownPctOfCapital}
                    format="percent" colorize isSingle
                  />
                  <PerfRow
                    label="Return / Max Drawdown"
                    all={eqStats.returnOfMaxDrawdown}
                    format="percent" colorize isSingle
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* TRADES TAB — TradingView-style grouped Entry/Exit rows */}
          {/* ============================================================ */}
          {activeTab === "trades" && (
            <Card>
              <CardContent className="pt-4">
                {trades.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground">
                    No trades recorded
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium w-24">Trade #</th>
                          <th className="pb-2 pr-4 font-medium w-16">Type</th>
                          <th className="pb-2 pr-4 font-medium">Date and Time</th>
                          <th className="pb-2 pr-4 font-medium">Signal</th>
                          <th className="pb-2 pr-4 font-medium text-right">Price</th>
                          <th className="pb-2 pr-4 font-medium text-right">Qty</th>
                          <th className="pb-2 pr-4 font-medium text-right">Net P&L</th>
                          <th className="pb-2 pr-4 font-medium text-right">Charges</th>
                          <th className="pb-2 font-medium text-right">Cumulative P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const totalTrades = trades.length;
                          // Pre-compute cumulative P&L in chronological order
                          const cumPnls: number[] = [];
                          let running = 0;
                          for (const t of trades) {
                            running += (t.net_pnl ?? 0);
                            cumPnls.push(running);
                          }
                          // Display in reverse (latest first)
                          const reversed = [...trades].reverse();
                          return reversed.map((t, i) => {
                            const origIdx = totalTrades - 1 - i;
                            const cumPnl = cumPnls[origIdx];
                            const tradeNum = totalTrades - i;
                            const isLong = t.side === "LONG" || t.side === "BUY";
                            const isOpen = t.exit_price == null;
                            const cumPnlPct = bt.initial_capital > 0 ? (cumPnl / bt.initial_capital) * 100 : 0;

                            return (
                              <React.Fragment key={i}>
                                {/* Exit row (top) */}
                                <tr className="border-b border-border/30 hover:bg-accent/30">
                                  {/* Trade # + Side — spans 2 rows */}
                                  <td rowSpan={2} className="py-2 pr-4 align-top">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-muted-foreground font-medium">{tradeNum}</span>
                                      <span className={cn(
                                        "text-xs font-semibold",
                                        isLong ? "text-green-500" : "text-red-500"
                                      )}>
                                        {isLong ? "Long" : "Short"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-2 pr-4 text-muted-foreground">Exit</td>
                                  <td className="py-2 pr-4 whitespace-nowrap">
                                    {isOpen
                                      ? "—"
                                      : t.exit_at
                                      ? new Date(t.exit_at).toLocaleString("en-IN", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
                                      : "—"}
                                  </td>
                                  <td className="py-2 pr-4 text-muted-foreground">
                                    {isOpen ? "Open" : isLong ? "short" : "long"}
                                  </td>
                                  <td className="py-2 pr-4 text-right">
                                    {t.exit_price != null ? formatCurrency(t.exit_price) : "—"}
                                  </td>
                                  {/* Qty — spans 2 rows */}
                                  <td rowSpan={2} className="py-2 pr-4 text-right align-middle">
                                    {t.quantity}
                                  </td>
                                  {/* Net P&L — spans 2 rows */}
                                  <td rowSpan={2} className="py-2 pr-4 text-right align-middle">
                                    <div className={cn("font-medium", t.net_pnl != null ? (t.net_pnl >= 0 ? "text-green-500" : "text-red-500") : "")}>
                                      {t.net_pnl != null ? formatCurrency(t.net_pnl) : "—"}
                                    </div>
                                    {t.pnl_percent != null && (
                                      <div className={cn("text-xs", t.pnl_percent >= 0 ? "text-green-500" : "text-red-500")}>
                                        {formatPercent(t.pnl_percent)}
                                      </div>
                                    )}
                                  </td>
                                  {/* Charges — spans 2 rows */}
                                  <td rowSpan={2} className="py-2 pr-4 text-right align-middle text-muted-foreground">
                                    {formatCurrency(t.charges)}
                                  </td>
                                  {/* Cumulative P&L — spans 2 rows */}
                                  <td rowSpan={2} className="py-2 text-right align-middle">
                                    <div className={cn("font-medium", cumPnl >= 0 ? "text-green-500" : "text-red-500")}>
                                      {formatCurrency(cumPnl)}
                                    </div>
                                    <div className={cn("text-xs", cumPnlPct >= 0 ? "text-green-500" : "text-red-500")}>
                                      {cumPnlPct >= 0 ? "+" : ""}{cumPnlPct.toFixed(2)}%
                                    </div>
                                  </td>
                                </tr>
                                {/* Entry row (bottom) */}
                                <tr className={cn("hover:bg-accent/30", i < trades.length - 1 ? "border-b border-border" : "")}>
                                  <td className="py-2 pr-4 text-muted-foreground">Entry</td>
                                  <td className="py-2 pr-4 whitespace-nowrap">
                                    {t.entry_at
                                      ? new Date(t.entry_at).toLocaleString("en-IN", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
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

          {/* ============================================================ */}
          {/* CHART TAB — Candlestick chart with trade entry/exit markers */}
          {/* ============================================================ */}
          {activeTab === "chart" && (
            <div className="space-y-4">
              {/* Instrument selector (underlying + traded options) */}
              {allChartSymbols.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Instrument:</span>
                  {allChartSymbols.map((sym) => {
                    const isOpt = sym.toUpperCase().startsWith("NFO:");
                    const label = isOpt ? sym.split(":")[1] : sym;
                    return (
                      <button
                        key={sym}
                        onClick={() => setChartSymbol(sym)}
                        className={cn(
                          "px-3 py-1 text-sm rounded-md border transition-colors",
                          (chartSymbol || allChartSymbols[0]) === sym
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Legend + Indicator toggle + Replay */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  {!replayMode && (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" />
                        Bull Trigger
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500" />
                        Bear Trigger
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent border-b-green-500" />
                        Entry
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
                        Exit
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-6 border-t border-dashed border-green-500" />
                        Win
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-6 border-t border-dashed border-red-500" />
                        Loss
                      </span>
                      {bt.timeframe !== "1d" && (
                        <>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-6 border-t border-dotted border-gray-400" />
                            Pivot
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-6 border-t border-dotted" style={{ borderColor: "rgba(34,197,94,0.6)" }} />
                            TC
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-6 border-t border-dotted" style={{ borderColor: "rgba(239,68,68,0.6)" }} />
                            BC
                          </span>
                        </>
                      )}
                    </>
                  )}
                  {replayMode && (
                    <span className="text-sm font-medium text-purple-400">Replay Mode</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {!replayMode && chartOHLCV.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openBTReplayPicker}
                      className="text-purple-600 border-purple-500/50 hover:bg-purple-500/10 h-8 text-xs"
                    >
                      <Play className="h-3.5 w-3.5 mr-1" />
                      Replay
                    </Button>
                  )}
                  <button
                    onClick={() => setShowGrid(!showGrid)}
                    className={cn(
                      "p-1.5 rounded-md border transition-colors",
                      showGrid
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    )}
                    title={showGrid ? "Hide grid lines" : "Show grid lines"}
                  >
                    <Grid3X3 className="h-4 w-4" />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
                      className={cn(
                        "p-1.5 rounded-md border transition-colors",
                        showIndicatorPanel
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:text-foreground"
                      )}
                      title="Indicators"
                    >
                      <Settings2 className="h-4 w-4" />
                    </button>
                    {showIndicatorPanel && (
                      <IndicatorPanel config={indicators} onChange={setIndicators} onClose={() => setShowIndicatorPanel(false)} />
                    )}
                  </div>
                  {tradeChartObjRef.current && candleSeriesRefBT.current && (
                    <DrawingToolbar chart={tradeChartObjRef.current} series={candleSeriesRefBT.current} storageKey={`bt_chart_drawings_${backtestId}`} />
                  )}
                </div>
              </div>

              {/* Replay controls */}
              {replayMode && (
                <div className="flex items-center gap-3 flex-wrap rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleBTPlay}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={stepBTForward} disabled={isPlaying || replayIndex >= chartOHLCV.length - 1}>
                    <SkipForward className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetBTReplay}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-6 bg-border" />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-1">Speed:</span>
                    {REPLAY_SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setReplaySpeed(s)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          replaySpeed === s ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-6 bg-border" />
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(chartOHLCV.length - 1, 0)}
                      value={replayIndex}
                      onChange={handleBTSeek}
                      className="flex-1 h-1.5 accent-purple-600 cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {replayIndex + 1} / {chartOHLCV.length}
                    </span>
                  </div>
                  <div className="w-px h-6 bg-border" />
                  <Button variant="ghost" size="sm" onClick={exitBTReplay} className="text-xs text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5 mr-1" />
                    Exit Replay
                  </Button>
                </div>
              )}

              {/* Replay start picker modal */}
              {showReplayPicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowReplayPicker(false)}>
                  <div className="bg-card border rounded-lg shadow-lg p-6 w-[380px] space-y-4" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold">Start Replay From</h3>
                    <p className="text-sm text-muted-foreground">
                      Choose where to begin the replay. Data range: {chartOHLCV.length > 0 ? new Date(chartOHLCV[0].time).toLocaleDateString("en-IN") : "—"} to {chartOHLCV.length > 0 ? new Date(chartOHLCV[chartOHLCV.length - 1].time).toLocaleDateString("en-IN") : "—"}
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="bt-replay-date" className="text-xs text-muted-foreground">Date</Label>
                        <Input
                          id="bt-replay-date"
                          type="date"
                          value={replayStartDate}
                          onChange={(e) => setReplayStartDate(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      {bt.timeframe !== "1d" && (
                        <div className="w-28 space-y-1">
                          <Label htmlFor="bt-replay-time" className="text-xs text-muted-foreground">Time</Label>
                          <Input
                            id="bt-replay-time"
                            type="time"
                            value={replayStartTime}
                            onChange={(e) => setReplayStartTime(e.target.value)}
                            className="h-9"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setShowReplayPicker(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button size="sm" onClick={startBTReplayFromPicker} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white">
                        <Play className="h-4 w-4 mr-1" />
                        Start Replay
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <Card>
                <CardContent className="pt-4">
                  {chartLoading ? (
                    <div className="h-[500px] flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : chartOHLCV.length === 0 && !chartLoading ? (
                    <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                      No OHLCV data available for {parseInstrument(chartSymbol || bt.instruments?.[0] || "").symbol || "this instrument"}.
                      Ensure market data has been fetched for this symbol and date range.
                    </div>
                  ) : (
                    <div className="relative">
                      {tradeChartObjRef.current && candleSeriesRefBT.current && (
                        <ChartTooltip chart={tradeChartObjRef.current} candleSeries={candleSeriesRefBT.current} volumeSeries={volumeSeriesRefBT.current} />
                      )}
                      <div ref={tradeChartRef} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Trade summary below chart */}
              {trades.length > 0 && (() => {
                const selRaw = chartSymbol || bt.instruments?.[0] || "";
                const selParsed = parseInstrument(selRaw);
                const isUnder = (bt.instruments || []).some(
                  (inst) => parseInstrument(inst).symbol.toUpperCase() === selParsed.symbol.toUpperCase()
                );
                const tableTrades = isUnder
                  ? trades
                  : trades.filter((t) => t.symbol.toUpperCase() === selParsed.symbol.toUpperCase());
                return (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Trade Signals ({tableTrades.length} trades)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                          <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="pb-2 pr-3 font-medium">#</th>
                              <th className="pb-2 pr-3 font-medium">Side</th>
                              <th className="pb-2 pr-3 font-medium">Symbol</th>
                              <th className="pb-2 pr-3 font-medium">Entry Date</th>
                              <th className="pb-2 pr-3 font-medium text-right">Entry Price</th>
                              <th className="pb-2 pr-3 font-medium">Exit Date</th>
                              <th className="pb-2 pr-3 font-medium text-right">Exit Price</th>
                              <th className="pb-2 pr-3 font-medium text-right">Qty</th>
                              <th className="pb-2 font-medium text-right">Net P&L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableTrades.map((t, i) => {
                              const isLong = t.side === "LONG" || t.side === "BUY";
                              return (
                                <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                                  <td className="py-1.5 pr-3 text-muted-foreground">{i + 1}</td>
                                  <td className={cn("py-1.5 pr-3 font-medium", isLong ? "text-green-500" : "text-red-500")}>
                                    {isLong ? "Long" : "Short"}
                                  </td>
                                  <td className="py-1.5 pr-3 whitespace-nowrap text-xs font-mono">
                                    {t.symbol}
                                  </td>
                                  <td className="py-1.5 pr-3 whitespace-nowrap">
                                    {new Date(t.entry_at).toLocaleString("en-IN", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right">{formatCurrency(t.entry_price)}</td>
                                  <td className="py-1.5 pr-3 whitespace-nowrap">
                                    {t.exit_at
                                      ? new Date(t.exit_at).toLocaleString("en-IN", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
                                      : "Open"}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right">{t.exit_price != null ? formatCurrency(t.exit_price) : "—"}</td>
                                  <td className="py-1.5 pr-3 text-right">{t.quantity}</td>
                                  <td className={cn("py-1.5 text-right font-medium", t.net_pnl != null ? (t.net_pnl >= 0 ? "text-green-500" : "text-red-500") : "")}>
                                    {t.net_pnl != null ? formatCurrency(t.net_pnl) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
          )}

          {/* ============================================================ */}
          {/* LOGS TAB */}
          {/* ============================================================ */}
          {activeTab === "logs" && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Execution Logs</CardTitle>
                <button
                  onClick={() => {
                    setLogsLoading(true);
                    apiClient
                      .get(`/backtests/${backtestId}/logs`)
                      .then((res) => setLogs(res.data || []))
                      .catch(() => setLogs([]))
                      .finally(() => setLogsLoading(false));
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Refresh
                </button>
              </CardHeader>
              <CardContent>
                {logsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : logs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    No logs available. Logs are generated when a backtest runs.
                  </div>
                ) : (
                  <div className="max-h-[600px] overflow-y-auto space-y-1">
                    {logs.map((log, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 py-1.5 px-2 rounded text-[13px] hover:bg-accent/30 font-mono"
                      >
                        <span
                          className={cn(
                            "shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold",
                            log.level === "ERROR"
                              ? "bg-red-500/20 text-red-400"
                              : log.level === "WARNING"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "bg-blue-500/20 text-blue-400"
                          )}
                        >
                          {log.level}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-[11px] min-w-[60px]">
                          {log.source}
                        </span>
                        <span className="flex-1 text-foreground break-all">
                          {log.message}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-[11px] whitespace-nowrap">
                          {log.timestamp
                            ? new Date(log.timestamp).toLocaleString("en-IN", {
                                year: "numeric",
                                month: "short",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false,
                              })
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// CSV Export helpers
// ---------------------------------------------------------------------------
function exportTradesCSV(trades: BacktestTrade[], strategyName: string) {
  const headers = [
    "Trade #", "Side", "Symbol", "Exchange", "Quantity",
    "Entry Date", "Entry Price", "Exit Date", "Exit Price",
    "P&L", "P&L %", "Charges", "Net P&L",
  ];
  const rows = trades.map((t, i) => [
    trades.length - i,
    t.side,
    t.symbol,
    t.exchange,
    t.quantity,
    t.entry_at ? new Date(t.entry_at).toLocaleString("en-IN") : "",
    t.entry_price,
    t.exit_at ? new Date(t.exit_at).toLocaleString("en-IN") : "",
    t.exit_price ?? "",
    t.pnl ?? "",
    t.pnl_percent != null ? `${t.pnl_percent.toFixed(2)}%` : "",
    t.charges,
    t.net_pnl ?? "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadFile(csv, `${strategyName}-trades.csv`, "text/csv");
}

function exportSummaryCSV(bt: any, stats: any) {
  const rows = [
    ["Metric", "Value"],
    ["Strategy", bt.strategy_name || ""],
    ["Instruments", (bt.instruments || []).join(", ")],
    ["Period", `${bt.start_date} to ${bt.end_date}`],
    ["Timeframe", bt.timeframe],
    ["Initial Capital", bt.initial_capital],
    ["Net Profit", bt.total_return != null ? (bt.total_return * bt.initial_capital).toFixed(2) : ""],
    ["Total Return %", bt.total_return != null ? (bt.total_return * 100).toFixed(2) + "%" : ""],
    ["CAGR", bt.cagr != null ? (bt.cagr * 100).toFixed(2) + "%" : ""],
    ["Sharpe Ratio", bt.sharpe_ratio?.toFixed(2) ?? ""],
    ["Sortino Ratio", bt.sortino_ratio?.toFixed(2) ?? ""],
    ["Max Drawdown", bt.max_drawdown != null ? (Math.abs(bt.max_drawdown) * 100).toFixed(2) + "%" : ""],
    ["Total Trades", bt.total_trades ?? ""],
    ["Win Rate", bt.win_rate != null ? (bt.win_rate * 100).toFixed(2) + "%" : ""],
    ["Profit Factor", bt.profit_factor?.toFixed(2) ?? ""],
    ["Avg Trade P&L", bt.avg_trade_pnl?.toFixed(2) ?? ""],
  ];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadFile(csv, `${bt.strategy_name || "backtest"}-summary.csv`, "text/csv");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
    <div className="bg-card border rounded-lg p-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-bold",
          color === "green" ? "text-green-500" : color === "red" ? "text-red-500" : ""
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
  color?: "green" | "red" | "yellow";
}) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-lg font-bold",
          color === "green"
            ? "text-green-500"
            : color === "red"
            ? "text-red-500"
            : color === "yellow"
            ? "text-yellow-500"
            : ""
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    running: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
        colors[status] || "bg-gray-100 text-gray-800"
      )}
    >
      {status === "running" && (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      )}
      {status}
    </span>
  );
}
