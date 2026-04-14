export interface User {
  id: string;
  email: string;
  credits: number;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface JobSubmitResponse {
  job_id: string;
  session_id: string;
  status: 'queued';
  prompt_id?: string;
}

export interface CouncilProposal {
  model: string;
  optimized_prompt: string;
  usage: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface JobResult {
  session_id: string;
  original_prompt: string;
  optimized_prompt: string;
  council_proposals: CouncilProposal[];
  token_usage: {
    total_tokens: number;
  };
  prompt_id?: string;
  version?: number;
}

export interface JobStatusResponse {
  job_id: string;
  status: 'queued' | 'started' | 'completed' | 'failed';
  result?: JobResult;
  error?: string;
}

export interface PromptVersion {
  version_id: string;
  prompt_id: string;
  name: string;
  version: number;
  content: string;
  created_at: string;
}

export interface PromptFamily {
  prompt_id: string;
  name: string;
  versions: PromptVersion[];
}

export interface CreateVersionResponse {
  prompt_id: string;
  version: PromptVersion;
}

// Each dimension returns a score (1–10) and a rationale string
export interface MetricScore {
  score: number;
  rationale: string;
}

// Matches backend PromptHealthScoreResponse exactly
export interface HealthScoreResponse {
  prompt: string;
  clarity: MetricScore;
  specificity: MetricScore;
  completeness: MetricScore;
  conciseness: MetricScore;
  tone: MetricScore;
  actionability: MetricScore;
  context_richness: MetricScore;
  goal_alignment: MetricScore;
  overall_score: number; // float 1–10
}

// --- Dashboard Stats ---

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ModelStats {
  model: string;
  total_tokens: number;
}

export interface DashboardStats {
  prompts_optimized: number;
  total_tokens: number;
  estimated_cost_usd: number;
  versions_saved: number;
  credits_remaining: number;
  daily_activity: DailyActivity[];
  model_breakdown: ModelStats[];
}

// --- Session history ---

export interface SessionSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionsGrouped {
  today: SessionSummary[];
  last_7_days: SessionSummary[];
  last_30_days: SessionSummary[];
  older: SessionSummary[];
}

export interface SessionMessage {
  id: string;
  role: string;
  raw_prompt: string | null;
  response: string | null;
  council_votes: CouncilProposal[] | null;
  token_usage: { total_tokens: number } | null;
  created_at: string;
}

export interface SessionDetail {
  id: string;
  title: string | null;
  messages: SessionMessage[];
  created_at: string;
}

// --- Chat conversation turn (frontend only) ---

export interface ChatTurn {
  tempId: string;
  jobId?: string;
  userText: string;
  isFeedback: boolean;
  status: 'loading' | 'completed' | 'failed';
  result?: JobResult;
  error?: string;
}

// Matches backend PromptAdvisoryResponse exactly
export interface AdvisoryResponse {
  prompt: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  overall_assessment: string;
}
