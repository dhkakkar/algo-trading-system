"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTradingStore } from "@/stores/trading-store";
import { connectSocket } from "@/lib/socket-client";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Pause,
  Trash2,
  ArrowLeft,
  Loader2,
  Activity,
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import type { TradingOrder, TradingTrade, TradingSnapshot } from "@/types/trading";
import apiClient from "@/lib/api-client";
import { useToastStore } from "@/stores/toast-store";
import { ExternalLink } from "lucide-react";
import LiveChart from "@/components/charts/live-chart";

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

export default function LiveTradingDetailPage() {
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

  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "trades">(
    "positions"
  );
  const [orders, setOrders] = useState<TradingOrder[]>([]);
  const [trades, setTrades] = useState<TradingTrade[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [squareOffLoading, setSquareOffLoading] = useState(false);
  const [showSquareOffConfirm, setShowSquareOffConfirm] = useState(false);

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
      const res = await apiClient.get(
        `/trading/sessions/${sessionId}/orders`
      );
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
      const res = await apiClient.get(
        `/trading/sessions/${sessionId}/trades`
      );
      setTrades(res.data);
    } catch {
      setTrades([]);
    } finally {
      setTradesLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (activeTab === "orders") {
      fetchOrders();
    } else if (activeTab === "trades") {
      fetchTrades();
    }
  }, [activeTab, fetchOrders, fetchTrades]);

  const handleStart = async () => {
    await startSession(sessionId);
    fetchSnapshot(sessionId);
  };

  const handleStop = async () => {
    await stopSession(sessionId);
  };

  const handlePause = async () => {
    await pauseSession(sessionId);
  };

  const handleResume = async () => {
    await resumeSession(sessionId);
    fetchSnapshot(sessionId);
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this live trading session? This action cannot be undone.")) {
      await deleteSession(sessionId);
      router.push("/live-trading");
    }
  };

  const handleSquareOff = async () => {
    setSquareOffLoading(true);
    try {
      await apiClient.post(`/trading/sessions/${sessionId}/square-off`);
      setShowSquareOffConfirm(false);
      // Refresh session and snapshot after square off
      fetchSession(sessionId);
      fetchSnapshot(sessionId);
    } catch (err: any) {
      // Show error via the store
      useTradingStore.setState({
        error: err.response?.data?.detail || "Failed to square off positions",
      });
    } finally {
      setSquareOffLoading(false);
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
        <button
          onClick={() => router.push("/live-trading")}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Live Trading
        </button>
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
          {error || "Session not found"}
        </div>
      </div>
    );
  }

  const pnlColor =
    snapshot && snapshot.total_pnl >= 0 ? "text-green-600" : "text-red-600";
  const isRunning = session.status === "running";

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push("/live-trading")}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Live Trading
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Live Trading Session
            </h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Strategy: {session.strategy_id.slice(0, 8)}... v
            {session.strategy_version} &middot;{" "}
            {session.instruments.join(", ")} &middot; {session.timeframe} &middot;{" "}
            {formatCurrency(session.initial_capital)} capital
          </p>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2">
          {(session.status === "stopped" || session.status === "error") && (
            <>
              <Button onClick={handleStart} size="sm">
                <Play className="h-4 w-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={handleDelete}
                variant="destructive"
                size="sm"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </>
          )}
          {session.status === "running" && (
            <>
              <Button
                onClick={handlePause}
                variant="outline"
                size="sm"
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
              <Button
                onClick={handleStop}
                variant="destructive"
                size="sm"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </>
          )}
          {session.status === "paused" && (
            <>
              <Button onClick={handleResume} size="sm">
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
              <Button
                onClick={handleStop}
                variant="destructive"
                size="sm"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Emergency Square Off - visible when running */}
      {session.status === "running" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-800">Emergency Square Off</p>
                <p className="text-sm text-red-700 mt-0.5">
                  Instantly close all open positions at market price. Use only in emergencies.
                </p>
              </div>
            </div>
            {!showSquareOffConfirm ? (
              <Button
                onClick={() => setShowSquareOffConfirm(true)}
                variant="destructive"
                size="sm"
                className="flex-shrink-0"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Square Off All
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-xs text-red-700 font-medium mr-2 max-w-48">
                  This will close ALL open positions at market price.
                </div>
                <Button
                  onClick={() => setShowSquareOffConfirm(false)}
                  variant="outline"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSquareOff}
                  variant="destructive"
                  size="sm"
                  disabled={squareOffLoading}
                >
                  {squareOffLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mr-2" />
                  )}
                  Confirm Square Off
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {session.status === "error" && session.error_message && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="font-medium text-red-800">Session Error</p>
          <p className="text-sm text-red-700 mt-1">{session.error_message}</p>
        </div>
      )}

      {/* Broker / API token warning */}
      {brokerStatus && !brokerStatus.connected && (
        <div className="rounded-md bg-yellow-950 border border-yellow-800 p-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-yellow-400">Broker not connected</span>
            <span className="text-yellow-500 ml-1">
              — Kite API token is missing or expired. Live trading requires a valid broker connection.
            </span>
          </div>
          <button
            onClick={() => router.push("/settings")}
            className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 font-medium flex-shrink-0"
          >
            Settings <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
      {brokerStatus?.connected && brokerStatus.token_expiry && new Date(brokerStatus.token_expiry) < new Date() && (
        <div className="rounded-md bg-yellow-950 border border-yellow-800 p-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-yellow-400">API token expired</span>
            <span className="text-yellow-500 ml-1">
              — Your Kite API token has expired. Please re-authenticate to continue live trading.
            </span>
          </div>
          <button
            onClick={() => router.push("/settings")}
            className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 font-medium flex-shrink-0"
          >
            Settings <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Snapshot error banner */}
      {snapshotError && session.status === "running" && (
        <div className="rounded-md bg-red-950 border border-red-800 p-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <div className="flex-1 text-sm text-red-300">
            <span className="font-medium">Data error:</span> {snapshotError}
          </div>
        </div>
      )}

      {/* Risk Settings Info Card */}
      {session.parameters && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              Risk Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {session.parameters.max_loss_per_trade != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Max Loss/Trade</span>
                  <p className="font-medium mt-0.5">{formatCurrency(session.parameters.max_loss_per_trade)}</p>
                </div>
              )}
              {session.parameters.max_daily_loss != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Max Daily Loss</span>
                  <p className="font-medium mt-0.5">{formatCurrency(session.parameters.max_daily_loss)}</p>
                </div>
              )}
              {session.parameters.max_position_size != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Max Position Size</span>
                  <p className="font-medium mt-0.5">{formatCurrency(session.parameters.max_position_size)}</p>
                </div>
              )}
              {session.parameters.max_open_positions != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Max Open Positions</span>
                  <p className="font-medium mt-0.5">{session.parameters.max_open_positions}</p>
                </div>
              )}
              {session.parameters.stop_loss_percent != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Stop Loss %</span>
                  <p className="font-medium mt-0.5">{session.parameters.stop_loss_percent}%</p>
                </div>
              )}
              {session.parameters.take_profit_percent != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Take Profit %</span>
                  <p className="font-medium mt-0.5">{session.parameters.take_profit_percent}%</p>
                </div>
              )}
              {session.parameters.trailing_stop != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Trailing Stop</span>
                  <p className="font-medium mt-0.5">{session.parameters.trailing_stop ? "Enabled" : "Disabled"}</p>
                </div>
              )}
              {session.parameters.max_trades_per_day != null && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Max Trades/Day</span>
                  <p className="font-medium mt-0.5">{session.parameters.max_trades_per_day}</p>
                </div>
              )}
            </div>
            {/* Show message if no risk params are configured */}
            {!session.parameters.max_loss_per_trade &&
              !session.parameters.max_daily_loss &&
              !session.parameters.max_position_size &&
              !session.parameters.max_open_positions &&
              !session.parameters.stop_loss_percent &&
              !session.parameters.take_profit_percent &&
              !session.parameters.trailing_stop &&
              !session.parameters.max_trades_per_day && (
              <p className="text-sm text-muted-foreground">
                No risk parameters configured for this session. Default strategy parameters are in use.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
        <MetricCard
          label="Portfolio Value"
          value={snapshot ? formatCurrency(snapshot.portfolio_value) : formatCurrency(session.initial_capital)}
          icon={DollarSign}
          color={snapshot ? (snapshot.portfolio_value >= session.initial_capital ? "text-green-600" : "text-red-600") : undefined}
        />
        <MetricCard label="Cash" value={snapshot ? formatCurrency(snapshot.cash) : formatCurrency(session.initial_capital)} icon={DollarSign} />
        <MetricCard
          label="Total P&L"
          value={snapshot ? formatCurrency(snapshot.total_pnl) : formatCurrency(0)}
          icon={snapshot && snapshot.total_pnl >= 0 ? TrendingUp : TrendingDown}
          color={snapshot ? pnlColor : undefined}
        />
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
          />
        </div>

        {/* Data Panel (right) */}
        <div className="flex-1 min-w-[320px] flex flex-col min-h-0">
          {/* Tab Navigation */}
          <div className="border-b flex-shrink-0">
            <nav className="flex">
              {(["positions", "orders", "trades"] as const).map((tab) => (
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
          </div>
        </div>
      </div>
    </div>
  );
}
