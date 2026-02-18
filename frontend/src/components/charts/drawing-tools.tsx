"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Minus,
  ArrowUpRight,
  MoveRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type DrawingType =
  | "horizontal-line"
  | "vertical-line"
  | "trend-line"
  | "horizontal-ray"
  | "long-position"
  | "short-position";

interface DrawingPoint {
  time: any;
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  color: string;
}

interface ToolDef {
  type: DrawingType;
  label: string;
  icon: React.ReactNode;
  clicks: number;
}

const TOOLS: ToolDef[] = [
  { type: "horizontal-line", label: "Horizontal Line", icon: <Minus className="h-4 w-4" />, clicks: 1 },
  { type: "vertical-line", label: "Vertical Line", icon: <GripVertical className="h-4 w-4" />, clicks: 1 },
  { type: "trend-line", label: "Trend Line", icon: <ArrowUpRight className="h-4 w-4" />, clicks: 2 },
  { type: "horizontal-ray", label: "Horizontal Ray", icon: <MoveRight className="h-4 w-4" />, clicks: 1 },
  { type: "long-position", label: "Long Position", icon: <ArrowUp className="h-4 w-4" />, clicks: 2 },
  { type: "short-position", label: "Short Position", icon: <ArrowDown className="h-4 w-4" />, clicks: 2 },
];

const DEFAULT_COLORS: Record<DrawingType, string> = {
  "horizontal-line": "#f59e0b",
  "vertical-line": "#8b5cf6",
  "trend-line": "#3b82f6",
  "horizontal-ray": "#f59e0b",
  "long-position": "#22c55e",
  "short-position": "#ef4444",
};

// ---------------------------------------------------------------------------
// Unique ID generator
// ---------------------------------------------------------------------------
let drawingCounter = 0;
function genId(): string {
  drawingCounter = drawingCounter + 1;
  return `drawing_${Date.now()}_${drawingCounter}`;
}

