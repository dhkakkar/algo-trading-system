"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, XCircle, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StrategyEditor } from "@/components/strategy/strategy-editor";
import { FileUpload } from "@/components/strategy/file-upload";
import { useStrategyStore } from "@/stores/strategy-store";

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "30m", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "1d", label: "1 Day" },
];

type SourceTab = "editor" | "upload";

export default function NewStrategyPage() {
  const router = useRouter();
  const { createStrategy, validateStrategy, isLoading } = useStrategyStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [timeframe, setTimeframe] = useState("1d");
  const [instrumentsText, setInstrumentsText] = useState("");
  const [sourceTab, setSourceTab] = useState<SourceTab>("editor");

  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    error: string | null;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      const instruments = instrumentsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await createStrategy({
        name: name.trim(),
        description: description.trim() || undefined,
        code,
        timeframe,
        instruments: instruments.length > 0 ? instruments : undefined,
      });

      router.push("/strategies");
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

    // To validate, we first need to save the strategy, then validate.
    // For a new (unsaved) strategy, we do a quick save first then validate.
    // However, the API spec has validate on an existing strategy.
    // So we save it first, validate, and if invalid, user can fix and re-save.
    if (!name.trim() || !code.trim()) {
      setValidationResult({
        valid: false,
        error: "Please provide a name and code before validating",
      });
      setIsValidating(false);
      return;
    }

    try {
      const instruments = instrumentsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const strategy = await createStrategy({
        name: name.trim(),
        description: description.trim() || undefined,
        code,
        timeframe,
        instruments: instruments.length > 0 ? instruments : undefined,
      });

      const result = await validateStrategy(strategy.id);
      setValidationResult(result);

      // If valid, redirect after a brief moment
      if (result.valid) {
        setTimeout(() => {
          router.push(`/strategies/${strategy.id}`);
        }, 1500);
      } else {
        // Redirect to edit page so user can fix issues on saved strategy
        router.push(`/strategies/${strategy.id}`);
      }
    } catch (err: any) {
      setValidationResult({
        valid: false,
        error:
          err.response?.data?.detail ||
          err.message ||
          "Validation failed",
      });
    } finally {
      setIsValidating(false);
    }
  };

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
            <h1 className="text-2xl font-bold tracking-tight">
              New Strategy
            </h1>
            <p className="text-muted-foreground text-sm">
              Write or upload your trading strategy code
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
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
        </div>
      </div>

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
              <Label htmlFor="instruments">Instruments</Label>
              <Input
                id="instruments"
                placeholder="RELIANCE, INFY, TCS"
                value={instrumentsText}
                onChange={(e) => setInstrumentsText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of instrument symbols
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
