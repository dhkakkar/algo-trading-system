"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  Trash2,
  FlaskConical,
  Play,
  Zap,
  Plus,
  X,
  Clock,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StrategyEditor } from "@/components/strategy/strategy-editor";
import { FileUpload } from "@/components/strategy/file-upload";
import { InstrumentSearch } from "@/components/strategy/instrument-search";
import { useStrategyStore } from "@/stores/strategy-store";
import { useBacktestStore } from "@/stores/backtest-store";
import { useTradingStore } from "@/stores/trading-store";
import { useToastStore } from "@/stores/toast-store";

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "30m", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "1d", label: "1 Day" },
];

type SourceTab = "editor" | "upload";

export default function EditStrategyPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const {
    currentStrategy,
    isLoading: storeLoading,
    fetchStrategy,
    updateStrategy,
    deleteStrategy,
    validateStrategy,
    clearCurrentStrategy,
  } = useStrategyStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [timeframe, setTimeframe] = useState("1d");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [sourceTab, setSourceTab] = useState<SourceTab>("editor");

  const { createBacktest } = useBacktestStore();
  const { createSession, startSession } = useTradingStore();
  const { addToast } = useToastStore();

  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBacktestPanel, setShowBacktestPanel] = useState(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [btStartDate, setBtStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [btEndDate, setBtEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [btCapital, setBtCapital] = useState("100000");
  const [btCommissionType, setBtCommissionType] = useState<"zerodha" | "flat">("zerodha");
  const [btFlatCommission, setBtFlatCommission] = useState("0");
  const [btSlippage, setBtSlippage] = useState("0.05");
  const [btEodSquareOff, setBtEodSquareOff] = useState("15:10");
  const [btEodEnabled, setBtEodEnabled] = useState(true);
  const [btTimeLocks, setBtTimeLocks] = useState<{ start: string; end: string }[]>([]);
  const [btOptionsMode, setBtOptionsMode] = useState(false);
  const [btOptionsExpiryType, setBtOptionsExpiryType] = useState<"weekly" | "monthly">("weekly");
  const [btOptionsStrikeOffset, setBtOptionsStrikeOffset] = useState("0");

  // Trading session state
  const [showTradingPanel, setShowTradingPanel] = useState<"paper" | "live" | null>(null);
  const [tradingCapital, setTradingCapital] = useState("100000");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [tradeEodEnabled, setTradeEodEnabled] = useState(true);
  const [tradeEodTime, setTradeEodTime] = useState("15:10");
  const [tradeTimeLocks, setTradeTimeLocks] = useState<{ start: string; end: string }[]>([]);
  const [tradeOptionsMode, setTradeOptionsMode] = useState(false);
  const [tradeOptionsExpiryType, setTradeOptionsExpiryType] = useState<"weekly" | "monthly">("weekly");
  const [tradeOptionsStrikeOffset, setTradeOptionsStrikeOffset] = useState("0");
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    error: string | null;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Fetch strategy on mount
  useEffect(() => {
    fetchStrategy(id);
    return () => {
      clearCurrentStrategy();
    };
  }, [id, fetchStrategy, clearCurrentStrategy]);

  // Populate form when strategy loads
  useEffect(() => {
    if (currentStrategy && !initialized) {
      setName(currentStrategy.name);
      setDescription(currentStrategy.description || "");
      setCode(currentStrategy.code);
      setTimeframe(currentStrategy.timeframe || "1d");
      setInstruments(currentStrategy.instruments || []);
      setSourceTab(currentStrategy.source_type === "upload" ? "upload" : "editor");
      setInitialized(true);
    }
  }, [currentStrategy, initialized]);

  const handleFileLoaded = useCallback((fileCode: string, _filename: string) => {
    setCode(fileCode);
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      setSaveError("Strategy name is required");
      return;
    }
    if (!code.trim()) {
      setSaveError("Strategy code is required");
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      await updateStrategy(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        code,
        timeframe,
        instruments: instruments.length > 0 ? instruments : [],
      });

      setSaveError(null);
      // Re-fetch to get updated version number
      await fetchStrategy(id);
      setInitialized(false); // Allow re-population from updated data
    } catch (err: any) {
      setSaveError(
        err.response?.data?.detail || err.message || "Failed to save strategy"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidationResult(null);
    setIsValidating(true);

    try {
      // Save first to ensure latest code is persisted
      if (name.trim() && code.trim()) {
        await updateStrategy(id, {
          name: name.trim(),
          description: description.trim() || undefined,
          code,
          timeframe,
          instruments: instruments.length > 0 ? instruments : [],
        });
      }

      const result = await validateStrategy(id);
      setValidationResult(result);
    } catch (err: any) {
      setValidationResult({
        valid: false,
        error:
          err.response?.data?.detail || err.message || "Validation failed",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteStrategy(id);
      addToast("success", "Strategy deleted successfully");
      router.push("/strategies");
    } catch (err: any) {
      setSaveError(
        err.response?.data?.detail || err.message || "Failed to delete strategy"
      );
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleRunBacktest = async () => {
    setIsRunningBacktest(true);
    setSaveError(null);

    try {
      // Save strategy first
      if (name.trim() && code.trim()) {
        await updateStrategy(id, {
          name: name.trim(),
          description: description.trim() || undefined,
          code,
          timeframe,
          instruments: instruments.length > 0 ? instruments : [],
        });
      }

      const backtestId = await createBacktest({
        strategy_id: id,
        start_date: btStartDate,
        end_date: btEndDate,
        initial_capital: parseFloat(btCapital) || 100000,
        timeframe,
        instruments: instruments.length > 0 ? instruments : undefined,
        parameters: {
          commission_type: btCommissionType,
          flat_commission: parseFloat(btFlatCommission) || 0,
          slippage_percent: parseFloat(btSlippage) || 0,
          eod_square_off_time: btEodEnabled ? btEodSquareOff : "",
          time_locks: btTimeLocks.filter((l) => l.start && l.end),
          options_mode: btOptionsMode,
          options_expiry_type: btOptionsExpiryType,
          options_strike_offset: parseInt(btOptionsStrikeOffset) || 0,
        },
      });

      router.push(`/backtests/${backtestId}`);
    } catch (err: any) {
      setSaveError(
        err.response?.data?.detail || err.message || "Failed to run backtest"
      );
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const handleStartTrading = async (mode: "paper" | "live") => {
    setIsCreatingSession(true);
    setSaveError(null);

    try {
      // Save strategy first
      if (name.trim() && code.trim()) {
        await updateStrategy(id, {
          name: name.trim(),
          description: description.trim() || undefined,
          code,
          timeframe,
          instruments: instruments.length > 0 ? instruments : [],
        });
      }

      // Create session
      const sessionId = await createSession({
        strategy_id: id,
        mode,
        initial_capital: parseFloat(tradingCapital) || 100000,
        instruments: instruments.length > 0 ? instruments : undefined,
        timeframe,
        parameters: {
          eod_square_off_time: tradeEodEnabled ? tradeEodTime : "",
          time_locks: tradeTimeLocks.filter((l) => l.start && l.end),
          options_mode: tradeOptionsMode,
          options_expiry_type: tradeOptionsExpiryType,
          options_strike_offset: parseInt(tradeOptionsStrikeOffset) || 0,
        },
      });

      // Auto-start the session
      await startSession(sessionId);

      // Navigate to the trading detail page
      router.push(`/${mode === "paper" ? "paper-trading" : "live-trading"}/${sessionId}`);
    } catch (err: any) {
      setSaveError(
        err.response?.data?.detail || err.message || `Failed to start ${mode} trading`
      );
    } finally {
      setIsCreatingSession(false);
    }
  };

  // Loading state
  if (storeLoading && !initialized) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not found
  if (!storeLoading && !currentStrategy && !initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-muted-foreground">Strategy not found</p>
        <Button variant="outline" asChild>
          <Link href="/strategies">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Strategies
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/strategies">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-bold tracking-tight">
                Edit Strategy
              </h1>
              {currentStrategy && (
                <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  v{currentStrategy.version}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Modify your trading strategy code and configuration
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-destructive hover:text-destructive"
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button
            variant="outline"
            onClick={handleValidate}
            disabled={isValidating || isSaving}
          >
            {isValidating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Validate
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isValidating}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Strategy
          </Button>
          <Button
            variant="default"
            onClick={() => setShowBacktestPanel(!showBacktestPanel)}
            className="bg-green-600 hover:bg-green-700"
          >
            <FlaskConical className="h-4 w-4 mr-2" />
            Run Backtest
          </Button>
          <Button
            variant="default"
            onClick={() => setShowTradingPanel(showTradingPanel === "paper" ? null : "paper")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Play className="h-4 w-4 mr-2" />
            Paper Trade
          </Button>
          <Button
            variant="default"
            onClick={() => setShowTradingPanel(showTradingPanel === "live" ? null : "live")}
            className="bg-orange-600 hover:bg-orange-700"
          >
            <Zap className="h-4 w-4 mr-2" />
            Live Trade
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/10 p-3 flex-shrink-0">
          <span className="text-sm text-destructive">
            Are you sure you want to delete this strategy? This cannot be undone.
          </span>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Validation result */}
      {validationResult && (
        <div
          className={`flex items-center space-x-2 rounded-lg border p-3 text-sm flex-shrink-0 ${
            validationResult.valid
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-destructive/50 bg-destructive/10 text-destructive"
          }`}
        >
          {validationResult.valid ? (
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 flex-shrink-0" />
          )}
          <span>
            {validationResult.valid
              ? "Strategy is valid!"
              : validationResult.error || "Validation failed"}
          </span>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="flex items-center space-x-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex-shrink-0">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Backtest config panel */}
      {showBacktestPanel && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 flex-shrink-0 space-y-3">
          <div className="flex items-center gap-4">
            <FlaskConical className="h-5 w-5 text-green-600 flex-shrink-0" />
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="bt-start" className="text-sm whitespace-nowrap">Start</Label>
                <Input
                  id="bt-start"
                  type="date"
                  value={btStartDate}
                  onChange={(e) => setBtStartDate(e.target.value)}
                  className="w-40 h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="bt-end" className="text-sm whitespace-nowrap">End</Label>
                <Input
                  id="bt-end"
                  type="date"
                  value={btEndDate}
                  onChange={(e) => setBtEndDate(e.target.value)}
                  className="w-40 h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="bt-capital" className="text-sm whitespace-nowrap">Capital</Label>
                <Input
                  id="bt-capital"
                  type="number"
                  value={btCapital}
                  onChange={(e) => setBtCapital(e.target.value)}
                  className="w-32 h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBacktestPanel(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRunBacktest}
                disabled={isRunningBacktest}
                className="bg-green-600 hover:bg-green-700"
              >
                {isRunningBacktest ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FlaskConical className="h-4 w-4 mr-2" />
                )}
                Run
              </Button>
            </div>
          </div>
          {/* Commission & Slippage row */}
          <div className="flex items-center gap-3 pl-9 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="bt-commission" className="text-sm whitespace-nowrap">Commission</Label>
              <select
                id="bt-commission"
                value={btCommissionType}
                onChange={(e) => setBtCommissionType(e.target.value as "zerodha" | "flat")}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="zerodha">Zerodha (Realistic)</option>
                <option value="flat">Flat per Order</option>
              </select>
            </div>
            {btCommissionType === "flat" && (
              <div className="flex items-center gap-2">
                <Label htmlFor="bt-flat-comm" className="text-sm whitespace-nowrap">&#8377;/order</Label>
                <Input
                  id="bt-flat-comm"
                  type="number"
                  value={btFlatCommission}
                  onChange={(e) => setBtFlatCommission(e.target.value)}
                  className="w-24 h-8 text-sm"
                  min="0"
                  step="1"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="bt-slippage" className="text-sm whitespace-nowrap">Slippage %</Label>
              <Input
                id="bt-slippage"
                type="number"
                value={btSlippage}
                onChange={(e) => setBtSlippage(e.target.value)}
                className="w-24 h-8 text-sm"
                min="0"
                step="0.01"
              />
            </div>
          </div>
          {/* EOD Square-off & Time Locks row */}
          <div className="flex items-start gap-3 pl-9 flex-wrap">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="bt-eod-enabled"
                checked={btEodEnabled}
                onChange={(e) => setBtEodEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="bt-eod-enabled" className="text-sm whitespace-nowrap flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> EOD Square-off
              </Label>
              {btEodEnabled && (
                <Input
                  type="time"
                  value={btEodSquareOff}
                  onChange={(e) => setBtEodSquareOff(e.target.value)}
                  className="w-28 h-8 text-sm"
                />
              )}
            </div>
            <div className="border-l border-border pl-3 flex items-start gap-2">
              <Label className="text-sm whitespace-nowrap flex items-center gap-1 pt-1">
                <Lock className="h-3.5 w-3.5" /> Time Locks
              </Label>
              <div className="flex flex-col gap-1.5">
                {btTimeLocks.map((lock, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      value={lock.start}
                      onChange={(e) => {
                        const updated = [...btTimeLocks];
                        updated[i] = { ...updated[i], start: e.target.value };
                        setBtTimeLocks(updated);
                      }}
                      className="w-28 h-7 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={lock.end}
                      onChange={(e) => {
                        const updated = [...btTimeLocks];
                        updated[i] = { ...updated[i], end: e.target.value };
                        setBtTimeLocks(updated);
                      }}
                      className="w-28 h-7 text-sm"
                    />
                    <button
                      onClick={() => setBtTimeLocks(btTimeLocks.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setBtTimeLocks([...btTimeLocks, { start: "09:15", end: "09:30" }])}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" /> Add time lock
                </button>
              </div>
            </div>
          </div>
          {/* Options Mode row */}
          <div className="flex items-center gap-3 pl-9 flex-wrap">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="bt-options-mode"
                checked={btOptionsMode}
                onChange={(e) => setBtOptionsMode(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="bt-options-mode" className="text-sm whitespace-nowrap">
                Options Mode
              </Label>
            </div>
            {btOptionsMode && (
              <>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Expiry</Label>
                  <select
                    value={btOptionsExpiryType}
                    onChange={(e) => setBtOptionsExpiryType(e.target.value as "weekly" | "monthly")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Strike Offset</Label>
                  <Input
                    type="number"
                    value={btOptionsStrikeOffset}
                    onChange={(e) => setBtOptionsStrikeOffset(e.target.value)}
                    className="w-20 h-8 text-sm"
                    min="-5"
                    max="5"
                    step="1"
                    title="0=ATM, +1=one step OTM, -1=one step ITM"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  BUY signal → ATM CE, SELL signal → ATM PE
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Trading session config panel */}
      {showTradingPanel && (
        <div
          className={`rounded-lg border p-4 flex-shrink-0 space-y-3 ${
            showTradingPanel === "paper"
              ? "border-blue-500/50 bg-blue-500/10"
              : "border-orange-500/50 bg-orange-500/10"
          }`}
        >
          <div className="flex items-center gap-4">
            {showTradingPanel === "paper" ? (
              <Play className="h-5 w-5 text-blue-600 flex-shrink-0" />
            ) : (
              <Zap className="h-5 w-5 text-orange-600 flex-shrink-0" />
            )}
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <span className="text-sm font-medium">
                {showTradingPanel === "paper" ? "Paper Trading" : "Live Trading"}
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor="trading-capital" className="text-sm whitespace-nowrap">
                  Capital
                </Label>
                <Input
                  id="trading-capital"
                  type="number"
                  value={tradingCapital}
                  onChange={(e) => setTradingCapital(e.target.value)}
                  className="w-32 h-8 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                Timeframe: {timeframe} | Instruments: {instruments.length > 0 ? instruments.join(", ") : "from strategy code"}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTradingPanel(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => handleStartTrading(showTradingPanel)}
                disabled={isCreatingSession}
                className={
                  showTradingPanel === "paper"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-orange-600 hover:bg-orange-700"
                }
              >
                {isCreatingSession ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : showTradingPanel === "paper" ? (
                  <Play className="h-4 w-4 mr-2" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Start {showTradingPanel === "paper" ? "Paper" : "Live"} Trading
              </Button>
            </div>
          </div>
          {/* EOD Square-off & Time Locks */}
          <div className="flex items-start gap-3 pl-9 flex-wrap">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="trade-eod-enabled"
                checked={tradeEodEnabled}
                onChange={(e) => setTradeEodEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="trade-eod-enabled" className="text-sm whitespace-nowrap flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> EOD Square-off
              </Label>
              {tradeEodEnabled && (
                <Input
                  type="time"
                  value={tradeEodTime}
                  onChange={(e) => setTradeEodTime(e.target.value)}
                  className="w-28 h-8 text-sm"
                />
              )}
            </div>
            <div className="border-l border-border pl-3 flex items-start gap-2">
              <Label className="text-sm whitespace-nowrap flex items-center gap-1 pt-1">
                <Lock className="h-3.5 w-3.5" /> Time Locks
              </Label>
              <div className="flex flex-col gap-1.5">
                {tradeTimeLocks.map((lock, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      value={lock.start}
                      onChange={(e) => {
                        const updated = [...tradeTimeLocks];
                        updated[i] = { ...updated[i], start: e.target.value };
                        setTradeTimeLocks(updated);
                      }}
                      className="w-28 h-7 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={lock.end}
                      onChange={(e) => {
                        const updated = [...tradeTimeLocks];
                        updated[i] = { ...updated[i], end: e.target.value };
                        setTradeTimeLocks(updated);
                      }}
                      className="w-28 h-7 text-sm"
                    />
                    <button
                      onClick={() => setTradeTimeLocks(tradeTimeLocks.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setTradeTimeLocks([...tradeTimeLocks, { start: "09:15", end: "09:30" }])}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" /> Add time lock
                </button>
              </div>
            </div>
          </div>
          {/* Options Mode row */}
          <div className="flex items-center gap-3 pl-9 flex-wrap">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="trade-options-mode"
                checked={tradeOptionsMode}
                onChange={(e) => setTradeOptionsMode(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="trade-options-mode" className="text-sm whitespace-nowrap">
                Options Mode
              </Label>
            </div>
            {tradeOptionsMode && (
              <>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Expiry</Label>
                  <select
                    value={tradeOptionsExpiryType}
                    onChange={(e) => setTradeOptionsExpiryType(e.target.value as "weekly" | "monthly")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Strike Offset</Label>
                  <Input
                    type="number"
                    value={tradeOptionsStrikeOffset}
                    onChange={(e) => setTradeOptionsStrikeOffset(e.target.value)}
                    className="w-20 h-8 text-sm"
                    min="-5"
                    max="5"
                    step="1"
                    title="0=ATM, +1=one step OTM, -1=one step ITM"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  BUY signal → ATM CE, SELL signal → ATM PE
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main content: Editor + Config */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Code editor / Upload (70%) */}
        <div className="w-[70%] flex flex-col min-h-0">
          {/* Tab toggle */}
          <div className="flex border-b mb-3 flex-shrink-0">
            <button
              onClick={() => setSourceTab("editor")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                sourceTab === "editor"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Code Editor
            </button>
            <button
              onClick={() => setSourceTab("upload")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                sourceTab === "upload"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Upload File
            </button>
          </div>

          {/* Editor / Upload area */}
          <div className="flex-1 min-h-0">
            {sourceTab === "editor" ? (
              <StrategyEditor value={code} onChange={setCode} />
            ) : (
              <div className="h-full flex flex-col">
                <FileUpload onFileLoaded={handleFileLoaded} />
                {code && sourceTab === "upload" && (
                  <div className="mt-3 flex-1 min-h-0">
                    <StrategyEditor value={code} onChange={setCode} readOnly />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Config form (30%) */}
        <div className="w-[30%] space-y-4 overflow-y-auto">
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <h2 className="text-lg font-semibold">Configuration</h2>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="My Strategy"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                placeholder="Describe what your strategy does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>

            {/* Timeframe */}
            <div className="space-y-2">
              <Label htmlFor="timeframe">Timeframe</Label>
              <select
                id="timeframe"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {TIMEFRAME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Instruments */}
            <div className="space-y-2">
              <Label>Instruments</Label>
              <InstrumentSearch value={instruments} onChange={setInstruments} />
            </div>
          </div>

          {/* Strategy info */}
          {currentStrategy && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-lg font-semibold">Info</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-medium">v{currentStrategy.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-medium capitalize">
                    {currentStrategy.source_type}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={`font-medium ${
                      currentStrategy.is_active
                        ? "text-green-600 dark:text-green-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {currentStrategy.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">
                    {new Date(currentStrategy.created_at).toLocaleDateString(
                      "en-IN",
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="font-medium">
                    {new Date(currentStrategy.updated_at).toLocaleDateString(
                      "en-IN",
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
