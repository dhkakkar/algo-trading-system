"use client";

import { useState } from "react";
import apiClient from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, RefreshCw, AlertCircle, CheckCircle2, LineChart } from "lucide-react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const { user } = useAuthStore();
  const [query, setQuery] = useState("");
  const [exchange, setExchange] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  const handleRefreshInstruments = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await apiClient.post("/admin/instruments/refresh");
      setRefreshMsg({
        type: "success",
        text: res.data.message || `Loaded ${res.data.count} instruments`,
      });
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        "Failed to load instruments. Make sure your Kite account is connected in Settings.";
      setRefreshMsg({ type: "error", text: msg });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Market Data</h1>
          <p className="text-muted-foreground">
            Browse instruments and historical data
          </p>
        </div>
        {user?.is_superadmin && (
          <Button
            onClick={handleRefreshInstruments}
            disabled={refreshing}
            variant="outline"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Loading instruments..." : "Load Instruments from Kite"}
          </Button>
        )}
      </div>

      {/* Refresh status message */}
      {refreshMsg && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg border text-sm ${
            refreshMsg.type === "success"
              ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200"
              : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200"
          }`}
        >
          {refreshMsg.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {refreshMsg.text}
        </div>
      )}

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
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground space-y-2">
                <p>
                  {loading
                    ? "Searching..."
                    : "No instruments found."}
                </p>
                {!loading && user?.is_superadmin && (
                  <p className="text-sm">
                    Click &quot;Load Instruments from Kite&quot; above to fetch the instrument list.
                  </p>
                )}
                {!loading && !user?.is_superadmin && (
                  <p className="text-sm">
                    Ask your admin to load instrument data from Kite Connect.
                  </p>
                )}
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
                      <th className="text-right py-3 px-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {instruments.map((inst) => (
                      <tr
                        key={inst.instrument_token}
                        className="border-b hover:bg-muted/50"
                      >
                        <td className="py-2 px-2 font-medium">
                          {inst.tradingsymbol}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {inst.name || "-"}
                        </td>
                        <td className="py-2 px-2">{inst.exchange}</td>
                        <td className="py-2 px-2">{inst.segment || "-"}</td>
                        <td className="py-2 px-2">
                          {inst.instrument_type || "-"}
                        </td>
                        <td className="py-2 px-2 text-right">{inst.lot_size}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">
                          {inst.instrument_token}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              router.push(
                                `/market-data/chart?symbol=${encodeURIComponent(inst.tradingsymbol)}&exchange=${encodeURIComponent(inst.exchange)}`
                              )
                            }
                          >
                            <LineChart className="h-3.5 w-3.5 mr-1" />
                            Chart
                          </Button>
                        </td>
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
