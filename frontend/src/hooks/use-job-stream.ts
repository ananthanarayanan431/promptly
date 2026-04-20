'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import type { JobProgressEvent, JobResult } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type StreamStatus = 'idle' | 'streaming' | 'completed' | 'failed';

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
          const msg =
            res.status === 401
              ? 'Session expired — please refresh the page'
              : res.status === 404
                ? 'Job not found — the server may still be starting up'
                : 'Could not connect to the optimization service';
          setError(msg);
          setStatus('failed');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

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
              } else if (ev.step === 'failed') {
                setError(ev.error ?? 'Optimization failed');
                setStatus('failed');
              } else {
                setProgress((prev) => [...prev, ev]);
              }
            } catch {
              // Malformed event — skip silently
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') {
          setError('Stream disconnected');
          setStatus('failed');
        }
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
