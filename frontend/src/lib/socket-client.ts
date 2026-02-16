import { io, Socket } from "socket.io-client";
import { WS_BASE_URL } from "./constants";
import { useToastStore } from "@/stores/toast-store";

let socket: Socket | null = null;
let hasConnected = false;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_BASE_URL, {
      path: "/ws/socket.io",
      autoConnect: false,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
    });

    // Successfully connected
    socket.on("connect", () => {
      if (hasConnected) {
        useToastStore
          .getState()
          .addToast("success", "Real-time connection restored", 3000);
      }
      hasConnected = true;
    });

    // Connection error (failed to connect or reconnect attempt)
    socket.on("connect_error", () => {
      if (hasConnected) {
        useToastStore
          .getState()
          .addToast("warning", "Live connection lost. Reconnecting...", 8000);
      }
    });

    // Disconnected
    socket.on("disconnect", (reason) => {
      // "io client disconnect" = intentional (we called .disconnect())
      if (reason !== "io client disconnect" && hasConnected) {
        useToastStore
          .getState()
          .addToast("warning", "Real-time connection lost. Reconnecting...", 8000);
      }
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}
