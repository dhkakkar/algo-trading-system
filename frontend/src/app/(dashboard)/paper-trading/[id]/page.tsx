"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTradingStore } from "@/stores/trading-store";
import { connectSocket } from "@/lib/socket-client";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Pause,
  Trash2,
  ArrowLeft,
  Loader2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  AlertTriangle,
  ExternalLink,
  Edit2,
  X,
  Check,
} from "lucide-react";
import type { TradingOrder, TradingTrade, TradingSnapshot, SessionRunListItem } from "@/types/trading";
import apiClient from "@/lib/api-client";
import { useToastStore } from "@/stores/toast-store";
import LiveChart from "@/components/charts/live-chart";
import type { ChartMarker } from "@/components/charts/chart-indicators";

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    stopped: "bg-gray-100 text-gray-800",
    running: "bg-green-100 text-green-800",
    paused: "bg-yellow-100 text-yellow-800",
    error: "bg-red-100 text-red-800",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
        colors[status] || "bg-gray-100 text-gray-800"
      )}
    >
      {status === "running" && (
        <span className="relative flex h-2 w-2 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
      )}
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------
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
    <div className="bg-card border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <Icon className={cn("h-3.5 w-3.5", color || "text-muted-foreground")} />
      </div>
      <p className={cn("text-lg font-bold", color)}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function PaperTradingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const {
    currentSession: session,
    snapshot,
    loading,
    error,
    snapshotError,
    fetchSession,
    fetchSnapshot,
    setSnapshot,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    deleteSession,
    clearError,
  } = useTradingStore();

  const addToast = useToastStore((s) => s.addToast);

  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "trades" | "logs" | "runs">(
    "positions"
  );
  const [orders, setOrders] = useState<TradingOrder[]>([]);
  const [trades, setTrades] = useState<TradingTrade[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runs, setRuns] = useState<SessionRunListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // SL/TP editing state
  const [editingSLTP, setEditingSLTP] = useState<string | null>(null); // symbol being edited
  const [editSL, setEditSL] = useState("");
  const [editTP, setEditTP] = useState("");
  const [slTpSaving, setSlTpSaving] = useState(false);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  // Broker status
  const [brokerStatus, setBrokerStatus] = useState<{
    connected: boolean;
    token_valid?: boolean;
    token_expiry?: string | null;
    login_url?: string | null;
  } | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSnapshotErrorRef = useRef<string | null>(null);

  // Fetch session data
  useEffect(() => {
    fetchSession(sessionId);
    fetchSnapshot(sessionId);
  }, [sessionId]);

  // Check broker status on mount
  useEffect(() => {
    apiClient
      .get("/broker/status", { _suppressToast: true } as any)
      .then((res) => setBrokerStatus(res.data))
      .catch(() => setBrokerStatus({ connected: false }));
  }, []);

  // Show toast on snapshot errors (only on first occurrence / change)
  useEffect(() => {
    if (snapshotError && snapshotError !== lastSnapshotErrorRef.current) {
      addToast("error", snapshotError);
    }
    lastSnapshotErrorRef.current = snapshotError;
  }, [snapshotError, addToast]);

  // Polling for snapshot when session is running
  useEffect(() => {
    if (session?.status === "running") {
      pollingRef.current = setInterval(() => {
        fetchSnapshot(sessionId);
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [session?.status, sessionId]);

  // Socket.IO listener for real-time trading updates
  useEffect(() => {
    const socket = connectSocket();

    socket.emit("subscribe_trading", { session_id: sessionId });

    const handleTradingUpdate = (data: TradingSnapshot) => {
      if (data.session_id === sessionId) {
        setSnapshot(data);
      }
    };

    socket.on("trading_update", handleTradingUpdate);

    return () => {
      socket.emit("unsubscribe_trading", { session_id: sessionId });
      socket.off("trading_update", handleTradingUpdate);
    };
  }, [sessionId]);

  // Fetch orders when tab switches to orders
  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await apiClient.get(`/trading/sessions/${sessionId}/orders`);
      setOrders(res.data);
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [sessionId]);

  // Fetch trades when tab switches to trades
  const fetchTrades = useCallback(async () => {
    setTradesLoading(true);
    try {
      const res = await apiClient.get(`/trading/sessions/${sessionId}/trades`);
      setTrades(res.data);
    } catch {
      setTrades([]);
    } finally {
      setTradesLoading(false);
    }
  }, [sessionId]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await apiClient.get(`/trading/sessions/${sessionId}/logs?limit=500`);
      setLogs(res.data);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [sessionId]);

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await apiClient.get(`/trading/sessions/${sessionId}/runs`);
      setRuns(res.data);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (activeTab === "orders") fetchOrders();
    else if (activeTab === "trades") fetchTrades();
    else if (activeTab === "logs") fetchLogs();
    else if (activeTab === "runs") fetchRuns();
  }, [activeTab, fetchOrders, fetchTrades, fetchLogs, fetchRuns]);

  // Fetch orders + trades + logs for chart markers (separate from tab-display fetching)
  const [chartTrades, setChartTrades] = useState<TradingTrade[]>([]);
  const [chartOrders, setChartOrders] = useState<TradingOrder[]>([]);
  const [chartLogs, setChartLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchForChart = async () => {
      try {
        const [tradesRes, ordersRes, logsRes] = await Promise.all([
          apiClient.get(`/trading/sessions/${sessionId}/trades`, { _suppressToast: true } as any),
          apiClient.get(`/trading/sessions/${sessionId}/orders`, { _suppressToast: true } as any),
          apiClient.get(`/trading/sessions/${sessionId}/logs?limit=500`, { _suppressToast: true } as any),
        ]);
        setChartTrades(tradesRes.data || []);
        setChartOrders(ordersRes.data || []);
        setChartLogs(logsRes.data || []);
      } catch {
        // silently fail — chart markers are supplementary
      }
    };
    fetchForChart();

    if (session?.status === "running") {
      const interval = setInterval(fetchForChart, 15000);
      return () => clearInterval(interval);
    }
  }, [sessionId, session?.status]);

  // Build chart markers from orders + trades + logs
  const chartMarkers = useMemo<ChartMarker[]>(() => {
    const m: ChartMarker[] = [];

    // Entry/exit markers from filled orders (appear immediately, even while position is open)
    const filledOrders = chartOrders.filter((o) => o.status === "COMPLETE" && o.filled_at);
    filledOrders.forEach((order, i) => {
      const sym = (order.tradingsymbol || "").toUpperCase();
      const optType = sym.endsWith("CE") ? "CE" : sym.endsWith("PE") ? "PE" : "";
      const isBuy = order.transaction_type === "BUY";
      const orderNum = i + 1;
      const time = order.filled_at!;

      // Determine if this is an entry or exit based on order_type
      // SL/SL-M orders are exits (stop loss hit), plain MARKET/LIMIT on option are entries
      const isSLOrder = order.order_type === "SL" || order.order_type === "SL-M";

      if (isSLOrder) {
        // Exit marker (SL hit)
        m.push({
          time,
          position: isBuy ? "belowBar" : "aboveBar",
          color: "#ef4444",
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: `Exit${optType ? ` ${optType}` : ""} #${orderNum}`,
        });
      } else {
        // Entry marker
        m.push({
          time,
          position: isBuy ? "belowBar" : "aboveBar",
          color: "#22c55e",
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: optType
            ? `${isBuy ? "Buy" : "Sell"} ${optType} #${orderNum}`
            : `${isBuy ? "Buy" : "Sell"} #${orderNum}`,
        });
      }
    });

    // Also add exit markers from completed trades (for TP exits / manual closes that aren't SL)
    chartTrades.forEach((t, i) => {
      if (t.exit_at) {
        const isLong = t.side === "LONG" || t.side === "BUY";
        m.push({
          time: t.exit_at,
          position: isLong ? "aboveBar" : "belowBar",
          color: "#ef4444",
          shape: isLong ? "arrowDown" : "arrowUp",
          text: `Exit #${i + 1}`,
        });
      }
    });

    // Trigger markers from strategy logs
    chartLogs.forEach((log) => {
      if (!log.timestamp) return;
      if (log.message?.startsWith("BULL TRIGGER NEGATED") || log.message?.startsWith("Bull trigger INVALIDATED")) {
        m.push({ time: log.timestamp, position: "belowBar", color: "#6b7280", shape: "circle", text: "X Bull" });
      } else if (log.message?.startsWith("BEAR TRIGGER NEGATED") || log.message?.startsWith("Bear trigger INVALIDATED")) {
        m.push({ time: log.timestamp, position: "aboveBar", color: "#6b7280", shape: "circle", text: "X Bear" });
      } else if (log.message?.startsWith("BULL TRIGGER")) {
        m.push({ time: log.timestamp, position: "belowBar", color: "#3b82f6", shape: "circle", text: "Bull" });
      } else if (log.message?.startsWith("BEAR TRIGGER")) {
        m.push({ time: log.timestamp, position: "aboveBar", color: "#f97316", shape: "circle", text: "Bear" });
      } else if (log.message?.includes("rejected") || log.message?.startsWith("ORDER REJECTED")) {
        m.push({ time: log.timestamp, position: "aboveBar", color: "#ef4444", shape: "square", text: "REJECTED" });
      }
    });

    return m;
  }, [chartOrders, chartTrades, chartLogs]);

  const handleClosePosition = async (symbol: string) => {
    setClosingPosition(symbol);
    try {
      await apiClient.post(`/trading/sessions/${sessionId}/close-position`, { symbol });
      addToast("success", `Close order placed for ${symbol}`);
      fetchSnapshot(sessionId);
    } catch (e: any) {
      addToast("error", e?.response?.data?.detail || "Failed to close position");
    } finally {
      setClosingPosition(null);
    }
  };

  const handleSaveSLTP = async (symbol: string) => {
    setSlTpSaving(true);
    try {
      const payload: any = { symbol };
      if (editSL.trim()) payload.sl_price = parseFloat(editSL);
      if (editTP.trim()) payload.tp_price = parseFloat(editTP);
      await apiClient.patch(`/trading/sessions/${sessionId}/modify-sl-tp`, payload);
      addToast("success", "SL/TP updated");
      setEditingSLTP(null);
      fetchSnapshot(sessionId);
    } catch (e: any) {
      addToast("error", e?.response?.data?.detail || "Failed to update SL/TP");
    } finally {
      setSlTpSaving(false);
    }
  };

  const startEditSLTP = (pos: any) => {
    setEditingSLTP(pos.symbol);
    setEditSL(pos.sl_price != null ? String(pos.sl_price) : "");
    setEditTP(pos.tp_price != null ? String(pos.tp_price) : "");
  };

  const handleStart = async () => { await startSession(sessionId); fetchSnapshot(sessionId); };
  const handleStop = async () => { await stopSession(sessionId); };
  const handlePause = async () => { await pauseSession(sessionId); };
  const handleResume = async () => { await resumeSession(sessionId); fetchSnapshot(sessionId); };
  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this session? This cannot be undone.")) return;
    try {
      await deleteSession(sessionId);
      addToast("success", "Paper trading session deleted");
      router.push("/paper-trading");
    } catch {
      addToast("error", "Failed to delete session");
    }
  };

  // Loading state
  if (loading && !session) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error / not found state
  if (error || !session) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push("/paper-trading")} className="flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Paper Trading
        </button>
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">{error || "Session not found"}</div>
      </div>
    );
  }

  const pnlColor = snapshot && snapshot.total_pnl >= 0 ? "text-green-600" : "text-red-600";
  const isRunning = session.status === "running";

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <button onClick={() => router.push("/paper-trading")} className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Paper Trading
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Paper Trading Session</h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Strategy: {session.strategy_name || session.strategy_id.slice(0, 8)} v{session.strategy_version} &middot;{" "}
            {session.instruments.join(", ")} &middot; {session.timeframe} &middot;{" "}
            {formatCurrency(session.initial_capital)} capital
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(session.status === "stopped" || session.status === "error") && (
            <>
              <Button onClick={handleStart} size="sm"><Play className="h-4 w-4 mr-2" />Start</Button>
              <Button onClick={handleDelete} variant="destructive" size="sm"><Trash2 className="h-4 w-4 mr-2" />Delete</Button>
            </>
          )}
          {session.status === "running" && (
            <>
              <Button onClick={handlePause} variant="outline" size="sm"><Pause className="h-4 w-4 mr-2" />Pause</Button>
              <Button onClick={handleStop} variant="destructive" size="sm"><Square className="h-4 w-4 mr-2" />Stop</Button>
            </>
          )}
          {session.status === "paused" && (
            <>
              <Button onClick={handleResume} size="sm"><Play className="h-4 w-4 mr-2" />Resume</Button>
              <Button onClick={handleStop} variant="destructive" size="sm"><Square className="h-4 w-4 mr-2" />Stop</Button>
            </>
          )}
        </div>
      </div>

      {/* Error message */}
      {session.status === "error" && session.error_message && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 flex-shrink-0">
          <p className="font-medium text-red-800">Session Error</p>
          <p className="text-sm text-red-700 mt-1">{session.error_message}</p>
        </div>
      )}

      {/* Broker / API token warning */}
      {brokerStatus && !brokerStatus.connected && (
        <div className="rounded-md bg-yellow-950 border border-yellow-800 p-3 flex items-center gap-3 flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-yellow-400">Broker not connected</span>
            <span className="text-yellow-500 ml-1">— Kite API token is missing or expired. Live market data will not be available.</span>
          </div>
          <button onClick={() => router.push("/settings")} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 font-medium flex-shrink-0">
            Settings <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
      {brokerStatus?.connected && brokerStatus.token_expiry && new Date(brokerStatus.token_expiry) < new Date() && (
        <div className="rounded-md bg-yellow-950 border border-yellow-800 p-3 flex items-center gap-3 flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-yellow-400">API token expired</span>
            <span className="text-yellow-500 ml-1">— Your Kite API token has expired. Please re-authenticate to get live data.</span>
          </div>
          <button onClick={() => router.push("/settings")} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 font-medium flex-shrink-0">
            Settings <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Snapshot error banner */}
      {snapshotError && isRunning && (
        <div className="rounded-md bg-red-950 border border-red-800 p-3 flex items-center gap-3 flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <div className="flex-1 text-sm text-red-300"><span className="font-medium">Data error:</span> {snapshotError}</div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
        <MetricCard label="Portfolio Value" value={snapshot ? formatCurrency(snapshot.portfolio_value) : formatCurrency(session.initial_capital)} icon={DollarSign}
          color={snapshot ? (snapshot.portfolio_value >= session.initial_capital ? "text-green-600" : "text-red-600") : undefined} />
        <MetricCard label="Cash" value={snapshot ? formatCurrency(snapshot.cash) : formatCurrency(session.initial_capital)} icon={DollarSign} />
        <MetricCard label="Total P&L" value={snapshot ? formatCurrency(snapshot.total_pnl) : formatCurrency(0)}
          icon={snapshot && snapshot.total_pnl >= 0 ? TrendingUp : TrendingDown} color={snapshot ? pnlColor : undefined} />
        <MetricCard label="Total Trades" value={snapshot ? formatNumber(snapshot.total_trades) : "0"} icon={BarChart3} />
      </div>

      {/* Main area: Chart + Data Panel */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chart (left) */}
        <div className="flex-[2] min-w-0 border rounded-lg bg-[#09090b] relative">
          <LiveChart
            instruments={session.instruments}
            sessionTimeframe={session.timeframe}
            snapshot={snapshot}
            isRunning={isRunning}
            brokerConnected={brokerStatus === null ? null : (brokerStatus.connected && brokerStatus.token_valid !== false)}
            markers={chartMarkers}
          />
        </div>

        {/* Data Panel (right) */}
        <div className="flex-1 min-w-[320px] flex flex-col min-h-0">
          {/* Tab Navigation */}
          <div className="border-b flex-shrink-0">
            <nav className="flex">
              {(["positions", "orders", "trades", "logs", "runs"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex-1 pb-2 text-xs font-medium border-b-2 transition-colors capitalize text-center",
                    activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab}
                  {tab === "positions" && snapshot && snapshot.positions.length > 0 && (
                    <span className="ml-1 text-[10px] bg-accent text-accent-foreground px-1 py-0.5 rounded-full">{snapshot.positions.length}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Positions Tab */}
            {activeTab === "positions" && (
              <div className="p-2">
                {!snapshot || snapshot.positions.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No open positions</div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.positions.map((pos, i) => (
                      <div key={`${pos.symbol}-${pos.exchange}-${i}`} className="border rounded-md p-2.5 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{pos.exchange}:{pos.symbol}</span>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", pos.side === "LONG" || pos.side === "BUY" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>{pos.side}</span>
                          </div>
                          <span className="text-muted-foreground text-xs">Qty: {pos.quantity}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Avg: {formatCurrency(pos.avg_price)} &rarr; {formatCurrency(pos.current_price)}</span>
                          <span className={cn("font-medium", pos.unrealized_pnl >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(pos.unrealized_pnl)} ({formatPercent(pos.pnl_percent)})
                          </span>
                        </div>
                        {/* SL / TP display or edit */}
                        {editingSLTP === pos.symbol ? (
                          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                            <label className="text-muted-foreground">SL:</label>
                            <input type="number" step="any" value={editSL} onChange={(e) => setEditSL(e.target.value)}
                              className="w-20 px-1.5 py-0.5 rounded border bg-background text-xs" placeholder="Price" />
                            <label className="text-muted-foreground ml-1">TP:</label>
                            <input type="number" step="any" value={editTP} onChange={(e) => setEditTP(e.target.value)}
                              className="w-20 px-1.5 py-0.5 rounded border bg-background text-xs" placeholder="Price" />
                            <button onClick={() => handleSaveSLTP(pos.symbol)} disabled={slTpSaving}
                              className="p-0.5 rounded hover:bg-green-500/20 text-green-500">
                              {slTpSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => setEditingSLTP(null)} className="p-0.5 rounded hover:bg-red-500/20 text-red-400">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="mt-1.5 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-3">
                              <span className="text-muted-foreground">
                                SL: <span className={pos.sl_price != null ? "text-red-400 font-medium" : "opacity-50"}>
                                  {pos.sl_price != null ? formatCurrency(pos.sl_price) : "—"}
                                </span>
                              </span>
                              <span className="text-muted-foreground">
                                TP: <span className={pos.tp_price != null ? "text-green-400 font-medium" : "opacity-50"}>
                                  {pos.tp_price != null ? formatCurrency(pos.tp_price) : "—"}
                                </span>
                              </span>
                              {isRunning && (
                                <button onClick={() => startEditSLTP(pos)} className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Edit SL/TP">
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {isRunning && (
                              confirmClose === pos.symbol ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => { setConfirmClose(null); handleClosePosition(pos.symbol); }}
                                    disabled={closingPosition === pos.symbol}
                                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/30 text-red-400 hover:bg-red-500/40 disabled:opacity-50">
                                    {closingPosition === pos.symbol ? "Closing..." : "Confirm"}
                                  </button>
                                  <button onClick={() => setConfirmClose(null)}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground">
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => setConfirmClose(pos.symbol)}
                                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                  Close
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Orders Tab */}
            {activeTab === "orders" && (
              <div className="p-2">
                {ordersLoading ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : orders.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No orders placed</div>
                ) : (
                  <div className="space-y-1.5">
                    {[...orders].reverse().map((order) => (
                      <div key={order.id} className="border rounded-md p-2 text-xs">
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", order.transaction_type === "BUY" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>{order.transaction_type}</span>
                            <span className="font-medium">{order.tradingsymbol}</span>
                            <span className="text-muted-foreground">x{order.quantity}</span>
                          </div>
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium capitalize", order.status === "COMPLETE" ? "bg-green-100 text-green-800" : order.status === "REJECTED" || order.status === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800")}>{order.status}</span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>{order.order_type} @ {order.average_price != null ? formatCurrency(order.average_price) : "Market"}</span>
                          <span>{new Date(order.placed_at).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Trades Tab */}
            {activeTab === "trades" && (
              <div className="p-2">
                {tradesLoading ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : trades.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No trades recorded</div>
                ) : (
                  <div className="space-y-1.5">
                    {[...trades].reverse().map((t) => (
                      <div key={t.id} className="border rounded-md p-2 text-xs">
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", t.side === "LONG" || t.side === "BUY" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>{t.side}</span>
                            <span className="font-medium">{t.tradingsymbol}</span>
                            <span className="text-muted-foreground">x{t.quantity}</span>
                          </div>
                          <span className={cn("font-semibold", t.net_pnl != null ? (t.net_pnl >= 0 ? "text-green-600" : "text-red-600") : "")}>{t.net_pnl != null ? formatCurrency(t.net_pnl) : "--"}</span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>{formatCurrency(t.entry_price)} &rarr; {t.exit_price != null ? formatCurrency(t.exit_price) : "Open"}</span>
                          <span>{t.pnl_percent != null ? formatPercent(t.pnl_percent) : "--"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Logs Tab */}
            {activeTab === "logs" && (
              <div className="p-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{logs.length} log entries</span>
                  <button onClick={fetchLogs} className="text-xs text-primary hover:underline">Refresh</button>
                </div>
                {logsLoading ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : logs.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No logs yet</div>
                ) : (
                  <div className="space-y-0.5 font-mono text-[11px]">
                    {logs.map((log) => (
                      <div key={log.id} className={cn(
                        "px-2 py-1 rounded flex gap-2",
                        log.level === "ERROR" ? "bg-red-500/10 text-red-400" :
                        log.level === "WARNING" ? "bg-yellow-500/10 text-yellow-400" :
                        "text-muted-foreground"
                      )}>
                        <span className="text-[10px] opacity-60 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span className={cn(
                          "text-[10px] px-1 rounded shrink-0",
                          log.level === "ERROR" ? "bg-red-500/20 text-red-400" :
                          log.level === "WARNING" ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-blue-500/10 text-blue-400"
                        )}>{log.level}</span>
                        <span className="text-[10px] px-1 rounded bg-accent/50 shrink-0">{log.source}</span>
                        <span className="break-all">{log.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "runs" && (
              <div className="p-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{runs.length} run(s)</span>
                  <button onClick={fetchRuns} className="text-xs text-primary hover:underline">Refresh</button>
                </div>
                {runsLoading ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : runs.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No runs yet. Start and stop the session to create a run.</div>
                ) : (
                  <div className="space-y-1.5">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="border rounded-md p-2.5 text-sm hover:bg-accent/30 cursor-pointer transition-colors"
                        onClick={() => router.push(`/paper-trading/${sessionId}/runs/${run.id}`)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Run #{run.run_number}</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                              run.status === "completed" ? "bg-green-100 text-green-800" :
                              run.status === "running" ? "bg-blue-100 text-blue-800" :
                              "bg-red-100 text-red-800"
                            )}>{run.status}</span>
                          </div>
                          <span className="text-xs text-primary hover:underline">View Report</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {new Date(run.started_at).toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}
                            {run.stopped_at && ` - ${new Date(run.stopped_at).toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}`}
                          </span>
                          <div className="flex items-center gap-3">
                            <span>{run.total_trades ?? 0} trades</span>
                            {run.total_return != null && (
                              <span className={cn("font-medium", run.total_return >= 0 ? "text-green-600" : "text-red-600")}>
                                {(run.total_return * 100).toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
