export interface TradingSession {
  id: string;
  user_id: string;
  strategy_id: string;
  strategy_version: number;
  mode: "paper" | "live";
  status: "stopped" | "running" | "paused" | "error";
  initial_capital: number;
  current_capital: number | null;
  parameters: Record<string, any>;
  instruments: string[];
  timeframe: string;
  error_message: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradingSessionListItem {
  id: string;
  strategy_id: string;
  strategy_version: number;
  mode: "paper" | "live";
  status: "stopped" | "running" | "paused" | "error";
  initial_capital: number;
  current_capital: number | null;
  instruments: string[];
  timeframe: string;
  started_at: string | null;
  created_at: string;
}

export interface CreateSessionRequest {
  strategy_id: string;
  mode: "paper" | "live";
  initial_capital?: number;
  parameters?: Record<string, any>;
  instruments?: string[];
  timeframe?: string;
}

export interface TradingSnapshot {
  session_id: string;
  status: string;
  portfolio_value: number;
  cash: number;
  total_pnl: number;
  positions: TradingPosition[];
  open_orders: number;
  total_trades: number;
  total_charges: number;
  prices: Record<string, number>;
}

export interface TradingPosition {
  symbol: string;
  exchange: string;
  side: string;
  quantity: number;
  avg_price: number;
  current_price: number;
  unrealized_pnl: number;
  pnl_percent: number;
}

export interface TradingOrder {
  id: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: string;
  order_type: string;
  product: string;
  quantity: number;
  price: number | null;
  filled_quantity: number;
  average_price: number | null;
  status: string;
  mode: string;
  placed_at: string;
  filled_at: string | null;
}

export interface TradingTrade {
  id: string;
  tradingsymbol: string;
  exchange: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  charges: number;
  net_pnl: number | null;
  mode: string;
  entry_at: string;
  exit_at: string | null;
}
