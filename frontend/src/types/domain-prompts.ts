export type DomainPromptStatus =
  | 'pending'
  | 'preparing_dataset'
  | 'optimizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  stage: string | null;
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
  copeland_scores: number[];
  avg_win_rates: number[];
  W: number[][];
  duel_i: number;
  duel_j: number;
  question: string;
  answer_a?: string | null;
  answer_b?: string | null;
  mutations_applied?: number;
  inference_error_count?: number;
  last_inference_error?: string;
}

export interface OptimizationRun {
  id: string;
  domain_id: string;
  domain_name: string;
  prompt_input: string;
  optimized_prompt: string | null;
  score_before: number | null;
  score_after: number | null;
  win_rate: number | null;
  candidates_tried: number | null;
  rounds_run: number | null;
  dataset_size: number | null;
  status: string;
  error_message: string | null;
  algorithm?: string;
  total_tokens?: number | null;
  created_at: string;
}

export interface RunListResponse {
  runs: OptimizationRun[];
}

/* ── GEPA live state types ───────────────────────────────────────── */

export interface GepaTraceItem {
  input: string;
  output: string;
  score: number;
  feedback: string;
}

export interface GepaCandidate {
  id: string;
  score: number;
  desc: string;
  delta: string | null;
  star: boolean;
  cells: number[];
}

export interface GepaPending {
  parent: string;
  fail: boolean;
}

export interface GepaCurrentIter {
  parent: string;
  cur_prompt: string;
  ancestor: string;
  traces: GepaTraceItem[];
  minibatch_inputs?: string[];
  reasoning: string[];
  new_prompt: string;
  sigma: number;
  sigma_p: number | null;
  accept: boolean | null;
}

export interface GepaState {
  phase: string;
  step: string | null;
  done_steps: string[];
  iter_idx: number;
  sub: string | null;
  pool: GepaCandidate[];
  pending: GepaPending | null;
  budget_used: number;
  full_pct: number;
  baseline: number | null;
  current_iter: GepaCurrentIter | null;
  budget_max?: number;
  n_pareto_size?: number;
}
