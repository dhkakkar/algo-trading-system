"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { X, Search } from "lucide-react";
import apiClient from "@/lib/api-client";

interface Instrument {
  instrument_token: number;
  tradingsymbol: string;
  name: string | null;
  exchange: string;
  instrument_type: string | null;
}

interface InstrumentSearchProps {
  value: string[];
  onChange: (instruments: string[]) => void;
}

export function InstrumentSearch({ value, onChange }: InstrumentSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const searchInstruments = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.get("/market-data/instruments", {
        params: { query: q },
      });
      setResults(res.data.slice(0, 20));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    setIsOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchInstruments(val), 300);
  };

  const addInstrument = (inst: Instrument) => {
    const tag = `${inst.exchange}:${inst.tradingsymbol}`;
    if (!value.includes(tag)) {
      onChange([...value, tag]);
    }
    setQuery("");
    setResults([]);
    setIsOpen(false);
  };

  const removeInstrument = (tag: string) => {
    onChange(value.filter((v) => v !== tag));
  };

  return (
    <div ref={wrapperRef} className="space-y-2">
      {/* Selected instruments as tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeInstrument(tag)}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search instruments... (e.g. SBIN, RELIANCE)"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => query.length > 0 && setIsOpen(true)}
          className="pl-8 h-9 text-sm"
        />

        {/* Dropdown */}
        {isOpen && (query.length > 0) && (
          <div className="absolute z-50 top-full mt-1 w-full bg-card border rounded-md shadow-lg max-h-48 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                Searching...
              </div>
            ) : results.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                No instruments found
              </div>
            ) : (
              results.map((inst) => {
                const tag = `${inst.exchange}:${inst.tradingsymbol}`;
                const alreadyAdded = value.includes(tag);
                return (
                  <button
                    key={inst.instrument_token}
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() => addInstrument(inst)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                      alreadyAdded ? "opacity-50 cursor-default" : "cursor-pointer"
                    }`}
                  >
                    <div>
                      <span className="font-medium">{inst.exchange}:{inst.tradingsymbol}</span>
                      {inst.name && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          {inst.name}
                        </span>
                      )}
                    </div>
                    {inst.instrument_type && (
                      <span className="text-xs text-muted-foreground">
                        {inst.instrument_type}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
