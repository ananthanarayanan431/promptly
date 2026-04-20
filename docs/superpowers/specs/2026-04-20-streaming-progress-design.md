# Streaming Optimization Progress Design

**Goal:** Replace the silent 2-second poll loop with a real-time 7-step progress stream driven by actual LangGraph pipeline milestones.

**Architecture:** Celery worker writes progress events to a Redis list as each node completes → FastAPI SSE endpoint streams those events to the browser → frontend renders a step-by-step progress indicator.

**Tech Stack:** Redis RPUSH/LRANGE, FastAPI `StreamingResponse` (text/event-stream), browser `fetch()` + `ReadableStream`, React state.

---

## Data model

### GraphState addition

`job_id: str | None` added to `app/graph/state.py`. Nodes read this field to know where to publish progress. When `None` (standalone health-score / advisory calls), progress writes are skipped — no behaviour change for non-chat flows.

### Progress event schema

Each event is a JSON object pushed to the Redis list key `chat:job:{id}:progress` (same TTL as the job result):

```json
{ "step": "intent",     "ts": 1234567890.123 }
{ "step": "council",    "done": 1, "total": 4, "ts": 1234567890.456 }
{ "step": "council",    "done": 2, "total": 4, "ts": 1234567890.789 }
{ "step": "council",    "done": 3, "total": 4, "ts": 1234567890.901 }
{ "step": "council",    "done": 4, "total": 4, "ts": 1234567891.012 }
{ "step": "critic",     "ts": 1234567891.234 }
{ "step": "synthesize", "ts": 1234567891.456 }
```

The SSE endpoint synthesises the terminal event from the job status key (not stored in the list):
```json
{ "step": "completed" }
{ "step": "failed",  "error": "..." }
```

---

## Backend

### `app/graph/state.py`
Add one field:
```python
job_id: str | None   # set by Celery task; None for standalone PromptService calls
```

### `app/core/cache.py`
Two new async functions:

```python
async def push_job_progress(job_id: str, event: dict[str, Any]) -> None:
    """Append one progress event to the job's Redis list."""
    redis = await get_redis_client()
    key = f"{_job_key(job_id)}:progress"
    await redis.rpush(key, json.dumps(event))
    await redis.expire(key, redis_settings.REDIS_TTL_SECONDS)

async def get_job_progress_from(job_id: str, start: int) -> list[dict[str, Any]]:
    """Return events at indices [start, end] from the job's progress list."""
    redis = await get_redis_client()
    key = f"{_job_key(job_id)}:progress"
    raws: list[str] = await redis.lrange(key, start, -1)
    return [json.loads(r) for r in raws]
```

### `app/workers/tasks.py`
Pass `job_id` through to `service.process()`:
```python
result = await service.process(
    user_id=user_id,
    raw_prompt=raw_prompt,
    session_id=session_id,
    feedback=feedback,
    title=_fallback_title(raw_prompt),
    job_id=job_id,          # ← new
)
```
`ChatService.process()` adds `job_id` to the initial graph state dict.

### `app/graph/nodes/intent_classifier.py`
After classification resolves, push the intent event (no-op when `job_id` is None):
```python
import time
from app.core.cache import push_job_progress

async def intent_classifier_node(state: GraphState) -> dict[str, Any]:
    # ... existing classification logic ...
    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "intent", "ts": time.time()})
    return result
```

### `app/graph/nodes/council_vote.py`
Track per-model completion with a shared counter. The `optimize()` coroutine already runs one model — wrap it to push progress after each model finishes:

```python
import time
from app.core.cache import push_job_progress

async def council_vote_node(state: GraphState) -> dict[str, Any]:
    job_id = state.get("job_id")
    total = len(_get_council_models())
    done_count = [0]
    lock = asyncio.Lock()

    async def optimize_and_track(model: ChatOpenAI, idx: int) -> dict[str, Any]:
        result = await optimize(model, idx)   # existing optimize() logic
        if job_id:
            async with lock:
                done_count[0] += 1
                n = done_count[0]
            await push_job_progress(job_id, {
                "step": "council", "done": n, "total": total, "ts": time.time()
            })
        return result

    results = await asyncio.gather(
        *[optimize_and_track(m, i) for i, m in enumerate(_get_council_models())],
        return_exceptions=True,
    )
    # ... rest of existing error-handling logic unchanged ...
```

### `app/graph/nodes/critic.py`
Push after the critic LLM call returns:
```python
if job_id := state.get("job_id"):
    await push_job_progress(job_id, {"step": "critic", "ts": time.time()})
```

### `app/graph/nodes/synthesize.py`
Push after synthesis returns:
```python
if job_id := state.get("job_id"):
    await push_job_progress(job_id, {"step": "synthesize", "ts": time.time()})
```

