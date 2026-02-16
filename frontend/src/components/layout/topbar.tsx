"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import {
  Bell,
  Menu,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import apiClient from "@/lib/api-client";

interface BrokerStatus {
  connected: boolean;
  token_valid: boolean;
  token_expiry: string | null;
  login_url: string | null;
  api_key: string | null;
}

interface TopbarProps {
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [validating, setValidating] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  // Fetch broker status on mount
  useEffect(() => {
    apiClient
      .get("/broker/status")
      .then((res) => setBrokerStatus(res.data))
      .catch(() => setBrokerStatus({ connected: false, token_valid: false, token_expiry: null, login_url: null, api_key: null }));
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const validateToken = async () => {
    setValidating(true);
    try {
      const res = await apiClient.get("/broker/status?validate=true");
      setBrokerStatus(res.data);
    } catch {
      // ignore
    } finally {
      setValidating(false);
    }
  };

  // Determine broker indicator
  const isTokenOk = brokerStatus?.connected && brokerStatus?.token_valid;
  const isTokenExpired = brokerStatus?.connected && !brokerStatus?.token_valid;
  const isDisconnected = brokerStatus !== null && !brokerStatus.connected;
  const hasAlert = isTokenExpired || isDisconnected;

  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-4 lg:px-6 sticky top-0 z-10">
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center space-x-3">
        {/* Broker status indicator (compact) */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs">
          {isTokenOk && (
            <span className="flex items-center gap-1 text-green-500">
              <Wifi className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Kite Connected</span>
            </span>
          )}
          {isTokenExpired && (
            <span className="flex items-center gap-1 text-yellow-500">
              <WifiOff className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Token Expired</span>
            </span>
          )}
          {isDisconnected && (
            <span className="flex items-center gap-1 text-red-500">
              <WifiOff className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Not Connected</span>
            </span>
          )}
        </div>

        {/* Notification bell */}
        <div className="relative" ref={bellRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setBellOpen((v) => !v)}
            className="relative"
          >
            <Bell className="h-5 w-5" />
            {hasAlert && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
            )}
          </Button>

          {bellOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 rounded-md border bg-card shadow-lg z-50">
              <div className="px-3 py-2 border-b">
                <p className="text-sm font-medium">Notifications</p>
              </div>
              <div className="p-3 space-y-3">
                {/* Broker connection status */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Broker Connection</p>
                  {isTokenOk && (
                    <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/20">
                      <Wifi className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-green-400">Kite Connected</p>
                        {brokerStatus?.token_expiry && (
                          <p className="text-[10px] text-muted-foreground">
                            Expires: {new Date(brokerStatus.token_expiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {isTokenExpired && (
                    <div className="flex items-center gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                      <WifiOff className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-yellow-400">API Token Expired</p>
                        <p className="text-[10px] text-muted-foreground">
                          Re-authenticate in Settings to get live data
                        </p>
                      </div>
                      <button
                        onClick={() => { setBellOpen(false); router.push("/settings"); }}
                        className="text-yellow-400 hover:text-yellow-300 flex-shrink-0"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {isDisconnected && (
                    <div className="flex items-center gap-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                      <WifiOff className="h-4 w-4 text-red-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-red-400">Broker Not Connected</p>
                        <p className="text-[10px] text-muted-foreground">
                          Connect your Zerodha account in Settings
                        </p>
                      </div>
                      <button
                        onClick={() => { setBellOpen(false); router.push("/settings"); }}
                        className="text-red-400 hover:text-red-300 flex-shrink-0"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {brokerStatus === null && (
                    <p className="text-xs text-muted-foreground">Loading...</p>
                  )}
                </div>

                {/* Validate button */}
                {brokerStatus?.connected && (
                  <button
                    onClick={validateToken}
                    disabled={validating}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${validating ? "animate-spin" : ""}`} />
                    {validating ? "Checking..." : "Validate token"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
          >
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
              {user?.full_name?.charAt(0).toUpperCase() || "U"}
            </div>
            <span className="text-sm font-medium hidden md:block">
              {user?.full_name || "User"}
            </span>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-md border bg-card shadow-lg z-50 py-1">
              <div className="px-3 py-2 border-b">
                <p className="text-sm font-medium">{user?.full_name || "User"}</p>
                <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
              </div>
              <button
                onClick={() => { setProfileOpen(false); router.push("/settings"); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Settings className="h-4 w-4" />
                Settings
              </button>
              <button
                onClick={() => { setProfileOpen(false); logout(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
