import axios from 'axios';
import { toast } from 'sonner';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase';

// Paths whose errors are handled inline and should not trigger a global toast.
const SILENT_PATHS = [
  '/api/v1/chat/jobs/',       // job polling — failure shown in the chat UI
  '/api/v1/domain-prompts/',  // live-state polling handled in component
  '/api/v1/skill-opt/',       // live-state polling handled in component
  '/api/v1/prompt-bridge/jobs/', // job polling handled in component
];

export const api = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
});

// Registered by SupabaseTokenSync on mount; called per-request so the token is
// always fresh (Supabase handles session refresh internally via getSession()).
let _getToken: (() => Promise<string | null>) | null = null;

export function registerTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

// Request interceptor — attach a fresh Supabase JWT to every outgoing call.
api.interceptors.request.use(async (config) => {
  if (_getToken) {
    const token = await _getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ── Error message extraction ──────────────────────────────────────────────────
function extractMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'An unexpected error occurred.';
  const e = error as Record<string, unknown>;
  const data = (e.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined;

  // FastAPI returns { detail: string | object[] }
  const detail = data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as Record<string, unknown> | undefined;
    const msg = first?.msg ?? first?.message;
    if (typeof msg === 'string') return `Validation: ${msg}`;
    return 'Validation error — check your input.';
  }

  // Generic HTTP status messages
  const status = (e.response as Record<string, unknown> | undefined)?.status;
  if (status === 402) return 'Not enough tokens — your balance is exhausted.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'Resource not found.';
  if (status === 409) return 'Conflict — this operation cannot run right now.';
  if (status === 422) return 'Invalid request — check your input.';
  if (status === 429) return 'Rate limit exceeded — please slow down.';
  if (typeof status === 'number' && status >= 500) return 'Server error — please try again shortly.';

  // Network error (no response)
  if ((e as Record<string, unknown>).code === 'ERR_NETWORK') return 'Cannot reach the server — check that the backend is running.';
  if ((e as Record<string, unknown>).code === 'ECONNABORTED') return 'Request timed out — the server is taking too long.';

  return 'Something went wrong. Please try again.';
}

// ── Response interceptor ───────────────────────────────────────────────────────
// Handles 401 → sign-out + redirect, and shows a red toast for every other error
// that isn't handled inline by a component.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status: number | undefined = error.response?.status;
    const url: string = error.config?.url ?? '';

    // 401 — clear session and redirect to sign-in
    if (
      status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/sign-in')
    ) {
      try {
        await createClient().auth.signOut();
      } catch { /* best-effort */ }
      window.location.href = '/sign-in';
      return Promise.reject(error);
    }

    // Skip toasts for:
    // • 401 (handled above)
    // • Requests that belong to silent polling paths
    // • Aborted / cancelled requests (user navigated away)
    if (
      status === 401 ||
      axios.isCancel(error) ||
      SILENT_PATHS.some(p => url.includes(p))
    ) {
      return Promise.reject(error);
    }

    // Show a top-right red toast for everything else
    if (typeof window !== 'undefined') {
      toast.error(extractMessage(error), {
        id: `api-error-${status ?? 'network'}-${url.split('?')[0]}`, // deduplicate same-endpoint bursts
        duration: 5000,
      });
    }

    return Promise.reject(error);
  }
);
