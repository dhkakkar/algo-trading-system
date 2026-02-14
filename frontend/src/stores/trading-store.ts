import { create } from "zustand";
import apiClient from "@/lib/api-client";
import type {
  TradingSession,
  TradingSessionListItem,
  TradingSnapshot,
  CreateSessionRequest,
} from "@/types/trading";

interface TradingState {
  sessions: TradingSessionListItem[];
  currentSession: TradingSession | null;
  snapshot: TradingSnapshot | null;
  loading: boolean;
  error: string | null;

  fetchSessions: (mode?: string) => Promise<void>;
  fetchSession: (id: string) => Promise<void>;
  createSession: (data: CreateSessionRequest) => Promise<string>;
  startSession: (id: string) => Promise<void>;
  stopSession: (id: string) => Promise<void>;
  pauseSession: (id: string) => Promise<void>;
  resumeSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  fetchSnapshot: (id: string) => Promise<void>;
  setSnapshot: (snapshot: TradingSnapshot) => void;
  clearError: () => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  sessions: [],
  currentSession: null,
  snapshot: null,
  loading: false,
  error: null,

  fetchSessions: async (mode?: string) => {
    set({ loading: true, error: null });
    try {
      const params = mode ? { mode } : {};
      const res = await apiClient.get("/trading/sessions", { params });
      set({ sessions: res.data, loading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to fetch sessions", loading: false });
    }
  },

  fetchSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const res = await apiClient.get(`/trading/sessions/${id}`);
      set({ currentSession: res.data, loading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to fetch session", loading: false });
    }
  },

  createSession: async (data: CreateSessionRequest) => {
    set({ loading: true, error: null });
    try {
      const res = await apiClient.post("/trading/sessions", data);
      set({ loading: false });
      get().fetchSessions(data.mode);
      return res.data.id;
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to create session", loading: false });
      throw err;
    }
  },

  startSession: async (id: string) => {
    try {
      await apiClient.post(`/trading/sessions/${id}/start`);
      get().fetchSession(id);
      get().fetchSessions();
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to start session" });
    }
  },

  stopSession: async (id: string) => {
    try {
      await apiClient.post(`/trading/sessions/${id}/stop`);
      get().fetchSession(id);
      get().fetchSessions();
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to stop session" });
    }
  },

  pauseSession: async (id: string) => {
    try {
      await apiClient.post(`/trading/sessions/${id}/pause`);
      get().fetchSession(id);
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to pause session" });
    }
  },

  resumeSession: async (id: string) => {
    try {
      await apiClient.post(`/trading/sessions/${id}/resume`);
      get().fetchSession(id);
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to resume session" });
    }
  },

  deleteSession: async (id: string) => {
    try {
      await apiClient.delete(`/trading/sessions/${id}`);
      set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
    } catch (err: any) {
      set({ error: err.response?.data?.detail || "Failed to delete session" });
    }
  },

  fetchSnapshot: async (id: string) => {
    try {
      const res = await apiClient.get(`/trading/sessions/${id}/snapshot`);
      set({ snapshot: res.data });
    } catch {
      // Snapshot may not be available if session isn't running
    }
  },

  setSnapshot: (snapshot: TradingSnapshot) => set({ snapshot }),
  clearError: () => set({ error: null }),
}));
