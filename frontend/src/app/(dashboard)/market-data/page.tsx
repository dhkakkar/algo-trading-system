"use client";

import { useState } from "react";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";

interface Instrument {
  instrument_token: number;
  tradingsymbol: string;
  name: string | null;
  exchange: string;
  segment: string | null;
  instrument_type: string | null;
  lot_size: number;
}

export default function MarketDataPage() {
  const [query, setQuery] = useState("");
  const [exchange, setExchange] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const params: Record<string, string> = { query: query.trim() };
      if (exchange) params.exchange = exchange;
      const res = await apiClient.get("/market-data/instruments", { params });
      setInstruments(res.data);
    } catch {
      setInstruments([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Market Data</h1>
        <p className="text-muted-foreground">
          Browse instruments and historical data
        </p>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Search Instruments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="search">Symbol</Label>
              <Input
                id="search"
                placeholder="Search by symbol (e.g. RELIANCE, INFY, NIFTY)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <div className="w-32 space-y-2">
              <Label htmlFor="exchange">Exchange</Label>
              <select
                id="exchange"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
              >
                <option value="">All</option>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
                <option value="NFO">NFO</option>
                <option value="MCX">MCX</option>
              </select>
            </div>
            <Button onClick={handleSearch} disabled={loading || !query.trim()}>
              <Search className="h-4 w-4 mr-2" />
              {loading ? "Searching..." : "Search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {searched && (
        <Card>
          <CardHeader>
            <CardTitle>
              Results {instruments.length > 0 && `(${instruments.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {instruments.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                {loading ? "Searching..." : "No instruments found. Make sure instrument data has been loaded."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium">Symbol</th>
                      <th className="text-left py-3 px-2 font-medium">Name</th>
                      <th className="text-left py-3 px-2 font-medium">Exchange</th>
                      <th className="text-left py-3 px-2 font-medium">Segment</th>
                      <th className="text-left py-3 px-2 font-medium">Type</th>
                      <th className="text-right py-3 px-2 font-medium">Lot Size</th>
                      <th className="text-right py-3 px-2 font-medium">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instruments.map((inst) => (
                      <tr key={inst.instrument_token} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-2 font-medium">{inst.tradingsymbol}</td>
                        <td className="py-2 px-2 text-muted-foreground">{inst.name || "-"}</td>
                        <td className="py-2 px-2">{inst.exchange}</td>
                        <td className="py-2 px-2">{inst.segment || "-"}</td>
                        <td className="py-2 px-2">{inst.instrument_type || "-"}</td>
                        <td className="py-2 px-2 text-right">{inst.lot_size}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">{inst.instrument_token}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
