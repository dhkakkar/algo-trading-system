"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useBacktestStore } from "@/stores/backtest-store";
import { connectSocket } from "@/lib/socket-client";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
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
} from "lucide-react";
import type { BacktestTrade } from "@/types/backtest";

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
        total: 0,
        winners: 0,
        losers: 0,
        winRate: 0,
        grossProfit: 0,
        grossLoss: 0,
        netProfit: 0,
        profitFactor: 0,
        avgTrade: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        maxConsecWins: 0,
        maxConsecLosses: 0,
        totalCharges: 0,
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

    return {
      total: list.length,
      winners: wins.length,
      losers: losses.length,
      winRate: list.length > 0 ? (wins.length / list.length) * 100 : 0,
      grossProfit,
      grossLoss,
      netProfit,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9999 : 0,
      avgTrade: pnls.length > 0 ? netProfit / pnls.length : 0,
      avgWin: winPnls.length > 0 ? grossProfit / winPnls.length : 0,
      avgLoss: lossPnls.length > 0 ? -grossLoss / lossPnls.length : 0,
      largestWin: winPnls.length > 0 ? Math.max(...winPnls) : 0,
      largestLoss: lossPnls.length > 0 ? Math.min(...lossPnls) : 0,
      maxConsecWins: maxW,
      maxConsecLosses: maxL,
      totalCharges,
    };
  }

  return {
    all: analyze(all),
    long: analyze(longTrades),
    short: analyze(shortTrades),
  };
}

