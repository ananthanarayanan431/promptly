export interface ModelPricing {
  prompt_per_token: number;
  completion_per_token: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  modality: string | null;
  pricing: ModelPricing | null;
}

export interface ModelListResponse {
  models: ModelInfo[];
  cached: boolean;
}

export interface SpendPeriod {
  daily: number;
  weekly: number;
  monthly: number;
  all_time: number;
}

export interface KeyData {
  label: string;
  spend: SpendPeriod;
  limit: number | null;
  limit_remaining: number | null;
  is_free_tier: boolean;
}

export interface ModelSpend {
  model: string;
  total_tokens: number;
  total_cost_usd: number;
}

export interface OpenRouterStats {
  key: KeyData;
  top_models: ModelSpend[];
}