### `app/api/v1/chat.py` — new SSE endpoint
```python
import asyncio, json, time
from fastapi.responses import StreamingResponse

@router.get("/jobs/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """SSE stream of pipeline progress events for a queued job."""

    async def generate() -> AsyncGenerator[str, None]:
        last_idx = 0
        while True:
            events = await get_job_progress_from(job_id, last_idx)
            for ev in events:
                yield f"data: {json.dumps(ev)}\n\n"
                last_idx += 1

            status = await get_job_status(job_id)
            if status == "completed":
                # drain any final events written between last poll and status check
                events = await get_job_progress_from(job_id, last_idx)
                for ev in events:
                    yield f"data: {json.dumps(ev)}\n\n"
                result_raw = await get_job_result(job_id)
                yield f"data: {json.dumps({'step': 'completed', 'result': result_raw})}\n\n"
                return
            if status == "failed":
                result_raw = await get_job_result(job_id)
                error = (result_raw or {}).get("error", "Unknown error")
                yield f"data: {json.dumps({'step': 'failed', 'error': error})}\n\n"
                return
            if status is None:
                yield f"data: {json.dumps({'step': 'failed', 'error': 'Job not found'})}\n\n"
                return

            await asyncio.sleep(0.25)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

Note: the completed event embeds the full result so the frontend does not need a separate fetch when the stream ends.

---

## Frontend

### `src/types/api.ts`
```typescript
export type ProgressStep =
  | 'intent' | 'council' | 'critic' | 'synthesize'
  | 'completed' | 'failed';

export interface JobProgressEvent {
  step: ProgressStep;
  done?: number;    // council only
  total?: number;   // council only
  ts?: number;
  result?: JobResult;  // completed only
  error?: string;      // failed only
}
```

### `src/hooks/use-job-stream.ts`
Uses `fetch()` + `ReadableStream` (not `EventSource`) so the `Authorization` header is sent correctly across origins:

```typescript
'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import type { JobProgressEvent, JobResult } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export function useJobStream(jobId: string | null) {
  const [progress, setProgress] = useState<JobProgressEvent[]>([]);
  const [status, setStatus] = useState<'idle'|'streaming'|'completed'|'failed'>('idle');
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const token = useAuthStore.getState().token;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress([]);
    setStatus('streaming');

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/chat/jobs/${jobId}/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        const reader = res.body!.getReader();
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
            const ev: JobProgressEvent = JSON.parse(line.slice(6));
            if (ev.step === 'completed') {
              setResult(ev.result ?? null);
              setStatus('completed');
            } else if (ev.step === 'failed') {
              setError(ev.error ?? 'Unknown error');
              setStatus('failed');
            } else {
              setProgress(prev => [...prev, ev]);
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

    return () => ctrl.abort();
  }, [jobId]);

  const reset = () => {
    abortRef.current?.abort();
    setProgress([]); setStatus('idle'); setResult(null); setError(null);
  };

  return { progress, status, result, error, reset };
}
```

### `src/components/optimize/job-progress.tsx`
Renders the 7-step timeline. Steps are derived from the accumulated `progress` array. Council steps show an individual checkmark per model (1/4 → 2/4 → ...).

```
● Analyzing prompt          ← intent event received
● Optimizing  1 / 4  ✓      ← council done:1
● Optimizing  2 / 4  ✓
● Optimizing  3 / 4  ✓
● Optimizing  4 / 4  ✓
● Peer reviewing            ← critic event
● Synthesizing result       ← synthesize event
```

Active step pulses violet. Completed steps show a checkmark. Pending steps are grey dots.

### `src/components/optimize/optimize-chat.tsx`
- Replace `useJobPoller` import with `useJobStream`
- Replace spinner with `<JobProgress progress={progress} />` while `status === 'streaming'`
- On `status === 'completed'`, pass `result` to the existing `ResultPanel`
- On `status === 'failed'`, show the existing error toast

---

## Error handling

| Scenario | Behaviour |
|---|---|
| `job_id` is None in node | `push_job_progress` is skipped — no crash |
| SSE client disconnects mid-stream | FastAPI generator catches `asyncio.CancelledError` on next `await`, exits cleanly |
| Node fails to write to Redis | Progress event is silently dropped; job still completes normally |
| Browser network blip | Frontend aborts, `useJobStream` re-mounts and streams from `last_idx=0` catching up instantly |
| Job not found | SSE sends `{"step":"failed","error":"Job not found"}` immediately |

---

## File summary

| File | Change |
|---|---|
| `app/graph/state.py` | Add `job_id: str \| None` |
| `app/core/cache.py` | Add `push_job_progress()`, `get_job_progress_from()` |
| `app/workers/tasks.py` | Pass `job_id` to `service.process()` |
| `app/services/chat_service.py` | Accept and thread `job_id` into initial graph state |
| `app/graph/nodes/intent_classifier.py` | Push `intent` event |
| `app/graph/nodes/council_vote.py` | Push `council` event per model |
| `app/graph/nodes/critic.py` | Push `critic` event |
| `app/graph/nodes/synthesize.py` | Push `synthesize` event |
| `app/api/v1/chat.py` | Add SSE endpoint |
| `src/types/api.ts` | Add `JobProgressEvent`, `ProgressStep` |
| `src/hooks/use-job-stream.ts` | New hook (replaces useJobPoller) |
| `src/components/optimize/job-progress.tsx` | New progress timeline component |
| `src/components/optimize/optimize-chat.tsx` | Wire hook + component |
