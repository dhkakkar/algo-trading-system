"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useBacktestStore } from "@/stores/backtest-store";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket-client";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FlaskConical, Loader2, Trash2, XCircle } from "lucide-react";

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

export default function BacktestsPage() {
  const {
    backtests,
    loading,
    error,
    progress,
    fetchBacktests,
    deleteBacktest,
    cancelBacktest,
    setProgress,
    markCompleted,
    markFailed,
  } = useBacktestStore();

  useEffect(() => {
    fetchBacktests();

    // Connect Socket.IO for live progress updates
    const socket = connectSocket();

    socket.on("backtest_progress", (data: any) => {
      setProgress(data.backtest_id, data.percent, data.current_date);
    });

    socket.on("backtest_completed", (data: any) => {
      markCompleted(data.backtest_id);
      fetchBacktests();
    });

    socket.on("backtest_error", (data: any) => {
      markFailed(data.backtest_id);
      fetchBacktests();
    });

    // Subscribe to all running backtests
    return () => {
      socket.off("backtest_progress");
      socket.off("backtest_completed");
      socket.off("backtest_error");
    };
  }, []);

  // Subscribe to running backtests when list changes
  useEffect(() => {
    const socket = getSocket();
    backtests
      .filter((b) => b.status === "running" || b.status === "pending")
      .forEach((b) => {
        socket.emit("subscribe_backtest", { backtest_id: b.id });
      });
  }, [backtests]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backtests</h1>
        <p className="text-muted-foreground">
          View your backtest results and history
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && backtests.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : backtests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <FlaskConical className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No backtests yet</p>
            <p className="text-sm text-muted-foreground">
              Go to a strategy and click &quot;Run Backtest&quot; to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Backtest History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Date Range
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Capital
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Return
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Sharpe
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Max DD
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Trades
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backtests.map((bt) => {
                    const prog = progress[bt.id];
                    return (
                      <tr key={bt.id} className="border-b last:border-0">
                        <td className="py-3">
                          <StatusBadge status={bt.status} />
                          {bt.status === "running" && prog && (
                            <div className="mt-1">
                              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="bg-blue-600 h-1.5 rounded-full transition-all"
                                  style={{ width: `${prog.percent}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {prog.percent.toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-xs">
                          {bt.start_date} → {bt.end_date}
                        </td>
                        <td className="py-3">
                          {formatCurrency(bt.initial_capital)}
                        </td>
                        <td className="py-3">
                          {bt.total_return != null ? (
                            <span
                              className={
                                bt.total_return >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {formatPercent(bt.total_return)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3">
                          {bt.sharpe_ratio != null
                            ? bt.sharpe_ratio.toFixed(2)
                            : "—"}
                        </td>
                        <td className="py-3">
                          {bt.max_drawdown != null ? (
                            <span className="text-red-600">
                              {formatPercent(-Math.abs(bt.max_drawdown))}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3">{bt.total_trades ?? "—"}</td>
                        <td className="py-3">
                          <div className="flex items-center space-x-2">
                            {bt.status === "completed" && (
                              <Link
                                href={`/backtests/${bt.id}`}
                                className="text-primary hover:underline text-xs font-medium"
                              >
                                View Results
                              </Link>
                            )}
                            {bt.status === "failed" && (
                              <Link
                                href={`/backtests/${bt.id}`}
                                className="text-red-600 hover:underline text-xs font-medium"
                              >
                                View Error
                              </Link>
                            )}
                            {(bt.status === "running" ||
                              bt.status === "pending") && (
                              <button
                                onClick={() => cancelBacktest(bt.id)}
                                className="text-yellow-600 hover:text-yellow-700"
                                title="Cancel"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                            {(bt.status === "completed" ||
                              bt.status === "failed" ||
                              bt.status === "cancelled") && (
                              <button
                                onClick={() => deleteBacktest(bt.id)}
                                className="text-red-400 hover:text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
