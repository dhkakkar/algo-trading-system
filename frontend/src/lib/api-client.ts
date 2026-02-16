import axios from "axios";
import { API_V1 } from "./constants";
import { useToastStore } from "@/stores/toast-store";

// Allow callers to suppress the global error toast (e.g. polling, background checks)
declare module "axios" {
  interface InternalAxiosRequestConfig {
    _suppressToast?: boolean;
  }
}

const apiClient = axios.create({
  baseURL: API_V1,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: attach JWT token
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("access_token");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) {
          throw new Error("No refresh token");
        }

        const response = await axios.post(`${API_V1}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token } = response.data;
        localStorage.setItem("access_token", access_token);
        localStorage.setItem("refresh_token", refresh_token);

        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return apiClient(originalRequest);
      } catch {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// Global error notification interceptor: show toast for any API error
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Skip if caller opted out of toast notifications
    if (error.config?._suppressToast) {
      return Promise.reject(error);
    }

    // Skip 401 — handled by auth interceptor (refresh or redirect)
    if (error.response?.status === 401) {
      return Promise.reject(error);
    }

    // Extract a human-readable message
    const detail = error.response?.data?.detail;
    const status = error.response?.status;
    let message: string;

    if (typeof detail === "string") {
      message = detail;
    } else if (status === 429) {
      message = "Too many requests. Please slow down.";
    } else if (status === 404) {
      message = "Resource not found";
    } else if (status === 500) {
      message = "Server error. Please try again later.";
    } else if (status) {
      message = `Request failed (${status})`;
    } else {
      message = "Network error. Check your connection.";
    }

    useToastStore.getState().addToast("error", message);

    return Promise.reject(error);
  }
);

export default apiClient;