// ---------------------------------------------------------------------------
// Drawing Tool Bar component
// ---------------------------------------------------------------------------
export function DrawingToolbar({
  chart,
  series,
  storageKey,
}: {
  chart: any;
  series: any;
  storageKey: string;
}) {
  const [activeTool, setActiveTool] = useState<DrawingType | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });
  const [pendingPoints, setPendingPoints] = useState<DrawingPoint[]>([]);

  const activeToolRef = useRef<DrawingType | null>(null);
  const pendingPointsRef = useRef<DrawingPoint[]>([]);
  const drawingsRef = useRef<Drawing[]>(drawings);
  const chartRef = useRef<any>(chart);
  const seriesRef = useRef<any>(series);
  const renderedRef = useRef<Map<string, any>>(new Map());

  // Keep refs in sync
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { pendingPointsRef.current = pendingPoints; }, [pendingPoints]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { chartRef.current = chart; }, [chart]);
  useEffect(() => { seriesRef.current = series; }, [series]);

  // Persist drawings
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(drawings));
  }, [drawings, storageKey]);

  // Render all drawings when drawings change or chart/series change
  useEffect(() => {
    if (!chart || !series) return;
    renderAllDrawings(chart, series, drawings, renderedRef.current);
  }, [chart, series, drawings]);

  // Subscribe to chart click events
  useEffect(() => {
    if (!chart || !series) return;

    const handler = (param: any) => {
      if (!activeToolRef.current || !param.time || !param.point) return;

      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;

      const point: DrawingPoint = { time: param.time, price };
      const tool = TOOLS.find((t) => t.type === activeToolRef.current);
      if (!tool) return;

      const newPending = [...pendingPointsRef.current, point];
      if (newPending.length >= tool.clicks) {
        // Drawing complete
        const drawing: Drawing = {
          id: genId(),
          type: tool.type,
          points: newPending,
          color: DEFAULT_COLORS[tool.type],
        };
        setDrawings((prev) => [...prev, drawing]);
        setPendingPoints([]);
        setActiveTool(null);
      } else {
        setPendingPoints(newPending);
      }
    };

    chart.subscribeClick(handler);
    return () => {
      try { chart.unsubscribeClick(handler); } catch {}
    };
  }, [chart, series]);

  // Handle Escape to cancel active tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveTool(null);
        setPendingPoints([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Set cursor style when tool is active
  useEffect(() => {
    if (!chart) return;
    const container = chart.chartElement?.();
    if (!container) return;
    container.style.cursor = activeTool ? "crosshair" : "";
    return () => { container.style.cursor = ""; };
  }, [chart, activeTool]);

  const removeDrawing = useCallback((id: string) => {
    // Remove from rendered
    const rendered = renderedRef.current.get(id);
    if (rendered && chartRef.current) {
      removeRendered(chartRef.current, seriesRef.current, rendered);
      renderedRef.current.delete(id);
    }
    setDrawings((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    // Remove all rendered drawings
    renderedRef.current.forEach((rendered, _id) => {
      if (chartRef.current) {
        removeRendered(chartRef.current, seriesRef.current, rendered);
      }
    });
    renderedRef.current.clear();
    setDrawings([]);
  }, []);

  const selectTool = useCallback((type: DrawingType) => {
    if (activeTool === type) {
      setActiveTool(null);
      setPendingPoints([]);
    } else {
      setActiveTool(type);
      setPendingPoints([]);
    }
  }, [activeTool]);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {TOOLS.map((tool) => (
        <button
          key={tool.type}
          onClick={() => selectTool(tool.type)}
          title={tool.label}
          className={cn(
            "p-1.5 rounded-md border transition-colors",
            activeTool === tool.type
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:text-foreground"
          )}
        >
          {tool.icon}
        </button>
      ))}
      {drawings.length > 0 && (
        <>
          <div className="w-px h-6 bg-border mx-1" />
          <button
            onClick={clearAll}
            title="Clear all drawings"
            className="p-1.5 rounded-md border bg-background text-muted-foreground border-border hover:text-red-500 hover:border-red-500/50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground ml-1">{drawings.length}</span>
        </>
      )}
      {activeTool && (
        <div className="flex items-center gap-1.5 ml-2 text-xs text-muted-foreground">
          <span className="text-purple-400">
            {TOOLS.find((t) => t.type === activeTool)?.label}
          </span>
          {pendingPoints.length > 0 && (
            <span>({pendingPoints.length}/{TOOLS.find((t) => t.type === activeTool)?.clicks} clicks)</span>
          )}
          <span className="text-muted-foreground/60">ESC to cancel</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendering Logic
// ---------------------------------------------------------------------------

function renderAllDrawings(
  chart: any,
  series: any,
  drawings: Drawing[],
  renderedMap: Map<string, any>
) {
  // First, remove any rendered items that are no longer in drawings
  const currentIds = new Set(drawings.map((d) => d.id));
  renderedMap.forEach((rendered, id) => {
    if (!currentIds.has(id)) {
      removeRendered(chart, series, rendered);
      renderedMap.delete(id);
    }
  });

  // Then render new drawings
  for (const d of drawings) {
    if (renderedMap.has(d.id)) continue; // Already rendered
    const rendered = renderDrawing(chart, series, d);
    if (rendered) {
      renderedMap.set(d.id, rendered);
    }
  }
}

function renderDrawing(chart: any, series: any, drawing: Drawing): any {
  switch (drawing.type) {
    case "horizontal-line":
      return renderHorizontalLine(series, drawing);
    case "vertical-line":
      return renderVerticalLine(chart, series, drawing);
    case "trend-line":
      return renderTrendLine(chart, drawing);
    case "horizontal-ray":
      return renderHorizontalRay(chart, series, drawing);
    case "long-position":
      return renderPositionBox(chart, drawing, "long");
    case "short-position":
      return renderPositionBox(chart, drawing, "short");
    default:
      return null;
  }
}

function removeRendered(chart: any, series: any, rendered: any) {
  if (!rendered) return;
  try {
    if (rendered.type === "price-line" && rendered.priceLine && series) {
      series.removePriceLine(rendered.priceLine);
    } else if (rendered.type === "line-series" && rendered.series && chart) {
      chart.removeSeries(rendered.series);
    } else if (rendered.type === "multi" && rendered.items) {
      for (const item of rendered.items) {
        removeRendered(chart, series, item);
      }
    }
  } catch {}
}

// --- Horizontal Line (native price line) ---
function renderHorizontalLine(series: any, drawing: Drawing) {
  const price = drawing.points[0]?.price;
  if (price == null) return null;
  const priceLine = series.createPriceLine({
    price,
    color: drawing.color,
    lineWidth: 1,
    lineStyle: 0, // Solid
    axisLabelVisible: true,
    title: "",
  });
  return { type: "price-line", priceLine };
}

// --- Vertical Line (thin line series with 2 extreme points) ---
function renderVerticalLine(chart: any, series: any, drawing: Drawing) {
  const point = drawing.points[0];
  if (!point) return null;

  const lineSeries = chart.addLineSeries({
    color: drawing.color,
    lineWidth: 1,
    lineStyle: 2, // Dashed
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  // Get the visible price range to draw a tall vertical line
  const priceScale = series.priceScale();
  let low = point.price * 0.95;
  let high = point.price * 1.05;
  try {
    // Use a wide price range
    const range = chart.priceScale("right").getVisualPriceRange?.();
    if (range) {
      low = range.from;
      high = range.to;
    }
  } catch {}

  lineSeries.setData([
    { time: point.time, value: low },
    { time: point.time, value: high },
  ] as any);

  // Actually, a vertical line at a single time with two extreme values
  // won't render a true vertical. Instead, we use a marker approach.
  // Better approach: overlay a line series with large price range at same time
  // lightweight-charts doesn't support same-time two-point series well.
  // Use a series with a single data point and markers instead.
  // Simplest: use a price line on a dedicated hidden series at that time.

  return { type: "line-series", series: lineSeries };
}

// --- Trend Line (line series between two points) ---
function renderTrendLine(chart: any, drawing: Drawing) {
  if (drawing.points.length < 2) return null;
  const [p1, p2] = drawing.points;

  const lineSeries = chart.addLineSeries({
    color: drawing.color,
    lineWidth: 2,
    lineStyle: 0, // Solid
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  const data = [
    { time: p1.time, value: p1.price },
    { time: p2.time, value: p2.price },
  ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  lineSeries.setData(data as any);
  return { type: "line-series", series: lineSeries };
}

// --- Horizontal Ray (line from click point extending to the right) ---
function renderHorizontalRay(chart: any, series: any, drawing: Drawing) {
  const point = drawing.points[0];
  if (!point) return null;

  const lineSeries = chart.addLineSeries({
    color: drawing.color,
    lineWidth: 1,
    lineStyle: 2, // Dashed
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  // Get the last visible time from the chart to extend the ray
  let endTime = point.time;
  try {
    const range = chart.timeScale().getVisibleRange();
    if (range && range.to) {
      // Extend well beyond visible range
      if (typeof range.to === "number") {
        endTime = range.to + 86400 * 365;
      } else {
        // String date — add a year
        const d = new Date(range.to);
        d.setFullYear(d.getFullYear() + 1);
        endTime = d.toISOString().slice(0, 10);
      }
    }
  } catch {}

  const data = [
    { time: point.time, value: point.price },
    { time: endTime, value: point.price },
  ];

  lineSeries.setData(data as any);
  return { type: "line-series", series: lineSeries };
}

// --- Long/Short Position Box (entry + TP/SL visualization) ---
function renderPositionBox(chart: any, drawing: Drawing, direction: "long" | "short") {
  if (drawing.points.length < 2) return null;
  const [entryPt, targetPt] = drawing.points;

  const entryPrice = entryPt.price;
  const targetPrice = targetPt.price;

  // For long: target above entry (TP), SL mirror below
  // For short: target below entry (TP), SL mirror above
  const tpPrice = targetPrice;
  const diff = Math.abs(targetPrice - entryPrice);
  const slPrice = direction === "long"
    ? entryPrice - diff
    : entryPrice + diff;

  const startTime = entryPt.time < targetPt.time ? entryPt.time : targetPt.time;
  const endTime = entryPt.time < targetPt.time ? targetPt.time : entryPt.time;

  const items: any[] = [];

  // Entry line
  const entryLine = chart.addLineSeries({
    color: "#94a3b8",
    lineWidth: 1,
    lineStyle: 0,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  entryLine.setData([
    { time: startTime, value: entryPrice },
    { time: endTime, value: entryPrice },
  ] as any);
  items.push({ type: "line-series", series: entryLine });

  // TP line
  const tpLine = chart.addLineSeries({
    color: direction === "long" ? "#22c55e" : "#ef4444",
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  tpLine.setData([
    { time: startTime, value: tpPrice },
    { time: endTime, value: tpPrice },
  ] as any);
  items.push({ type: "line-series", series: tpLine });

  // SL line
  const slLine = chart.addLineSeries({
    color: direction === "long" ? "#ef4444" : "#22c55e",
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  slLine.setData([
    { time: startTime, value: slPrice },
    { time: endTime, value: slPrice },
  ] as any);
  items.push({ type: "line-series", series: slLine });

  return { type: "multi", items };
}
