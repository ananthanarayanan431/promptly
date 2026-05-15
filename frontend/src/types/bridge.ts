export type TransferJobStatus =
  | 'queued'
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PromptPair {
  id: string;
  source_optimal_prompt: string;
  target_optimal_prompt: string;
  source_score: number | null;
  target_score: number | null;
  created_at: string;
}

export interface PromptMapping {
  id: string;
  source_model: string;
  target_model: string;
  mapping_text: string;
  pair_count: number;
  avg_source_score: number | null;
  avg_target_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface PromptMappingDetail extends PromptMapping {
  pairs: PromptPair[];
}

export interface TransferResultPayload {
  adapted_prompt: string;
  source_model: string;
  target_model: string;
  mapping_id: string;
  reused_mapping: boolean;
  credits_charged: number;
}

export interface TransferJobPollResponse {
  job_id: string;
  status: string;
  stage: string | null;
  progress: Record<string, unknown> | null;
  result: TransferResultPayload | null;
  error: string | null;
}

export interface TransferJobCreatedResponse {
  job_id: string;
  reused_mapping: boolean;
  credits_charged: number;
  message: string;
}

export interface TransferJobSummary {
  id: string;
  source_model: string;
  target_model: string;
  status: TransferJobStatus;
  reused_mapping: boolean;
  credits_charged: number;
  source_prompt: string;
  adapted_prompt: string | null;
  error_message: string | null;
  created_at: string;
  redis_job_id: string | null;
}

export interface TransferJobListResponse {
  jobs: TransferJobSummary[];
}

export interface MappingListResponse {
  mappings: PromptMapping[];
}
