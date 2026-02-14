"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Plus, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StrategyCard } from "@/components/strategy/strategy-card";
import { useStrategyStore } from "@/stores/strategy-store";

export default function StrategiesPage() {
  const { strategies, isLoading, error, fetchStrategies } = useStrategyStore();

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
          <p className="text-muted-foreground">
            Build and manage your trading strategies
          </p>
        </div>
        <Button asChild>
          <Link href="/strategies/new">
            <Plus className="h-4 w-4 mr-2" />
            New Strategy
          </Link>
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 rounded-lg border bg-card animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Strategy grid */}
      {!isLoading && strategies.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {strategies.map((strategy) => (
            <StrategyCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && strategies.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card p-12">
          <Code2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No strategies yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4 text-center max-w-md">
            Create your first trading strategy using the code editor or upload a
            Python file to get started.
          </p>
          <Button asChild>
            <Link href="/strategies/new">
              <Plus className="h-4 w-4 mr-2" />
              Create Strategy
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
