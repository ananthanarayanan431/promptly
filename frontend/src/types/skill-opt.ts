export interface SkillProject {
  id: string;
  name: string;
  description: string | null;
  task_description: string;
  status: 'pending' | 'optimizing' | 'completed' | 'failed' | 'cancelled';
  seed_skill: string | null;
  best_skill: string | null;
  score_before: number | null;
  score_after: number | null;
  epochs_run: number | null;
  edits_accepted: number | null;
  edits_rejected: number | null;
  example_count: number | null;
  credits_charged: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillExample {
  input: string;
  expected: string;
}

export interface SkillEditItem {
  op: 'ADD' | 'DELETE' | 'REPLACE';
  text: string;
  accepted: boolean;
}

export interface SkillOptLiveState {
  phase: string;
  epoch: number;
  total_epochs: number;
  epoch_pct: number;
  current_score: number | null;
  best_score: number | null;
  edits_accepted: number;
  edits_rejected: number;
  rollout_done: number;
  rollout_total: number;
  recent_edits: SkillEditItem[];
  current_skill_preview: string;
}

export interface SkillOptLiveStateResponse {
  state: SkillOptLiveState | null;
}

export interface SkillRun {
  id: string;
  epoch: number;
  score_before: number | null;
  score_after: number | null;
  edits_proposed: number | null;
  edits_accepted: number | null;
  edits_rejected: number | null;
  rollout_count: number | null;
  status: string;
  created_at: string;
}
