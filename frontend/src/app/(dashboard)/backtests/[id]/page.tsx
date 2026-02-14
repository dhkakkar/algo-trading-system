"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useBacktestStore } from "@/stores/backtest-store";
import { connectSocket, getSocket } from "@/lib/socket-client";
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
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  AlertTriangle,
  Activity,
  DollarSign,
  Trophy,
} from "lucide-react";

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
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <Icon className={cn("h-4 w-4", color || "text-muted-foreground")} />
      </div>
      <p className={cn("text-xl font-bold", color)}>{value}</p>
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState<"overview" | "trades">("overview");

  useEffect(() => {
    fetchBacktest(backtestId);
    fetchTrades(backtestId);

    // Socket.IO for live progress if still running
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

      const data = bt.equity_curve.map((p) => ({
        time: p.date as any,
        value: p.value,
      }));

      series.setData(data);
      chart.timeScale().fitContent();

      const handleResize = () => {
        if (equityChartRef.current) {
          chart.applyOptions({
            width: equityChartRef.current.clientWidth,
          });
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

      const data = bt.drawdown_curve.map((p) => ({
        time: p.date as any,
        value: -Math.abs(p.drawdown),
      }));

      series.setData(data);
      chart.timeScale().fitContent();

      const handleResize = () => {
        if (drawdownChartRef.current) {
          chart.applyOptions({
            width: drawdownChartRef.current.clientWidth,
          });
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
            Backtest Results
          </h1>
          <p className="text-muted-foreground text-sm">
            {bt.start_date} → {bt.end_date} · {bt.timeframe} ·{" "}
            {formatCurrency(bt.initial_capital)} capital
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

      {/* Metrics Grid */}
      {bt.status === "completed" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Total Return"
              value={
                bt.total_return != null ? formatPercent(bt.total_return) : "—"
              }
              icon={bt.total_return && bt.total_return >= 0 ? TrendingUp : TrendingDown}
              color={
                bt.total_return != null
                  ? bt.total_return >= 0
                    ? "text-green-600"
                    : "text-red-600"
                  : undefined
              }
            />
            <MetricCard
              label="CAGR"
              value={bt.cagr != null ? formatPercent(bt.cagr) : "—"}
              icon={BarChart3}
              color={
                bt.cagr != null
                  ? bt.cagr >= 0
                    ? "text-green-600"
                    : "text-red-600"
                  : undefined
              }
            />
            <MetricCard
              label="Sharpe Ratio"
              value={bt.sharpe_ratio != null ? bt.sharpe_ratio.toFixed(2) : "—"}
              icon={Target}
              color={
                bt.sharpe_ratio != null
                  ? bt.sharpe_ratio >= 1
                    ? "text-green-600"
                    : bt.sharpe_ratio >= 0
                    ? "text-yellow-600"
                    : "text-red-600"
                  : undefined
              }
            />
            <MetricCard
              label="Max Drawdown"
              value={
                bt.max_drawdown != null
                  ? formatPercent(-Math.abs(bt.max_drawdown))
                  : "—"
              }
              icon={TrendingDown}
              color="text-red-600"
            />
            <MetricCard
              label="Sortino Ratio"
              value={
                bt.sortino_ratio != null ? bt.sortino_ratio.toFixed(2) : "—"
              }
              icon={Activity}
            />
            <MetricCard
              label="Win Rate"
              value={
                bt.win_rate != null ? `${bt.win_rate.toFixed(1)}%` : "—"
              }
              icon={Trophy}
              color={
                bt.win_rate != null
                  ? bt.win_rate >= 50
                    ? "text-green-600"
                    : "text-red-600"
                  : undefined
              }
            />
            <MetricCard
              label="Profit Factor"
              value={
                bt.profit_factor != null ? bt.profit_factor.toFixed(2) : "—"
              }
              icon={DollarSign}
              color={
                bt.profit_factor != null
                  ? bt.profit_factor >= 1
                    ? "text-green-600"
                    : "text-red-600"
                  : undefined
              }
            />
            <MetricCard
              label="Total Trades"
              value={bt.total_trades != null ? String(bt.total_trades) : "—"}
              icon={BarChart3}
            />
          </div>

          {/* Tab Navigation */}
          <div className="border-b">
            <nav className="flex space-x-8">
              <button
                onClick={() => setActiveTab("overview")}
                className={cn(
                  "pb-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "overview"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Charts
              </button>
              <button
                onClick={() => setActiveTab("trades")}
                className={cn(
                  "pb-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "trades"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Trade Log ({trades.length})
              </button>
            </nav>
          </div>

          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Equity Curve */}
              <Card>
                <CardHeader>
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
                <CardHeader>
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

          {activeTab === "trades" && (
            <Card>
              <CardHeader>
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
                          <th className="pb-3 font-medium text-muted-foreground">
                            Symbol
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Side
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Qty
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Entry
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Exit
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            P&L
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            P&L %
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Charges
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Net P&L
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Entry Time
                          </th>
                          <th className="pb-3 font-medium text-muted-foreground">
                            Exit Time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t, i) => (
                          <tr
                            key={i}
                            className="border-b last:border-0 hover:bg-accent/50"
                          >
                            <td className="py-2.5 font-medium">
                              {t.exchange}:{t.symbol}
                            </td>
                            <td className="py-2.5">
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
                            <td className="py-2.5">{t.quantity}</td>
                            <td className="py-2.5">
                              {formatCurrency(t.entry_price)}
                            </td>
                            <td className="py-2.5">
                              {t.exit_price != null
                                ? formatCurrency(t.exit_price)
                                : "Open"}
                            </td>
                            <td
                              className={cn(
                                "py-2.5",
                                t.pnl != null
                                  ? t.pnl >= 0
                                    ? "text-green-600"
                                    : "text-red-600"
                                  : ""
                              )}
                            >
                              {t.pnl != null ? formatCurrency(t.pnl) : "—"}
                            </td>
                            <td
                              className={cn(
                                "py-2.5",
                                t.pnl_percent != null
                                  ? t.pnl_percent >= 0
                                    ? "text-green-600"
                                    : "text-red-600"
                                  : ""
                              )}
                            >
                              {t.pnl_percent != null
                                ? formatPercent(t.pnl_percent)
                                : "—"}
                            </td>
                            <td className="py-2.5 text-muted-foreground">
                              {formatCurrency(t.charges)}
                            </td>
                            <td
                              className={cn(
                                "py-2.5 font-medium",
                                t.net_pnl != null
                                  ? t.net_pnl >= 0
                                    ? "text-green-600"
                                    : "text-red-600"
                                  : ""
                              )}
                            >
                              {t.net_pnl != null
                                ? formatCurrency(t.net_pnl)
                                : "—"}
                            </td>
                            <td className="py-2.5 text-xs text-muted-foreground">
                              {t.entry_at}
                            </td>
                            <td className="py-2.5 text-xs text-muted-foreground">
                              {t.exit_at || "—"}
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
