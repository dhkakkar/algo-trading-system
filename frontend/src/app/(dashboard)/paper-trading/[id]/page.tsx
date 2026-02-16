"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTradingStore } from "@/stores/trading-store";
import { connectSocket } from "@/lib/socket-client";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
} from "lucide-react";
import type { TradingOrder, TradingTrade, TradingSnapshot } from "@/types/trading";
import apiClient from "@/lib/api-client";

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
// Live Candlestick Chart
// ---------------------------------------------------------------------------
function LiveChart({
  instruments,
  timeframe,
  snapshot,
  isRunning,
}: {
  instruments: string[];
  timeframe: string;
  snapshot: TradingSnapshot | null;
  isRunning: boolean;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const lastCandleRef = useRef<any>(null);
  const [chartLoading, setChartLoading] = useState(true);

  // Primary symbol
  const primaryInstrument = instruments[0] || "";
  const sym = primaryInstrument.includes(":")
    ? primaryInstrument.split(":")[1]
    : primaryInstrument;
  const exch = primaryInstrument.includes(":")
    ? primaryInstrument.split(":")[0]
    : "NSE";

  // Load historical candles and create chart
  useEffect(() => {
    if (!sym || !chartContainerRef.current) return;

    setChartLoading(true);

    // Fetch historical OHLCV
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 30); // Last 30 days
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);

    Promise.all([
      apiClient.get(
        `/market-data/ohlcv?symbol=${sym}&exchange=${exch}&from_date=${fromStr}&to_date=${toStr}&interval=${timeframe}`
      ),
      import("lightweight-charts"),
    ])
      .then(([ohlcvRes, lc]) => {
        if (!chartContainerRef.current) return;

        // Clean up old chart
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        const { createChart, ColorType } = lc;

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
          crosshair: { mode: 0 },
          timeScale: {
            borderColor: "#374151",
            timeVisible: timeframe !== "1d",
            secondsVisible: false,
          },
          rightPriceScale: {
            borderColor: "#374151",
          },
        });

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderDownColor: "#ef4444",
          borderUpColor: "#22c55e",
          wickDownColor: "#ef4444",
          wickUpColor: "#22c55e",
        });

        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        });

        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });

        // Transform OHLCV data
        const data = ohlcvRes.data || [];
        const candleData = data.map((d: any) => ({
          time: Math.floor(new Date(d.time || d.timestamp).getTime() / 1000) as any,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }));

        const volumeData = data.map((d: any) => ({
          time: Math.floor(new Date(d.time || d.timestamp).getTime() / 1000) as any,
          value: d.volume || 0,
          color: d.close >= d.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
        }));

        // Deduplicate by time
        const seen = new Set<number>();
        const uniqueCandles: any[] = [];
        const uniqueVolumes: any[] = [];
        candleData.forEach((c: any, i: number) => {
          if (!seen.has(c.time)) {
            seen.add(c.time);
            uniqueCandles.push(c);
            uniqueVolumes.push(volumeData[i]);
          }
        });

        uniqueCandles.sort((a: any, b: any) => a.time - b.time);
        uniqueVolumes.sort((a: any, b: any) => a.time - b.time);

        candleSeries.setData(uniqueCandles);
        volumeSeries.setData(uniqueVolumes);
        chart.timeScale().fitContent();

        if (uniqueCandles.length > 0) {
          lastCandleRef.current = uniqueCandles[uniqueCandles.length - 1];
        }

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

        setChartLoading(false);

        return () => {
          window.removeEventListener("resize", handleResize);
        };
      })
      .catch(() => {
        setChartLoading(false);
      });

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [sym, exch, timeframe]);

  // Update last candle with live price from snapshot
  useEffect(() => {
    if (!snapshot || !candleSeriesRef.current || !sym) return;

    const price = snapshot.prices[sym] || snapshot.prices[sym.toUpperCase()];
    if (!price) return;

    const now = Math.floor(Date.now() / 1000);
    const lastCandle = lastCandleRef.current;

    // Determine candle interval in seconds
    const intervalSecs: Record<string, number> = {
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "30m": 1800,
      "1h": 3600,
      "1d": 86400,
    };
    const interval = intervalSecs[timeframe] || 3600;

    if (lastCandle) {
      const candleEnd = lastCandle.time + interval;

      if (now < candleEnd) {
        // Update current candle
        const updated = {
          ...lastCandle,
          high: Math.max(lastCandle.high, price),
          low: Math.min(lastCandle.low, price),
          close: price,
        };
        candleSeriesRef.current.update(updated);
        lastCandleRef.current = updated;
      } else {
        // Start a new candle
        const newTime = Math.floor(now / interval) * interval;
        const newCandle = {
          time: newTime as any,
          open: price,
          high: price,
          low: price,
          close: price,
        };
        candleSeriesRef.current.update(newCandle);
        lastCandleRef.current = newCandle;
      }
    }
  }, [snapshot, sym, timeframe]);

  return (
    <div className="relative h-full min-h-[400px]">
      {chartLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div ref={chartContainerRef} className="w-full h-full" />
      {!isRunning && !chartLoading && (
        <div className="absolute top-2 left-2 bg-yellow-500/20 text-yellow-500 text-xs px-2 py-1 rounded">
          Session not running — chart shows historical data only
        </div>
      )}
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
    if (confirm("Are you sure you want to delete this session?")) {
      await deleteSession(sessionId);
      router.push("/paper-trading");
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
          onClick={() => router.push("/paper-trading")}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Paper Trading
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
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <button
            onClick={() => router.push("/paper-trading")}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Paper Trading
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Paper Trading Session
            </h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
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

      {/* Error message */}
      {session.status === "error" && session.error_message && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 flex-shrink-0">
          <p className="font-medium text-red-800">Session Error</p>
          <p className="text-sm text-red-700 mt-1">{session.error_message}</p>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
        <MetricCard
          label="Portfolio Value"
          value={snapshot ? formatCurrency(snapshot.portfolio_value) : formatCurrency(session.initial_capital)}
          icon={DollarSign}
          color={
            snapshot
              ? snapshot.portfolio_value >= session.initial_capital
                ? "text-green-600"
                : "text-red-600"
              : undefined
          }
        />
        <MetricCard
          label="Cash"
          value={snapshot ? formatCurrency(snapshot.cash) : formatCurrency(session.initial_capital)}
          icon={DollarSign}
        />
        <MetricCard
          label="Total P&L"
          value={snapshot ? formatCurrency(snapshot.total_pnl) : formatCurrency(0)}
          icon={snapshot && snapshot.total_pnl >= 0 ? TrendingUp : TrendingDown}
          color={snapshot ? pnlColor : undefined}
        />
        <MetricCard
          label="Total Trades"
          value={snapshot ? formatNumber(snapshot.total_trades) : "0"}
          icon={BarChart3}
        />
      </div>

      {/* Main area: Chart + Data Panel */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chart (left) */}
        <div className="flex-[2] min-w-0 border rounded-lg bg-card overflow-hidden">
          <LiveChart
            instruments={session.instruments}
            timeframe={session.timeframe}
            snapshot={snapshot}
            isRunning={isRunning}
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
                    activeTab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab}
                  {tab === "positions" && snapshot && snapshot.positions.length > 0 && (
                    <span className="ml-1 text-[10px] bg-accent text-accent-foreground px-1 py-0.5 rounded-full">
                      {snapshot.positions.length}
                    </span>
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
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    No open positions
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.positions.map((pos, i) => (
                      <div
                        key={`${pos.symbol}-${pos.exchange}-${i}`}
                        className="border rounded-md p-2.5 text-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{pos.exchange}:{pos.symbol}</span>
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                pos.side === "LONG" || pos.side === "BUY"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              )}
                            >
                              {pos.side}
                            </span>
                          </div>
                          <span className="text-muted-foreground text-xs">
                            Qty: {pos.quantity}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Avg: {formatCurrency(pos.avg_price)} &rarr; {formatCurrency(pos.current_price)}
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              pos.unrealized_pnl >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
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
                  <div className="h-32 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : orders.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    No orders placed
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {[...orders].reverse().map((order) => (
                      <div
                        key={order.id}
                        className="border rounded-md p-2 text-xs"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                order.transaction_type === "BUY"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              )}
                            >
                              {order.transaction_type}
                            </span>
                            <span className="font-medium">{order.tradingsymbol}</span>
                            <span className="text-muted-foreground">x{order.quantity}</span>
                          </div>
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium capitalize",
                              order.status === "COMPLETE"
                                ? "bg-green-100 text-green-800"
                                : order.status === "REJECTED" || order.status === "CANCELLED"
                                ? "bg-red-100 text-red-800"
                                : "bg-blue-100 text-blue-800"
                            )}
                          >
                            {order.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            {order.order_type} @ {order.average_price != null ? formatCurrency(order.average_price) : "Market"}
                          </span>
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
                  <div className="h-32 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : trades.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    No trades recorded
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {[...trades].reverse().map((t) => (
                      <div
                        key={t.id}
                        className="border rounded-md p-2 text-xs"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                t.side === "LONG" || t.side === "BUY"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              )}
                            >
                              {t.side}
                            </span>
                            <span className="font-medium">{t.tradingsymbol}</span>
                            <span className="text-muted-foreground">x{t.quantity}</span>
                          </div>
                          <span
                            className={cn(
                              "font-semibold",
                              t.net_pnl != null
                                ? t.net_pnl >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                                : ""
                            )}
                          >
                            {t.net_pnl != null ? formatCurrency(t.net_pnl) : "--"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            {formatCurrency(t.entry_price)} &rarr;{" "}
                            {t.exit_price != null ? formatCurrency(t.exit_price) : "Open"}
                          </span>
                          <span>
                            {t.pnl_percent != null ? formatPercent(t.pnl_percent) : "--"}
                          </span>
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
