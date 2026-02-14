import { create } from "zustand";
import apiClient from "@/lib/api-client";
import type {
  Strategy,
  StrategyListItem,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  ValidateResponse,
} from "@/types/strategy";

interface StrategyState {
  strategies: StrategyListItem[];
  currentStrategy: Strategy | null;
  isLoading: boolean;
  error: string | null;

  fetchStrategies: () => Promise<void>;
  fetchStrategy: (id: string) => Promise<void>;
  createStrategy: (data: CreateStrategyRequest) => Promise<Strategy>;
  updateStrategy: (id: string, data: UpdateStrategyRequest) => Promise<Strategy>;
  deleteStrategy: (id: string) => Promise<void>;
  validateStrategy: (id: string) => Promise<ValidateResponse>;
  clearCurrentStrategy: () => void;
  clearError: () => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
  strategies: [],
  currentStrategy: null,
  isLoading: false,
  error: null,

  fetchStrategies: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.get<StrategyListItem[]>("/strategies");
      set({ strategies: response.data, isLoading: false });
    } catch (err: any) {
      const message =
        err.response?.data?.detail || err.message || "Failed to fetch strategies";
      set({ error: message, isLoading: false });
    }
  },

  fetchStrategy: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.get<Strategy>(`/strategies/${id}`);
      set({ currentStrategy: response.data, isLoading: false });
    } catch (err: any) {
      const message =
        err.response?.data?.detail || err.message || "Failed to fetch strategy";
      set({ error: message, isLoading: false });
    }
  },

  createStrategy: async (data: CreateStrategyRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.post<Strategy>("/strategies", data);
      set((state) => ({
        strategies: [...state.strategies, response.data],
        isLoading: false,
      }));
      return response.data;
    } catch (err: any) {
      const message =
        err.response?.data?.detail || err.message || "Failed to create strategy";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateStrategy: async (id: string, data: UpdateStrategyRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.put<Strategy>(`/strategies/${id}`, data);
      set((state) => ({
        strategies: state.strategies.map((s) =>
          s.id === id ? { ...s, ...response.data } : s
        ),
        currentStrategy: response.data,
        isLoading: false,
      }));
      return response.data;
    } catch (err: any) {
      const message =
        err.response?.data?.detail || err.message || "Failed to update strategy";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  deleteStrategy: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiClient.delete(`/strategies/${id}`);
      set((state) => ({
        strategies: state.strategies.filter((s) => s.id !== id),
        currentStrategy:
          state.currentStrategy?.id === id ? null : state.currentStrategy,
        isLoading: false,
      }));
    } catch (err: any) {
      const message =
        err.response?.data?.detail || err.message || "Failed to delete strategy";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  validateStrategy: async (id: string) => {
    try {
      const response = await apiClient.post<ValidateResponse>(
        `/strategies/${id}/validate`
      );
      return response.data;
    } catch (err: any) {
      const message =
        err.response?.data?.detail || err.message || "Validation request failed";
      return { valid: false, error: message };
    }
  },

  clearCurrentStrategy: () => {
    set({ currentStrategy: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));
