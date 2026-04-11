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
  usage: any; // Specify if needed
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
  version: number;
  name: string;
}

export interface HealthScoreResponse {
  scores: {
    clarity: number;
    specificity: number;
    [key: string]: number; // Allow other dimensions
  };
  overall: number;
}

export interface AdvisoryResponse {
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  assessment: string;
}
