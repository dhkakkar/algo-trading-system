export interface BacktestMetrics {
  total_return: number | null;
  cagr: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  profit_factor: number | null;
  total_trades: number | null;
  avg_trade_pnl: number | null;
}

export interface Backtest extends BacktestMetrics {
  id: string;
  user_id: string;
  strategy_id: string;
  strategy_version: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  start_date: string;
  end_date: string;
  initial_capital: number;
  timeframe: string;
  parameters: Record<string, any>;
  instruments: string[];
  equity_curve: EquityPoint[] | null;
  drawdown_curve: DrawdownPoint[] | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BacktestListItem {
  id: string;
  strategy_id: string;
  strategy_version: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  start_date: string;
  end_date: string;
  initial_capital: number;
  total_return: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  total_trades: number | null;
  created_at: string;
}

export interface BacktestTrade {
  symbol: string;
  exchange: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  charges: number;
  net_pnl: number | null;
  entry_at: string;
  exit_at: string | null;
}

export interface EquityPoint {
  date: string;
  value: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown: number;
}

export interface CreateBacktestRequest {
  strategy_id: string;
  start_date: string;
  end_date: string;
  initial_capital?: number;
  timeframe?: string;
  parameters?: Record<string, any>;
  instruments?: string[];
}
