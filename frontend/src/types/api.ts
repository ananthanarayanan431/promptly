export interface User {
  id: string;
  email: string;
  credits: number;
  token_balance: number;
  is_admin: boolean;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  key: string;
  created_at: string;
}

export interface PaginatedApiKeyList {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  keys: ApiKey[];
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

export interface ReasoningChange {
  kind: string;
  title: string;
  detail: string;
}

export interface ReasoningBlock {
  summary: string;
  changes: ReasoningChange[];
  kept: string[];
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
  prompt_version_id: string | null;
  // Performance gate fields — present when the prompt was already production-grade
  already_optimized?: boolean;
  gate_dimension_scores?: Record<string, string> | null;
  gate_rationale?: string | null;
  // Structured reasoning — why this version was chosen
  reasoning?: ReasoningBlock | null;
}

export interface JobStatusResponse {
  job_id: string;
  status: 'queued' | 'started' | 'completed' | 'failed';
  result?: JobResult;
  error?: string;
}

export type ProgressStep =
  | 'intent'
  | 'subject'
  | 'performance_gate'
  | 'council'
  | 'critic'
  | 'synthesize'
  | 'quality_gate'
  | 'completed'
  | 'failed';

export interface JobProgressEvent {
  step: ProgressStep;
  done?: number;       // council only: which model just finished (1-4)
  total?: number;      // council only: total council size (always 4)
  iteration?: number;  // council/quality_gate: which refinement iteration (0-indexed)
  // quality_gate fields
  decision?: 'loop' | 'exit' | 'exit_max' | 'exit_converged';
  overall?: 'pass' | 'fail';
  weak_dimensions?: string[];
  ts?: number;         // unix timestamp from server
  result?: JobResult;  // completed only: full result embedded
  error?: string;      // failed only
}

export interface PromptVersion {
  version_id: string;
  prompt_id: string;
  name: string;
  version: number;
  content: string;
  created_at: string;
  is_favorited: boolean;
  favorite_id: string | null;
}

export interface PromptFamily {
  prompt_id: string;
  name: string;
  versions: PromptVersion[];
}

export interface PaginatedPromptFamilyList {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  families: PromptFamily[];
}

export interface CreateVersionResponse {
  prompt_id: string;
  version: PromptVersion;
}

export interface MetricScore {
  score: number;
  rationale: string;
}

export interface HealthMeta {
  overall_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  deploy_ready: boolean;
  injection_risk: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
}

export interface HealthScores {
  clarity: MetricScore;
  specificity: MetricScore;
  completeness: MetricScore;
  conciseness: MetricScore;
  tone: MetricScore;
  actionability: MetricScore;
  context_richness: MetricScore;
  goal_alignment: MetricScore;
  injection_robustness: MetricScore;
  reusability: MetricScore;
}

export interface HealthScoreResponse {
  prompt: string;
  meta: HealthMeta;
  scores: HealthScores;
  critical_failures: string[];
  top_improvements: string[];
  deploy_verdict: string;
}

// --- Dashboard Stats ---

export interface ActivityPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ModelStats {
  model: string;
  total_tokens: number;
}

export interface QualityTrendPoint {
  date: string; // YYYY-MM-DD
  avg_score: number; // 1–10
}

export interface UsageBucket {
  optimize_calls: number;
  optimize_credits: number;
  health_score_calls: number;
  health_score_credits: number;
  advisory_calls: number;
  advisory_credits: number;
  domain_pdo_calls: number;
  domain_pdo_credits: number;
  bridge_calls: number;
  bridge_credits: number;
}

export interface UsageStats {
  all_time: UsageBucket;
  this_month: UsageBucket;
}

export interface DashboardStats {
  // Core counters
  prompts_optimized: number;
  total_sessions: number;
  total_tokens: number;
  avg_tokens_per_run: number;
  estimated_cost_usd: number;
  versions_saved: number;
  total_versions: number;
  // Per-action usage (all-time + current month)
  usage: UsageStats;
  // Engagement signals
  streak_days: number;
  last_optimized_at: string | null; // ISO datetime
  top_model: string | null;
  // Chart data
  daily_activity: ActivityPoint[];
  model_breakdown: ModelStats[];
  quality_trend: QualityTrendPoint[];
}

// --- Recent sessions widget ---

export interface RecentSessionWithPrompt {
  id: string;
  title: string | null;
  last_prompt: string | null;
  updated_at: string;
}

export interface RecentSessionsResponse {
  sessions: RecentSessionWithPrompt[];
}

// --- Session history ---

export interface SessionSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  token_count?: number | null;
  feedback_count?: number;
  prompt_input?: string | null;
  optimized_prompt?: string | null;
  reasoning?: {
    summary: string;
    changes: { kind: string; title: string; detail: string }[];
    kept: string[];
  } | null;
  council_models?: string[];
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
  feedback: string | null;
  response: string | null;
  council_votes: CouncilProposal[] | null;
  token_usage: { total_tokens: number } | null;
  prompt_version_id: string | null;
  prompt_family_id: string | null;
  already_optimized?: boolean;
  gate_dimension_scores?: Record<string, string> | null;
  gate_rationale?: string | null;
  reasoning?: ReasoningBlock | null;
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

// --- Diff ---

export interface DiffHunk {
  type: 'equal' | 'insert' | 'delete' | 'replace';
  text?: string;
  from_text?: string;
  to_text?: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  equal: number;
}

export interface PromptDiffResponse {
  prompt_id: string;
  from_version: number;
  to_version: number;
  from_content: string;
  to_content: string;
  hunks: DiffHunk[];
  stats: DiffStats;
}

// --- Templates ---

export interface Template {
  id: string;
  category: string;
  name: string;
  description: string;
  content: string;
}

export interface TemplateCategoryGroup {
  category: string;
  templates: Template[];
}

export interface TemplateListResponse {
  categories: TemplateCategoryGroup[];
  total: number;
}

export interface AdvisoryMeta {
  overall_score: 'LOW' | 'MODERATE' | 'HIGH';
  injection_risk: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
  dimensions_evaluated: string[];
}

export interface AdvisoryDimensionScores {
  role_and_persona: string;
  task_clarity: string;
  output_format: string;
  constraints_and_guardrails: string;
  context_and_grounding: string;
  conciseness_and_signal_density: string;
  injection_robustness: string;
}

export interface AdvisoryResponse {
  prompt: string;
  meta: AdvisoryMeta;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  dimension_scores: AdvisoryDimensionScores;
  overall_assessment: string;
}

// ── Favorites (Prompt Library) ─────────────────────────────────────────────

export type FavoriteCategory = "Work" | "Personal" | "Research" | "Creative" | "Other";

export interface FavoriteResponse {
  id: string;
  prompt_version_id: string;
  prompt_id: string;
  family_name: string;
  version: number;
  content: string;
  version_created_at: string;
  note: string | null;
  tags: string[];
  category: FavoriteCategory;
  is_pinned: boolean;
  use_count: number;
  liked_at: string;
  last_used_at: string | null;
  token_usage: Record<string, number> | null;
}

export interface FavoriteListResponse {
  items: FavoriteResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface FavoriteStatusResponse {
  is_favorited: boolean;
  prompt_store_id: string | null;
}

export interface FavoriteCreateRequest {
  prompt_version_id: string;
  note?: string;
  tags?: string[];
  category?: FavoriteCategory;
}

export interface FavoriteUpdateRequest {
  note?: string;
  tags?: string[];
  category?: FavoriteCategory;
  is_pinned?: boolean;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyCreatedResponse extends ApiKeyResponse {
  key: string; // shown only once
}

export interface TransferJobSummary {
  id: string;
  source_model: string;
  target_model: string;
  status: string;
  reused_mapping: boolean;
  credits_charged: number;
  source_prompt: string;
  adapted_prompt: string | null;
  error_message: string | null;
  created_at: string;
  redis_job_id: string | null;
  token_count?: number | null;
  mapping_text?: string | null;
}

export interface TransferJobListResponse {
  jobs: TransferJobSummary[];
}

// ── Admin ─────────────────────────────────────────────────────────────────

export interface AdminUserItem {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  credits: number;
  token_balance: number;
  is_active: boolean;
  is_admin: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminUserList {
  page: number;
  per_page: number;
  total: number;
  users: AdminUserItem[];
}

export interface AdminUserPatch {
  is_active?: boolean;
  is_admin?: boolean;
  credits_delta?: number;
}

export interface DailyActivity { date: string; calls: number; tokens: number; }
export interface FeatureUsage { feature: string; calls: number; label: string; }
export interface TopUser { email: string; tokens_consumed: number; token_balance: number; calls: number; }

export interface AdminStats {
  total_users: number;
  new_users_7d: number;
  new_users_30d: number;
  active_users_7d: number;
  total_optimizations: number;
  total_tokens_consumed: number;
  total_token_budget: number;
  avg_tokens_per_user: number;
  token_budget_used_pct: number;
  feature_usage: FeatureUsage[];
  daily_activity: DailyActivity[];
  top_users: TopUser[];
}

export interface RateLimitEntry {
  user_id: string;
  route: string;
  hit_count: number;
}

export interface RateLimitList {
  entries: RateLimitEntry[];
}

export interface GlitchTipIssue {
  id: string;
  title: string;
  occurrences: number;
  status: string;
  first_seen: string;
  last_seen: string;
}

export interface GlitchTipIssueList {
  issues: GlitchTipIssue[];
}
