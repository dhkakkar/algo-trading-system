export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_verified: boolean;
  is_superadmin: boolean;
  trading_mode: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
}
