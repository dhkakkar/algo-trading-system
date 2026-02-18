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
// Compute trade stats (same logic as backtest page)
// ---------------------------------------------------------------------------
function computeStats(trades: TradingTrade[]) {
  const closed = trades.filter((t) => t.net_pnl != null);
  const wins = closed.filter((t) => (t.net_pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.net_pnl ?? 0) < 0);
  const grossProfit = wins.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
  const grossLoss = Math.abs(
    losses.reduce((s, t) => s + (t.net_pnl ?? 0), 0)
  );

  return {
    total: closed.length,
    winners: wins.length,
    losers: losses.length,
    grossProfit,
    grossLoss,
  };
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
    "overview" | "trades" | "logs"
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

  const stats = useMemo(() => computeStats(trades), [trades]);

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
          sub={`${stats.winners}W / ${stats.losers}L`}
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
          {(["overview", "trades", "logs"] as const).map((tab) => (
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
                    {formatCurrency(stats.grossProfit)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Gross Loss
                  </span>
                  <div className="font-medium text-red-500">
                    {formatCurrency(-stats.grossLoss)}
                  </div>
                </div>
              </div>
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
