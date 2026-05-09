export type DomainPromptStatus =
  | 'pending'
  | 'preparing_dataset'
  | 'optimizing'
  | 'completed'
  | 'failed';

export interface DatasetInfo {
  row_count: number | null;
  pdf_key: string;
  dataset_key: string | null;
}

export interface DomainPrompt {
  id: string;
  name: string;
  description: string | null;
  last_prompt: string | null;
  optimized_prompt: string | null;
  status: DomainPromptStatus;
  score_before: number | null;
  score_after: number | null;
  win_rate: number | null;
  candidates_tried: number | null;
  credits_charged: number;
  error_message: string | null;
  dataset: DatasetInfo | null;
  created_at: string;
  updated_at: string;
}

export interface DomainListResponse {
  domains: DomainPrompt[];
}

export interface CreateDomainJobResponse {
  job_id: string;
  domain_id: string;
}

export interface DomainJobPollResponse {
  job_id: string;
  status: string;
  domain_id: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface QAPair {
  question: string;
  answer: string;
}

export interface DatasetRowsResponse {
  rows: QAPair[];
  row_count: number;
}

export interface TournamentState {
  round: number;
  total_rounds: number;
  candidate_count: number;
  names: string[];
  elos: number[];
  W: number[][];
  duel_i: number;
  duel_j: number;
  question: string;
}

export interface OptimizationRun {
  id: string;
  domain_id: string;
  domain_name: string;
  prompt_input: string;
  optimized_prompt: string;
  score_before: number | null;
  score_after: number | null;
  win_rate: number | null;
  candidates_tried: number | null;
  rounds_run: number | null;
  dataset_size: number | null;
  created_at: string;
}

export interface RunListResponse {
  runs: OptimizationRun[];
}
