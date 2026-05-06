'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import type { JobProgressEvent, JobResult } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type StreamStatus = 'idle' | 'streaming' | 'completed' | 'failed';

type StatusSetter = (s: StreamStatus) => void;
type ResultSetter = (r: JobResult | null) => void;
type ErrorSetter = (e: string | null) => void;

interface PollResponse {
  data: {
    status: 'queued' | 'started' | 'completed' | 'failed';
    result?: JobResult;
    error?: string;
  };
}

async function pollUntilDone(
  jobId: string,
  token: string,
  signal: AbortSignal,
  setResult: ResultSetter,
  setStatus: StatusSetter,
  setError: ErrorSetter,
): Promise<void> {
  const maxAttempts = 180; // 3 min at 1s intervals
  for (let i = 0; i < maxAttempts; i++) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 1000));
    if (signal.aborted) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/chat/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError(res.status === 401 ? 'Session expired — please refresh the page' : 'Not authorised');
          setStatus('failed');
          return;
        }
        continue; // transient error — keep polling
      }
      const json = (await res.json()) as PollResponse;
      const { status, result, error } = json.data;
      if (status === 'completed' && result) {
        setResult(result);
        setStatus('completed');
        return;
      }
      if (status === 'failed') {
        setError(error ?? 'Optimization failed');
        setStatus('failed');
        return;
      }
    } catch {
      if (signal.aborted) return;
    }
  }
  setError('Optimization timed out');
  setStatus('failed');
}

export interface UseJobStreamResult {
  progress: JobProgressEvent[];
  status: StreamStatus;
  result: JobResult | null;
  error: string | null;
  reset: () => void;
}

/**
 * Connects to the SSE progress stream for a Celery job.
 * Uses fetch() + ReadableStream (not EventSource) so the Authorization header
 * is sent correctly for the cross-origin API call.
 */
export function useJobStream(jobId: string | null): UseJobStreamResult {
  const [progress, setProgress] = useState<JobProgressEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const token = useAuthStore.getState().token;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setProgress([]);
    setResult(null);
    setError(null);
    setStatus('streaming');

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/chat/jobs/${jobId}/stream`, {
          headers: { Authorization: `Bearer ${token ?? ''}` },
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          if (res.status === 401) {
            setError('Session expired — please refresh the page');
            setStatus('failed');
            return;
          }
          // For other errors fall through to poll fallback below
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let terminal = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as JobProgressEvent;
              if (ev.step === 'completed') {
                setResult(ev.result ?? null);
                setStatus('completed');
                terminal = true;
              } else if (ev.step === 'failed') {
                // "Stream timeout" from server means the SSE ceiling was hit but the
                // job may still be running — check the actual job status before failing.
                if (ev.error === 'Stream timeout') {
                  // Fall through to poll fallback
                  break;
                }
                setError(ev.error ?? 'Optimization failed');
                setStatus('failed');
                terminal = true;
              } else {
                setProgress((prev) => [...prev, ev]);
              }
            } catch {
              // Malformed event — skip silently
            }
          }
          if (terminal) return;
        }

        // Stream ended without a terminal event (timeout / disconnect) — poll for result
        if (!terminal) {
          await pollUntilDone(jobId, token ?? '', ctrl.signal, setResult, setStatus, setError);
        }
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') return;
        // Network error — try polling as fallback
        await pollUntilDone(jobId, token ?? '', ctrl.signal, setResult, setStatus, setError);
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [jobId]);

  const reset = () => {
    abortRef.current?.abort();
    setProgress([]);
    setStatus('idle');
    setResult(null);
    setError(null);
  };

  return { progress, status, result, error, reset };
}
