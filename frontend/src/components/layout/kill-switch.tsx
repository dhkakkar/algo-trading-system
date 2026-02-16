"use client";

import { useEffect, useState, useCallback } from "react";
import { Shield, ShieldAlert } from "lucide-react";
import apiClient from "@/lib/api-client";

export function KillSwitch() {
  const [mode, setMode] = useState<"test" | "live">("test");
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const fetchMode = useCallback(async () => {
    try {
      const res = await apiClient.get("/admin/platform/status");
      setMode(res.data.platform_trading_mode === "live" ? "live" : "test");
    } catch {
      // Non-admin or network error — default to test
    }
  }, []);

  useEffect(() => {
    fetchMode();
    const interval = setInterval(fetchMode, 30000);
    return () => clearInterval(interval);
  }, [fetchMode]);

  const handleToggle = async () => {
    if (mode === "test") {
      // Turning ON live — require confirmation
      setConfirmOpen(true);
      setConfirmText("");
      return;
    }
    // Turning OFF live — safe, do it immediately
    setLoading(true);
    try {
      await apiClient.post("/admin/platform/trading-mode", { mode: "test" });
      setMode("test");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmLive = async () => {
    if (confirmText !== "LIVE") return;
    setLoading(true);
    setConfirmOpen(false);
    setConfirmText("");
    try {
      await apiClient.post("/admin/platform/trading-mode", { mode: "live" });
      setMode("live");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const isLive = mode === "live";

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
          isLive
            ? "bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25"
            : "bg-green-500/15 text-green-500 border border-green-500/30 hover:bg-green-500/25"
        }`}
      >
        {isLive ? (
          <>
            <ShieldAlert className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Live Mode</span>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          </>
        ) : (
          <>
            <Shield className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Test Mode</span>
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
          </>
        )}
      </button>

      {/* Confirmation dialog for enabling live mode */}
      {confirmOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-2 p-3 rounded-lg border border-red-500/50 bg-card shadow-lg z-50">
          <p className="text-xs text-red-500 font-medium mb-2">
            Type LIVE to enable live trading:
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            className="w-full px-2 py-1 text-sm rounded border border-input bg-background mb-2"
            placeholder="Type LIVE"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmOpen(false)}
              className="flex-1 px-2 py-1 text-xs rounded border border-input hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmLive}
              disabled={confirmText !== "LIVE"}
              className="flex-1 px-2 py-1 text-xs rounded bg-red-500 text-white disabled:opacity-40 hover:bg-red-600"
            >
              Enable
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
