"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

interface FileUploadProps {
  onFileLoaded: (code: string, filename: string) => void;
}

export function FileUpload({ onFileLoaded }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      if (!file.name.endsWith(".py")) {
        setError("Only .py files are accepted");
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError("File size must be less than 1MB");
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const code = e.target?.result as string;
        setFileName(file.name);
        onFileLoaded(code, file.name);
      };
      reader.onerror = () => {
        setError("Failed to read file");
      };
      reader.readAsText(file);
    },
    [onFileLoaded]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleClear = useCallback(() => {
    setFileName(null);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  return (
    <div className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center
          rounded-lg border-2 border-dashed p-8 cursor-pointer
          transition-colors duration-200
          ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".py"
          onChange={handleFileChange}
          className="hidden"
        />

        {fileName ? (
          <div className="flex flex-col items-center space-y-2">
            <FileCode className="h-10 w-10 text-primary" />
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">{fileName}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Click or drag to replace
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-2">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Drop your Python file here
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse (.py files, max 1MB)
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
