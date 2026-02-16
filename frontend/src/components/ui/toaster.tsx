"use client";

import { useToastStore, type ToastType } from "@/stores/toast-store";
import { X, AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

const icons: Record<ToastType, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const styles: Record<ToastType, string> = {
  error: "bg-red-950 border-red-800 text-red-200",
  warning: "bg-yellow-950 border-yellow-800 text-yellow-200",
  success: "bg-green-950 border-green-800 text-green-200",
  info: "bg-blue-950 border-blue-800 text-blue-200",
};

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm shadow-lg ${styles[toast.type]}`}
          >
            <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
