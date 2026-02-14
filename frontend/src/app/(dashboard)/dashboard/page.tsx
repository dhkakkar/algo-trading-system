"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth-store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import {
  Wallet,
  BarChart3,
  Code2,
  FlaskConical,
  PlayCircle,
  Zap,
  ArrowRight,
} from "lucide-react";

interface DashboardStats {
  strategies: number;
  backtests: number;
  paperSessions: number;
  liveSessions: number;
  runningPaper: number;
  runningLive: number;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats>({
    strategies: 0,
    backtests: 0,
    paperSessions: 0,
    liveSessions: 0,
    runningPaper: 0,
    runningLive: 0,
  });

  useEffect(() => {
    async function loadStats() {
      try {
        const [strategiesRes, backtestsRes, sessionsRes] = await Promise.allSettled([
          apiClient.get("/strategies"),
          apiClient.get("/backtests"),
          apiClient.get("/trading/sessions"),
        ]);

        const strategies =
          strategiesRes.status === "fulfilled" ? strategiesRes.value.data : [];
        const backtests =
          backtestsRes.status === "fulfilled" ? backtestsRes.value.data : [];
        const sessions =
          sessionsRes.status === "fulfilled" ? sessionsRes.value.data : [];

        setStats({
          strategies: strategies.length,
          backtests: backtests.length,
          paperSessions: sessions.filter((s: any) => s.mode === "paper").length,
          liveSessions: sessions.filter((s: any) => s.mode === "live").length,
          runningPaper: sessions.filter(
            (s: any) => s.mode === "paper" && s.status === "running"
          ).length,
          runningLive: sessions.filter(
            (s: any) => s.mode === "live" && s.status === "running"
          ).length,
        });
      } catch {
        // silently ignore
      }
    }
    loadStats();
  }, []);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.full_name?.split(" ")[0] || "Trader"}
        </h1>
        <p className="text-muted-foreground">
          Here&apos;s an overview of your trading activity
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/strategies">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Strategies</CardTitle>
              <Code2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatNumber(stats.strategies)}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.strategies === 0
                  ? "Create your first strategy"
                  : "Total strategies created"}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/backtests">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Backtests</CardTitle>
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatNumber(stats.backtests)}
              </div>
              <p className="text-xs text-muted-foreground">
                Total backtests run
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/paper-trading">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Paper Trading
              </CardTitle>
              <PlayCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.runningPaper > 0 ? (
                  <span className="text-green-600">
                    {stats.runningPaper} active
                  </span>
                ) : (
                  formatNumber(stats.paperSessions)
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.runningPaper > 0
                  ? `${stats.paperSessions} total sessions`
                  : "No active sessions"}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/live-trading">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Live Trading
              </CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.runningLive > 0 ? (
                  <span className="text-green-600">
                    {stats.runningLive} active
                  </span>
                ) : (
                  formatNumber(stats.liveSessions)
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.runningLive > 0
                  ? `${stats.liveSessions} total sessions`
                  : "No active sessions"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StepItem n={1} href="/settings" text="Connect your Zerodha account in Settings" />
            <StepItem n={2} href="/strategies/new" text="Create a strategy using the code editor" />
            <StepItem n={3} href="/backtests" text="Backtest your strategy with historical data" />
            <StepItem n={4} href="/paper-trading" text="Paper trade to validate in real-time" />
            <StepItem n={5} href="/live-trading" text="Go live with confidence" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              href="/strategies/new"
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Code2 className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Create New Strategy</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link
              href="/market-data"
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="flex items-center space-x-3">
                <BarChart3 className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Browse Market Data</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link
              href="/settings"
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Wallet className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Connect Broker</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StepItem({ n, href, text }: { n: number; href: string; text: string }) {
  return (
    <Link href={href} className="flex items-center space-x-3 group">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium shrink-0">
        {n}
      </div>
      <span className="text-sm group-hover:text-primary transition-colors">
        {text}
      </span>
    </Link>
  );
}
