export interface Strategy {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  code: string;
  source_type: "editor" | "upload";
  version: number;
  is_active: boolean;
  parameters: Record<string, any>;
  instruments: string[];
  timeframe: string;
  created_at: string;
  updated_at: string;
}

export interface StrategyListItem {
  id: string;
  name: string;
  description: string | null;
  source_type: "editor" | "upload";
  version: number;
  is_active: boolean;
  instruments: string[];
  timeframe: string;
  created_at: string;
  updated_at: string;
}

export interface CreateStrategyRequest {
  name: string;
  description?: string;
  code: string;
  parameters?: Record<string, any>;
  instruments?: string[];
  timeframe?: string;
}

export interface UpdateStrategyRequest {
  name?: string;
  description?: string;
  code?: string;
  parameters?: Record<string, any>;
  instruments?: string[];
  timeframe?: string;
}

export interface ValidateResponse {
  valid: boolean;
  error: string | null;
}
