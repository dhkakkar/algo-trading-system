import { create } from "zustand";
import apiClient from "@/lib/api-client";
import type {
  Backtest,
  BacktestListItem,
  BacktestTrade,
  CreateBacktestRequest,
} from "@/types/backtest";

interface BacktestState {
  backtests: BacktestListItem[];
  currentBacktest: Backtest | null;
  trades: BacktestTrade[];
  loading: boolean;
  error: string | null;

  // Progress tracking (via Socket.IO)
  progress: Record<string, { percent: number; current_date: string }>;

  fetchBacktests: () => Promise<void>;
  fetchBacktest: (id: string) => Promise<void>;
  fetchTrades: (id: string) => Promise<void>;
  createBacktest: (data: CreateBacktestRequest) => Promise<string>;
  deleteBacktest: (id: string) => Promise<void>;
  cancelBacktest: (id: string) => Promise<void>;
  setProgress: (
    backtestId: string,
    percent: number,
    current_date: string
  ) => void;
  markCompleted: (backtestId: string) => void;
  markFailed: (backtestId: string) => void;
  clearError: () => void;
}

export const useBacktestStore = create<BacktestState>((set, get) => ({
  backtests: [],
  currentBacktest: null,
  trades: [],
  loading: false,
  error: null,
  progress: {},

  fetchBacktests: async () => {
    set({ loading: true, error: null });
    try {
      const res = await apiClient.get("/backtests");
      set({ backtests: res.data, loading: false });
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || "Failed to fetch backtests",
        loading: false,
      });
    }
  },

  fetchBacktest: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const res = await apiClient.get(`/backtests/${id}`);
      set({ currentBacktest: res.data, loading: false });
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || "Failed to fetch backtest",
        loading: false,
      });
    }
  },

  fetchTrades: async (id: string) => {
    try {
      const res = await apiClient.get(`/backtests/${id}/trades`);
      set({ trades: res.data });
    } catch {
      // trades endpoint may not exist yet, ignore
      set({ trades: [] });
    }
  },

  createBacktest: async (data: CreateBacktestRequest) => {
    set({ loading: true, error: null });
    try {
      const res = await apiClient.post("/backtests", data);
      set({ loading: false });
      // Refresh list
      get().fetchBacktests();
      return res.data.id;
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || "Failed to create backtest",
        loading: false,
      });
      throw err;
    }
  },

  deleteBacktest: async (id: string) => {
    try {
      await apiClient.delete(`/backtests/${id}`);
      set((s) => ({
        backtests: s.backtests.filter((b) => b.id !== id),
      }));
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || "Failed to delete backtest",
      });
    }
  },

  cancelBacktest: async (id: string) => {
    try {
      await apiClient.post(`/backtests/${id}/cancel`);
      get().fetchBacktests();
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || "Failed to cancel backtest",
      });
    }
  },

  setProgress: (backtestId, percent, current_date) => {
    set((s) => ({
      progress: {
        ...s.progress,
        [backtestId]: { percent, current_date },
      },
    }));
  },

  markCompleted: (backtestId) => {
    set((s) => ({
      backtests: s.backtests.map((b) =>
        b.id === backtestId ? { ...b, status: "completed" as const } : b
      ),
      progress: {
        ...s.progress,
        [backtestId]: { percent: 100, current_date: "" },
      },
    }));
  },

  markFailed: (backtestId) => {
    set((s) => ({
      backtests: s.backtests.map((b) =>
        b.id === backtestId ? { ...b, status: "failed" as const } : b
      ),
    }));
  },

  clearError: () => set({ error: null }),
}));
