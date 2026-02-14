"use client";

import Link from "next/link";
import { Code2, Upload, Clock, Tag } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import type { StrategyListItem } from "@/types/strategy";

interface StrategyCardProps {
  strategy: StrategyListItem;
}

export function StrategyCard({ strategy }: StrategyCardProps) {
  const truncatedDescription =
    strategy.description && strategy.description.length > 100
      ? strategy.description.slice(0, 100) + "..."
      : strategy.description;

  const formattedDate = new Date(strategy.created_at).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  );

  return (
    <Link href={`/strategies/${strategy.id}`}>
      <Card className="h-full transition-colors hover:border-primary/50 hover:shadow-md cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <CardTitle className="text-lg leading-tight">
              {strategy.name}
            </CardTitle>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                strategy.is_active
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {strategy.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          {truncatedDescription && (
            <CardDescription className="line-clamp-2">
              {truncatedDescription}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="pb-3">
          <div className="flex flex-wrap gap-2">
            {/* Source type badge */}
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
              {strategy.source_type === "editor" ? (
                <Code2 className="h-3 w-3" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              {strategy.source_type === "editor" ? "Editor" : "Upload"}
            </span>

            {/* Timeframe badge */}
            {strategy.timeframe && (
              <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                <Clock className="h-3 w-3" />
                {strategy.timeframe}
              </span>
            )}

            {/* Instruments count */}
            {strategy.instruments.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                <Tag className="h-3 w-3" />
                {strategy.instruments.length} instrument
                {strategy.instruments.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </CardContent>

        <CardFooter className="text-xs text-muted-foreground pt-0">
          <div className="flex items-center justify-between w-full">
            <span>v{strategy.version}</span>
            <span>{formattedDate}</span>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
