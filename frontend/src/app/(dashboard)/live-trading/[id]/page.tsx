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

  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "trades">(
    "positions"
  );
  const [orders, setOrders] = useState<TradingOrder[]>([]);
  const [trades, setTrades] = useState<TradingTrade[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [squareOffLoading, setSquareOffLoading] = useState(false);
  const [showSquareOffConfirm, setShowSquareOffConfirm] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch session data
  useEffect(() => {
    fetchSession(sessionId);
    fetchSnapshot(sessionId);
  }, [sessionId]);

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

  return (
    <div className="space-y-6">
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
      {snapshot && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Portfolio Value"
            value={formatCurrency(snapshot.portfolio_value)}
            icon={DollarSign}
            color={
              snapshot.portfolio_value >= session.initial_capital
                ? "text-green-600"
                : "text-red-600"
            }
          />
          <MetricCard
            label="Cash"
            value={formatCurrency(snapshot.cash)}
            icon={DollarSign}
          />
          <MetricCard
            label="Total P&L"
            value={formatCurrency(snapshot.total_pnl)}
            icon={snapshot.total_pnl >= 0 ? TrendingUp : TrendingDown}
            color={pnlColor}
          />
          <MetricCard
            label="Total Trades"
            value={formatNumber(snapshot.total_trades)}
            icon={BarChart3}
          />
        </div>
      )}

      {/* No snapshot yet for non-running sessions */}
      {!snapshot &&
        (session.status === "stopped" || session.status === "error") && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center h-40 space-y-3">
              <Activity className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">
                Start the session to see live trading data
              </p>
            </CardContent>
          </Card>
        )}

      {/* Tab Navigation */}
      <div className="border-b">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab("positions")}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "positions"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Positions
            {snapshot && snapshot.positions.length > 0 && (
              <span className="ml-1.5 text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">
                {snapshot.positions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "orders"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Orders
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
            Trades
          </button>
        </nav>
      </div>

      {/* Positions Tab */}
      {activeTab === "positions" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open Positions</CardTitle>
          </CardHeader>
          <CardContent>
            {!snapshot || snapshot.positions.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                No open positions
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
                        Avg Price
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Current Price
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Unrealized P&L
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        P&L %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.positions.map((pos, i) => (
                      <tr
                        key={`${pos.symbol}-${pos.exchange}-${i}`}
                        className="border-b last:border-0 hover:bg-accent/50"
                      >
                        <td className="py-2.5 font-medium">
                          {pos.exchange}:{pos.symbol}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={cn(
                              "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                              pos.side === "LONG" || pos.side === "BUY"
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            )}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="py-2.5">{pos.quantity}</td>
                        <td className="py-2.5">
                          {formatCurrency(pos.avg_price)}
                        </td>
                        <td className="py-2.5">
                          {formatCurrency(pos.current_price)}
                        </td>
                        <td
                          className={cn(
                            "py-2.5 font-medium",
                            pos.unrealized_pnl >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          )}
                        >
                          {formatCurrency(pos.unrealized_pnl)}
                        </td>
                        <td
                          className={cn(
                            "py-2.5 font-medium",
                            pos.pnl_percent >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          )}
                        >
                          {formatPercent(pos.pnl_percent)}
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

      {/* Orders Tab */}
      {activeTab === "orders" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="h-32 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : orders.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                No orders placed
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
                        Type
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Side
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Qty
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Price
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Filled
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Avg Price
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="pb-3 font-medium text-muted-foreground">
                        Placed At
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b last:border-0 hover:bg-accent/50"
                      >
                        <td className="py-2.5 font-medium">
                          {order.exchange}:{order.tradingsymbol}
                        </td>
                        <td className="py-2.5 text-xs">
                          {order.order_type}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={cn(
                              "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                              order.transaction_type === "BUY"
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            )}
                          >
                            {order.transaction_type}
                          </span>
                        </td>
                        <td className="py-2.5">{order.quantity}</td>
                        <td className="py-2.5">
                          {order.price != null
                            ? formatCurrency(order.price)
                            : "Market"}
                        </td>
                        <td className="py-2.5">
                          {order.filled_quantity}/{order.quantity}
                        </td>
                        <td className="py-2.5">
                          {order.average_price != null
                            ? formatCurrency(order.average_price)
                            : "--"}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={cn(
                              "inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize",
                              order.status === "COMPLETE"
                                ? "bg-green-100 text-green-800"
                                : order.status === "REJECTED" ||
                                  order.status === "CANCELLED"
                                ? "bg-red-100 text-red-800"
                                : "bg-blue-100 text-blue-800"
                            )}
                          >
                            {order.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {new Date(order.placed_at).toLocaleString()}
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

      {/* Trades Tab */}
      {activeTab === "trades" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trade Log</CardTitle>
          </CardHeader>
          <CardContent>
            {tradesLoading ? (
              <div className="h-32 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : trades.length === 0 ? (
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
                    {trades.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b last:border-0 hover:bg-accent/50"
                      >
                        <td className="py-2.5 font-medium">
                          {t.exchange}:{t.tradingsymbol}
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
                          {t.pnl != null ? formatCurrency(t.pnl) : "--"}
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
                            : "--"}
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
                            : "--"}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {new Date(t.entry_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {t.exit_at
                            ? new Date(t.exit_at).toLocaleString()
                            : "--"}
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
    </div>
  );
}