// ---------------------------------------------------------------------------
// Stat row component (TradingView style)
// ---------------------------------------------------------------------------
function StatRow({
  label,
  all,
  long,
  short,
  format = "number",
  colorize = false,
}: {
  label: string;
  all: number;
  long: number;
  short: number;
  format?: "currency" | "percent" | "number" | "integer";
  colorize?: boolean;
}) {
  const fmt = (v: number) => {
    if (format === "currency") return formatCurrency(v);
    if (format === "percent") return `${v.toFixed(2)}%`;
    if (format === "integer") return String(Math.round(v));
    return v.toFixed(2);
  };

  const colorFor = (v: number) => {
    if (!colorize) return "";
    if (v > 0) return "text-green-500";
    if (v < 0) return "text-red-500";
    return "";
  };

  return (
    <div className="grid grid-cols-4 py-2 border-b border-border/50 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("text-right font-medium", colorFor(all))}>{fmt(all)}</div>
      <div className={cn("text-right font-medium", colorFor(long))}>{fmt(long)}</div>
      <div className={cn("text-right font-medium", colorFor(short))}>{fmt(short)}</div>
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
  const [activeTab, setActiveTab] = useState<"overview" | "performance" | "trades">("overview");

  // Compute detailed stats from trades
  const stats = useMemo(
    () => computeDetailedStats(trades, bt?.initial_capital ?? 100000),
    [trades, bt?.initial_capital]
  );

  useEffect(() => {
    fetchBacktest(backtestId);
    fetchTrades(backtestId);

    const socket = connectSocket();
    socket.emit("subscribe_backtest", { backtest_id: backtestId });

    socket.on("backtest_progress", (data: any) => {
      if (data.backtest_id === backtestId) {
        setProgress(data.backtest_id, data.percent, data.current_date);
      }
    });

    socket.on("backtest_completed", (data: any) => {
      if (data.backtest_id === backtestId) {
        markCompleted(data.backtest_id);
        fetchBacktest(backtestId);
        fetchTrades(backtestId);
      }
    });

    socket.on("backtest_error", (data: any) => {
      if (data.backtest_id === backtestId) {
        markFailed(data.backtest_id);
        fetchBacktest(backtestId);
      }
    });

    return () => {
      socket.emit("unsubscribe_backtest", { backtest_id: backtestId });
      socket.off("backtest_progress");
      socket.off("backtest_completed");
      socket.off("backtest_error");
    };
  }, [backtestId]);

  // Render equity curve chart
  useEffect(() => {
    if (!bt?.equity_curve?.length || !equityChartRef.current) return;

    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (!equityChartRef.current) return;
      equityChartRef.current.innerHTML = "";

      const chart = createChart(equityChartRef.current, {
        width: equityChartRef.current.clientWidth,
        height: 300,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
        },
        grid: {
          vertLines: { color: "#1f2937" },
          horzLines: { color: "#1f2937" },
        },
        rightPriceScale: { borderColor: "#374151" },
        timeScale: { borderColor: "#374151" },
      });

      const series = chart.addAreaSeries({
        lineColor: "#3b82f6",
        topColor: "rgba(59,130,246,0.3)",
        bottomColor: "rgba(59,130,246,0.02)",
        lineWidth: 2,
      });

      const data = (bt.equity_curve ?? []).map((p) => ({
        time: p.date as any,
        value: p.value,
      }));

      series.setData(data);
      chart.timeScale().fitContent();

      const handleResize = () => {
        if (equityChartRef.current) {
          chart.applyOptions({ width: equityChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", handleResize);

      cleanup = () => {
        window.removeEventListener("resize", handleResize);
        chart.remove();
      };
    });

    return () => cleanup?.();
  }, [bt?.equity_curve]);

  // Render drawdown chart
  useEffect(() => {
    if (!bt?.drawdown_curve?.length || !drawdownChartRef.current) return;

    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (!drawdownChartRef.current) return;
      drawdownChartRef.current.innerHTML = "";

      const chart = createChart(drawdownChartRef.current, {
        width: drawdownChartRef.current.clientWidth,
        height: 200,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
        },
        grid: {
          vertLines: { color: "#1f2937" },
          horzLines: { color: "#1f2937" },
        },
        rightPriceScale: { borderColor: "#374151" },
        timeScale: { borderColor: "#374151" },
      });

      const series = chart.addAreaSeries({
        lineColor: "#ef4444",
        topColor: "rgba(239,68,68,0.02)",
        bottomColor: "rgba(239,68,68,0.3)",
        lineWidth: 2,
        invertFilledArea: true,
      });

      const data = (bt.drawdown_curve ?? []).map((p) => ({
        time: p.date as any,
        value: -Math.abs(p.drawdown),
      }));

      series.setData(data);
      chart.timeScale().fitContent();

      const handleResize = () => {
        if (drawdownChartRef.current) {
          chart.applyOptions({ width: drawdownChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", handleResize);

      cleanup = () => {
        window.removeEventListener("resize", handleResize);
        chart.remove();
      };
    });

    return () => cleanup?.();
  }, [bt?.drawdown_curve]);

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
        <div>
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
              {(["overview", "performance", "trades"] as const).map((tab) => (
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
                  {tab === "overview" ? "Overview" : tab === "performance" ? "Performance Summary" : `Trade Log (${trades.length})`}
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
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Equity Curve</CardTitle>
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
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Drawdown</CardTitle>
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
          {/* PERFORMANCE TAB — TradingView-style detailed stats */}
          {/* ============================================================ */}
          {activeTab === "performance" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Performance Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Column headers */}
                <div className="grid grid-cols-4 py-2 border-b-2 border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <div></div>
                  <div className="text-right">All Trades</div>
                  <div className="text-right">Long Trades</div>
                  <div className="text-right">Short Trades</div>
                </div>

                {/* Profit section */}
                <div className="mt-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-2 border-b border-border">
                    Profitability
                  </div>
                  <StatRow label="Net Profit" all={stats.all.netProfit} long={stats.long.netProfit} short={stats.short.netProfit} format="currency" colorize />
                  <StatRow label="Gross Profit" all={stats.all.grossProfit} long={stats.long.grossProfit} short={stats.short.grossProfit} format="currency" colorize />
                  <StatRow label="Gross Loss" all={-stats.all.grossLoss} long={-stats.long.grossLoss} short={-stats.short.grossLoss} format="currency" colorize />
                  <StatRow label="Profit Factor" all={stats.all.profitFactor} long={stats.long.profitFactor} short={stats.short.profitFactor} />
                  <StatRow label="Total Charges" all={stats.all.totalCharges} long={stats.long.totalCharges} short={stats.short.totalCharges} format="currency" />
                </div>

                {/* Trade counts */}
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-2 border-b border-border">
                    Trades
                  </div>
                  <StatRow label="Total Trades" all={stats.all.total} long={stats.long.total} short={stats.short.total} format="integer" />
                  <StatRow label="Winning Trades" all={stats.all.winners} long={stats.long.winners} short={stats.short.winners} format="integer" />
                  <StatRow label="Losing Trades" all={stats.all.losers} long={stats.long.losers} short={stats.short.losers} format="integer" />
                  <StatRow label="Win Rate" all={stats.all.winRate} long={stats.long.winRate} short={stats.short.winRate} format="percent" />
                </div>

                {/* Trade analysis */}
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-2 border-b border-border">
                    Trade Analysis
                  </div>
                  <StatRow label="Avg Trade" all={stats.all.avgTrade} long={stats.long.avgTrade} short={stats.short.avgTrade} format="currency" colorize />
                  <StatRow label="Avg Winning Trade" all={stats.all.avgWin} long={stats.long.avgWin} short={stats.short.avgWin} format="currency" colorize />
                  <StatRow label="Avg Losing Trade" all={stats.all.avgLoss} long={stats.long.avgLoss} short={stats.short.avgLoss} format="currency" colorize />
                  <StatRow label="Largest Win" all={stats.all.largestWin} long={stats.long.largestWin} short={stats.short.largestWin} format="currency" colorize />
                  <StatRow label="Largest Loss" all={stats.all.largestLoss} long={stats.long.largestLoss} short={stats.short.largestLoss} format="currency" colorize />
                </div>

                {/* Streaks */}
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-2 border-b border-border">
                    Streaks
                  </div>
                  <StatRow label="Max Consecutive Wins" all={stats.all.maxConsecWins} long={stats.long.maxConsecWins} short={stats.short.maxConsecWins} format="integer" />
                  <StatRow label="Max Consecutive Losses" all={stats.all.maxConsecLosses} long={stats.long.maxConsecLosses} short={stats.short.maxConsecLosses} format="integer" />
                </div>

                {/* Risk metrics (from backend) */}
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-2 border-b border-border">
                    Risk Metrics
                  </div>
                  <div className="grid grid-cols-4 py-2 border-b border-border/50 text-sm">
                    <div className="text-muted-foreground">Max Drawdown</div>
                    <div className="text-right font-medium text-red-500 col-span-3">
                      {bt.max_drawdown != null ? `${(Math.abs(bt.max_drawdown) * 100).toFixed(2)}%` : "—"}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 py-2 border-b border-border/50 text-sm">
                    <div className="text-muted-foreground">Sharpe Ratio</div>
                    <div className="text-right font-medium col-span-3">
                      {bt.sharpe_ratio?.toFixed(4) ?? "—"}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 py-2 border-b border-border/50 text-sm">
                    <div className="text-muted-foreground">Sortino Ratio</div>
                    <div className="text-right font-medium col-span-3">
                      {bt.sortino_ratio?.toFixed(4) ?? "—"}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 py-2 border-b border-border/50 text-sm">
                    <div className="text-muted-foreground">CAGR</div>
                    <div className="text-right font-medium col-span-3">
                      {bt.cagr != null ? formatPercent(bt.cagr * 100) : "—"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ============================================================ */}
          {/* TRADES TAB — Trade log table */}
          {/* ============================================================ */}
          {activeTab === "trades" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Trade Log</CardTitle>
              </CardHeader>
              <CardContent>
                {trades.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground">
                    No trades recorded
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">#</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Symbol</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Side</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Qty</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Entry Price</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Exit Price</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">P&L</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">P&L %</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Charges</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Net P&L</th>
                          <th className="pb-3 pr-3 font-medium text-muted-foreground">Entry Time</th>
                          <th className="pb-3 font-medium text-muted-foreground">Exit Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t, i) => (
                          <tr
                            key={i}
                            className="border-b last:border-0 hover:bg-accent/50"
                          >
                            <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 pr-3 font-medium">
                              {t.exchange}:{t.symbol}
                            </td>
                            <td className="py-2 pr-3">
                              <span
                                className={cn(
                                  "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                                  t.side === "LONG" || t.side === "BUY"
                                    ? "bg-green-100 text-green-800"
                                    : "bg-red-100 text-red-800"
                                )}
                              >
                                {t.side}
                              </span>
                            </td>
                            <td className="py-2 pr-3">{t.quantity}</td>
                            <td className="py-2 pr-3">{formatCurrency(t.entry_price)}</td>
                            <td className="py-2 pr-3">
                              {t.exit_price != null ? formatCurrency(t.exit_price) : "Open"}
                            </td>
                            <td className={cn("py-2 pr-3", t.pnl != null ? (t.pnl >= 0 ? "text-green-500" : "text-red-500") : "")}>
                              {t.pnl != null ? formatCurrency(t.pnl) : "—"}
                            </td>
                            <td className={cn("py-2 pr-3", t.pnl_percent != null ? (t.pnl_percent >= 0 ? "text-green-500" : "text-red-500") : "")}>
                              {t.pnl_percent != null ? formatPercent(t.pnl_percent) : "—"}
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {formatCurrency(t.charges)}
                            </td>
                            <td className={cn("py-2 pr-3 font-medium", t.net_pnl != null ? (t.net_pnl >= 0 ? "text-green-500" : "text-red-500") : "")}>
                              {t.net_pnl != null ? formatCurrency(t.net_pnl) : "—"}
                            </td>
                            <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                              {t.entry_at ? new Date(t.entry_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}
                            </td>
                            <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                              {t.exit_at ? new Date(t.exit_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
