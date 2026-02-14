"use client";

import { useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

const DEFAULT_TEMPLATE = `class MyStrategy(Strategy):
    def on_init(self, ctx):
        # Initialize your strategy here
        self.period = ctx.get_param("period", 20)

    def on_data(self, ctx):
        # Your strategy logic here
        data = ctx.get_historical_data("RELIANCE", periods=self.period)
        close = data["close"]

        sma = ctx.sma(close, self.period)

        position = ctx.get_position("RELIANCE")

        if ctx.crossover(close, sma) and position is None:
            ctx.buy("RELIANCE", quantity=10)
            ctx.log("BUY signal")

        elif ctx.crossunder(close, sma) and position is not None:
            ctx.sell("RELIANCE", quantity=10)
            ctx.log("SELL signal")
`;

interface StrategyEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function StrategyEditor({
  value,
  onChange,
  readOnly = false,
}: StrategyEditorProps) {
  const editorRef = useRef<any>(null);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const displayValue = value || DEFAULT_TEMPLATE;

  return (
    <div className="h-full w-full rounded-md border border-input overflow-hidden">
      <Editor
        height="100%"
        defaultLanguage="python"
        theme="vs-dark"
        value={displayValue}
        onChange={(val) => onChange(val ?? "")}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 4,
          insertSpaces: true,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          smoothScrolling: true,
          contextmenu: true,
          folding: true,
          bracketPairColorization: { enabled: true },
        }}
        loading={
          <div className="flex items-center justify-center h-full bg-[#1e1e1e] text-gray-400 text-sm">
            Loading editor...
          </div>
        }
      />
    </div>
  );
}
