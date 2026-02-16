"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTradingStore } from "@/stores/trading-store";
import apiClient from "@/lib/api-client";
import { cn, formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Loader2, Play, Square, Pause, Trash2, AlertTriangle, ShieldAlert } from "lucide-react";

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

export default function LiveTradingPage() {
  const {
    sessions,
    loading,
    error,
    fetchSessions,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    deleteSession,
    clearError,
  } = useTradingStore();

  const [platformMode, setPlatformMode] = useState<string>("test");

  useEffect(() => {
    fetchSessions("live");
    apiClient.get("/admin/platform/status").then((res) => {
      setPlatformMode(res.data.platform_trading_mode);
    }).catch(() => {});
  }, []);

  const handleStart = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    await startSession(id);
    fetchSessions("live");
  };

  const handleStop = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    await stopSession(id);
    fetchSessions("live");
  };

  const handlePause = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    await pauseSession(id);
    fetchSessions("live");
  };

  const handleResume = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    await resumeSession(id);
    fetchSessions("live");
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm("Are you sure you want to delete this live trading session? This action cannot be undone.")) {
      await deleteSession(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Trading</h1>
          <p className="text-muted-foreground">
            Deploy strategies with real capital
          </p>
        </div>
        <Button asChild>
          <Link href="/strategies">
            <Zap className="h-4 w-4 mr-2" />
            New Live Session
          </Link>
        </Button>
      </div>

      {/* Platform Mode Banner */}
      {platformMode === "test" && (
        <div className="rounded-md border border-green-300 bg-green-50 p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-green-800">Platform is in TEST MODE</p>
            <p className="text-sm text-green-700 mt-1">
              Live trading is disabled. No real orders can be placed. Switch the kill switch in the sidebar to enable live trading.
            </p>
          </div>
        </div>
      )}

      {/* Warning Banner */}
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-amber-800">Caution: Real Money Trading</p>
          <p className="text-sm text-amber-700 mt-1">
            Live trading uses real money. Ensure your Kite account is connected and risk settings are configured.
          </p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="text-red-500 hover:text-red-700 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        /* Empty state */
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <Zap className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No live trading sessions yet</p>
            <p className="text-sm text-muted-foreground">
              Go to a strategy and start a live trading session to deploy with real capital
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Sessions table */
        <Card>
          <CardHeader>
            <CardTitle>Live Trading Sessions</CardTitle>
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
                      Strategy
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Instruments
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Timeframe
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Initial Capital
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Current Value
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Started
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="border-b last:border-0 hover:bg-accent/50 cursor-pointer"
                    >
                      <td className="py-3">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          <StatusBadge status={session.status} />
                        </Link>
                      </td>
                      <td className="py-3 font-medium">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          <span className="text-xs text-muted-foreground">
                            {session.strategy_id.slice(0, 8)}...
                          </span>
                          <span className="ml-1 text-xs text-muted-foreground">
                            v{session.strategy_version}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          <div className="flex flex-wrap gap-1">
                            {session.instruments.map((inst) => (
                              <span
                                key={inst}
                                className="inline-flex px-1.5 py-0.5 rounded text-xs bg-accent text-accent-foreground"
                              >
                                {inst}
                              </span>
                            ))}
                          </div>
                        </Link>
                      </td>
                      <td className="py-3 text-xs">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          {session.timeframe}
                        </Link>
                      </td>
                      <td className="py-3">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          {formatCurrency(session.initial_capital)}
                        </Link>
                      </td>
                      <td className="py-3">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          {session.current_capital != null ? (
                            <span
                              className={
                                session.current_capital >= session.initial_capital
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {formatCurrency(session.current_capital)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </Link>
                      </td>
                      <td className="py-3 text-xs text-muted-foreground">
                        <Link href={`/live-trading/${session.id}`} className="block">
                          {session.started_at
                            ? new Date(session.started_at).toLocaleString()
                            : "Not started"}
                        </Link>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center space-x-1">
                          {/* Start button - show when stopped or error */}
                          {(session.status === "stopped" ||
                            session.status === "error") && (
                            <button
                              onClick={(e) => handleStart(e, session.id)}
                              className="p-1.5 rounded-md text-green-600 hover:bg-green-50 hover:text-green-700"
                              title="Start"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}

                          {/* Pause button - show when running */}
                          {session.status === "running" && (
                            <button
                              onClick={(e) => handlePause(e, session.id)}
                              className="p-1.5 rounded-md text-yellow-600 hover:bg-yellow-50 hover:text-yellow-700"
                              title="Pause"
                            >
                              <Pause className="h-4 w-4" />
                            </button>
                          )}

                          {/* Resume button - show when paused */}
                          {session.status === "paused" && (
                            <button
                              onClick={(e) => handleResume(e, session.id)}
                              className="p-1.5 rounded-md text-green-600 hover:bg-green-50 hover:text-green-700"
                              title="Resume"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}

                          {/* Stop button - show when running or paused */}
                          {(session.status === "running" ||
                            session.status === "paused") && (
                            <button
                              onClick={(e) => handleStop(e, session.id)}
                              className="p-1.5 rounded-md text-red-600 hover:bg-red-50 hover:text-red-700"
                              title="Stop"
                            >
                              <Square className="h-4 w-4" />
                            </button>
                          )}

                          {/* Delete button - show when stopped or error */}
                          {(session.status === "stopped" ||
                            session.status === "error") && (
                            <button
                              onClick={(e) => handleDelete(e, session.id)}
                              className="p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
