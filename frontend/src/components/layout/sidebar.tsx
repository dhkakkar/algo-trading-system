"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Code2,
  FlaskConical,
  PlayCircle,
  Zap,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { KillSwitch } from "./kill-switch";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategies", label: "Strategies", icon: Code2 },
  { href: "/backtests", label: "Backtests", icon: FlaskConical },
  { href: "/paper-trading", label: "Paper Trading", icon: PlayCircle },
  { href: "/live-trading", label: "Live Trading", icon: Zap },
  { href: "/market-data", label: "Market Data", icon: BarChart3 },
];

const bottomItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ mobile, onNavigate }: SidebarProps = {}) {
  const pathname = usePathname();
  const { logout, user } = useAuthStore();

  const handleNav = () => {
    if (onNavigate) onNavigate();
  };

  return (
    <aside
      className={cn(
        "flex flex-col bg-card h-screen",
        mobile
          ? "w-full"
          : "hidden lg:flex lg:w-64 lg:border-r sticky top-0"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b">
        <Link href="/dashboard" className="flex items-center space-x-2" onClick={handleNav}>
          <Zap className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">AlgoTrader</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleNav}
              className={cn(
                "flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Kill Switch */}
      {user?.is_superadmin && (
        <div className="border-t py-3 px-3">
          <KillSwitch />
        </div>
      )}

      {/* Bottom section */}
      <div className="border-t py-4 px-3 space-y-1">
        {bottomItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleNav}
              className={cn(
                "flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => { handleNav(); logout(); }}
          className="flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full"
        >
          <LogOut className="h-5 w-5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
