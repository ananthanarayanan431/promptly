# Streaming Optimization Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent 2-second polling loop with a real-time 7-step SSE progress stream driven by actual LangGraph pipeline node completions.

**Architecture:** Celery worker appends JSON events to a Redis list as each pipeline node completes; a FastAPI SSE endpoint (`GET /chat/jobs/{id}/stream`) polls the list and streams events; the frontend replaces `useJobPoller` with a `useJobStream` hook that reads the stream and drives a step-by-step progress UI inside the loading message bubble.

**Tech Stack:** Redis RPUSH/LRANGE, FastAPI `StreamingResponse` (text/event-stream), browser `fetch()` + `ReadableStream`, React hooks, existing Recharts/Tailwind dark-theme conventions.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `qa-chatbot/src/app/graph/state.py` | Modify | Add `job_id: str \| None` field |
| `qa-chatbot/src/app/services/chat_service.py` | Modify | Accept + thread `job_id` into graph state |
| `qa-chatbot/src/app/services/prompt_service.py` | Modify | Add `job_id: None` to standalone GraphState constructions |
| `qa-chatbot/src/app/core/cache.py` | Modify | Add `push_job_progress()`, `get_job_progress_from()` |
| `qa-chatbot/src/app/workers/tasks.py` | Modify | Pass `job_id` to `service.process()` |
| `qa-chatbot/src/app/graph/nodes/intent_classifier.py` | Modify | Push `intent` progress event |
| `qa-chatbot/src/app/graph/nodes/council_vote.py` | Modify | Push per-model `council` events |
| `qa-chatbot/src/app/graph/nodes/critic.py` | Modify | Push `critic` event |
| `qa-chatbot/src/app/graph/nodes/synthesize.py` | Modify | Push `synthesize` event |
| `qa-chatbot/src/app/api/v1/chat.py` | Modify | Add SSE stream endpoint |
| `frontend/src/types/api.ts` | Modify | Add `ProgressStep`, `JobProgressEvent` |
| `frontend/src/hooks/use-job-stream.ts` | Create | SSE stream hook (replaces `useJobPoller`) |
| `frontend/src/components/optimize/job-progress.tsx` | Create | 7-step progress timeline component |
| `frontend/src/components/optimize/chat-message.tsx` | Modify | Accept optional `progress` prop; render timeline |
| `frontend/src/components/optimize/optimize-chat.tsx` | Modify | Wire `useJobStream`; pass progress to loading turn |

---

## Task 1: Add `job_id` to GraphState and all construction sites

**Files:**
- Modify: `qa-chatbot/src/app/graph/state.py`
- Modify: `qa-chatbot/src/app/services/chat_service.py`
- Modify: `qa-chatbot/src/app/services/prompt_service.py`

- [ ] **Step 1: Add `job_id` field to GraphState**

Open `qa-chatbot/src/app/graph/state.py`. Replace the entire file content:

```python
from typing import Annotated, Any

from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class GraphState(TypedDict):
    # Input
    raw_prompt: str
    session_id: str
    user_id: str

    # Optional user guidance that shapes how the council optimizes the prompt.
    # When set, it is injected into the council message as a high-priority directive.
    feedback: str | None

    # Celery job id — set by process_chat_async; None for standalone PromptService calls.
    # Nodes read this to write progress events to Redis without any out-of-band context.
    job_id: str | None

    # Intent classification result: "optimize" | "create"
    intent: str | None

    # Pipeline stages
    # Round 1 — council_responses: each model's independently optimized version of raw_prompt
    #   shape: [{model: str, optimized_prompt: str, usage: dict}]
    council_responses: list[dict[str, Any]]

    # Round 2 — critic_responses: each model's blind peer review of the other 3 proposals
    #   shape: [{reviewer_model: str, ranking: list[str], critiques: dict, ranking_rationale: str}]
    critic_responses: list[dict[str, Any]]

    final_response: str  # synthesized best optimized prompt (chairman output)

    # Metadata
    messages: Annotated[list[Any], add_messages]
    token_usage: dict[str, Any]
    error: str | None
```

- [ ] **Step 2: Update ChatService.process() and ChatService.stream()**

Open `qa-chatbot/src/app/services/chat_service.py`. Make two changes:

**Change 1** — add `job_id` parameter to `process()` and include it in `initial_state`:

```python
async def process(
    self,
    user_id: str,
    raw_prompt: str,
    session_id: str,
    feedback: str | None = None,
    title: str | None = None,
    job_id: str | None = None,
) -> dict[str, Any]:
    await self.session_repo.get_or_create(
        session_id=session_id,
        user_id=user_id,
        graph_thread_id=session_id,
        title=title,
    )

    config = {"configurable": {"thread_id": session_id}}
    initial_state: GraphState = {
        "raw_prompt": raw_prompt,
        "session_id": session_id,
        "user_id": user_id,
        "feedback": feedback,
        "job_id": job_id,
        "intent": None,
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "messages": [],
        "token_usage": {},
        "error": None,
    }
    # ... rest of method unchanged
```

**Change 2** — add `job_id: None` to the `stream()` method's `initial_state`:

```python
async def stream(
    self, user_id: str, raw_prompt: str, session_id: str
) -> AsyncGenerator[str, None]:
    config = {"configurable": {"thread_id": session_id}}
    initial_state: GraphState = {
        "raw_prompt": raw_prompt,
        "session_id": session_id,
        "user_id": user_id,
        "feedback": None,
        "job_id": None,
        "intent": None,
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "messages": [],
        "token_usage": {},
        "error": None,
    }
    # ... rest of method unchanged
```

- [ ] **Step 3: Update PromptService._run_guardrails()**

Open `qa-chatbot/src/app/services/prompt_service.py`. In `_run_guardrails()`, add `"job_id": None` to the `state` dict:

```python
async def _run_guardrails(self, raw_prompt: str, user_id: str) -> GraphState:
    state: GraphState = {
        "raw_prompt": raw_prompt,
        "session_id": "",
        "user_id": user_id,
        "feedback": None,
        "job_id": None,
        "intent": None,
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "messages": [],
        "token_usage": {},
        "error": None,
    }
    result = await guardrails_node(state)
    if result.get("error"):
        raise GuardrailException(detail=result["error"])
    state.update(result)  # type: ignore[typeddict-item]
    return state
```

- [ ] **Step 4: Verify make check passes**

Run from `qa-chatbot/`:
```bash
make check
```
Expected: `✅ All checks passed`

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/graph/state.py \
        qa-chatbot/src/app/services/chat_service.py \
        qa-chatbot/src/app/services/prompt_service.py
git commit -m "feat(streaming): add job_id to GraphState and all construction sites"
```

---

## Task 2: Add progress cache functions

**Files:**
- Modify: `qa-chatbot/src/app/core/cache.py`

- [ ] **Step 1: Add two functions to the bottom of cache.py**

Open `qa-chatbot/src/app/core/cache.py`. Append after the last existing function:

```python
# ---------------------------------------------------------------------------
# Job progress list (SSE streaming — one entry per pipeline node event)
# ---------------------------------------------------------------------------


async def push_job_progress(job_id: str, event: dict[str, Any]) -> None:
    """Append one progress event to the job's Redis list."""
    redis = await get_redis_client()
    key = f"{_job_key(job_id)}:progress"
    await redis.rpush(key, json.dumps(event))
    await redis.expire(key, redis_settings.REDIS_TTL_SECONDS)


async def get_job_progress_from(job_id: str, start: int) -> list[dict[str, Any]]:
    """Return all events at indices >= start from the job's progress list."""
    redis = await get_redis_client()
    key = f"{_job_key(job_id)}:progress"
    raws: list[str | bytes] = await redis.lrange(key, start, -1)
    return [json.loads(r) for r in raws]
```

- [ ] **Step 2: Run make check**

```bash
make check
```
Expected: `✅ All checks passed`

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/core/cache.py
git commit -m "feat(streaming): add push_job_progress and get_job_progress_from to cache"
```

---

## Task 3: Instrument intent_classifier, critic, and synthesize nodes

**Files:**
- Modify: `qa-chatbot/src/app/graph/nodes/intent_classifier.py`
- Modify: `qa-chatbot/src/app/graph/nodes/critic.py`
- Modify: `qa-chatbot/src/app/graph/nodes/synthesize.py`

- [ ] **Step 1: Instrument intent_classifier_node**

Open `qa-chatbot/src/app/graph/nodes/intent_classifier.py`. Add `import time` and the `push_job_progress` import, then push an event at the end of `intent_classifier_node`:

```python
"""
Intent Classifier node — runs FIRST in the graph.
...
"""

import asyncio
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

# ... (all existing module-level code unchanged) ...


async def intent_classifier_node(state: GraphState) -> dict[str, Any]:
    """..."""
    raw = state.get("raw_prompt", "").strip()

    response = await _get_classifier().ainvoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": raw},
        ]
    )

    verdict = str(response.content).strip().upper()

    if verdict == "IRRELEVANT":
        result: dict[str, Any] = {
            "intent": "irrelevant",
            "error": _REJECTION_IRRELEVANT,
            "final_response": _REJECTION_IRRELEVANT,
        }
    else:
        result = {"intent": "optimize"}

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "intent", "ts": time.time()})

    return result
```

- [ ] **Step 2: Instrument critic_node**

Open `qa-chatbot/src/app/graph/nodes/critic.py`. Add `import time` and import `push_job_progress`, then push a `critic` event at the end of `critic_node` before returning:

```python
import asyncio
import json
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

# ... (all existing module-level code unchanged) ...


async def critic_node(state: GraphState) -> dict[str, Any]:
    """..."""
    proposals = state["council_responses"]
    raw_prompt = state["raw_prompt"]

    if len(proposals) < 2:
        return {"critic_responses": []}

    async def critique(model: ChatOpenAI, reviewer_idx: int) -> dict[str, Any]:
        user_msg = _build_review_message(raw_prompt, proposals, reviewer_idx)
        response = await model.ainvoke(
            [
                {"role": "system", "content": _CRITIC_PROMPT},
                {"role": "user", "content": user_msg},
            ]
        )
        parsed = _parse_critique(str(response.content))
        return {
            "reviewer_model": llm_settings.COUNCIL_MODELS[reviewer_idx],
            **parsed,
        }

    results = await asyncio.gather(
        *[critique(m, i) for i, m in enumerate(_get_critic_models()) if i < len(proposals)],
        return_exceptions=True,
    )

    valid = [r for r in results if isinstance(r, dict)]

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "critic", "ts": time.time()})

    return {"critic_responses": valid}
```

- [ ] **Step 3: Instrument synthesize_node**

Open `qa-chatbot/src/app/graph/nodes/synthesize.py`. Add `import time` and import `push_job_progress`, then push a `synthesize` event at the end of `synthesize_node` before returning:

```python
import asyncio
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

# ... (all existing module-level code unchanged) ...


async def synthesize_node(state: GraphState) -> dict[str, Any]:
    """..."""
    response = await _get_synthesizer().ainvoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(state)},
        ]
    )

    total_tokens = sum(
        r.get("usage", {}).get("total_tokens", 0) for r in state["council_responses"]
    )

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "synthesize", "ts": time.time()})

    return {
        "final_response": str(response.content).strip(),
        "token_usage": {"total_tokens": total_tokens},
    }
```

- [ ] **Step 4: Run make check**

```bash
make check
```
Expected: `✅ All checks passed`

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/graph/nodes/intent_classifier.py \
        qa-chatbot/src/app/graph/nodes/critic.py \
        qa-chatbot/src/app/graph/nodes/synthesize.py
git commit -m "feat(streaming): instrument intent, critic, synthesize nodes with progress events"
```

---

## Task 4: Instrument council_vote node (per-model parallel tracking)

**Files:**
- Modify: `qa-chatbot/src/app/graph/nodes/council_vote.py`

The council runs 4 models in parallel via `asyncio.gather`. A shared counter + `asyncio.Lock` tracks how many have finished so each completion gets the correct `done` count.

- [ ] **Step 1: Rewrite council_vote_node with progress tracking**

Open `qa-chatbot/src/app/graph/nodes/council_vote.py`. Keep all module-level code (`_STRATEGY_PROMPTS`, `_build_models`, `_get_council_models`, `_build_user_message`) identical. Only replace `council_vote_node`:

```python
import asyncio
import time
import logging
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

llm_settings = get_llm_settings()

_STRATEGY_PROMPTS: list[str] = [
    load_prompt("council_optimizer_analytical"),
    load_prompt("council_optimizer_creative"),
    load_prompt("council_optimizer_concise"),
    load_prompt("council_optimizer_structured"),
]


def _get_strategy(idx: int) -> str:
    if idx < len(_STRATEGY_PROMPTS):
        return _STRATEGY_PROMPTS[idx]
    return _STRATEGY_PROMPTS[0]


def _build_models() -> list[ChatOpenAI]:
    return [
        ChatOpenAI(
            model=m,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
        for m in llm_settings.COUNCIL_MODELS
    ]


_council_loop_id: int | None = None
_council_models: list[ChatOpenAI] | None = None


def _get_council_models() -> list[ChatOpenAI]:
    global _council_loop_id, _council_models
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _council_loop_id != lid or _council_models is None:
        _council_loop_id = lid
        _council_models = _build_models()
    return _council_models


def _build_user_message(raw_prompt: str, feedback: str | None) -> str:
    if not feedback:
        return raw_prompt
    return (
        f"{raw_prompt}\n\n"
        f"---\n"
        f"Optimization Feedback "
        f"(high-priority directive — override general heuristics if needed):\n"
        f"{feedback}"
    )


async def council_vote_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 1.

    Sends the raw prompt to all 4 council models in parallel. Each model independently
    produces its own optimized version using a different strategy. Emits a progress
    event to Redis after each individual model completes.
    """
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    job_id = state.get("job_id")
    models = _get_council_models()
    total = len(models)
    done_count = [0]
    lock = asyncio.Lock()

    async def optimize(model: ChatOpenAI, idx: int) -> dict[str, Any]:
        system = _get_strategy(idx)
        response = await model.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": _build_user_message(raw_prompt, feedback)},
            ]
        )
        result: dict[str, Any] = {
            "model": llm_settings.COUNCIL_MODELS[idx],
            "optimized_prompt": str(response.content).strip(),
            "usage": getattr(response, "usage_metadata", {}) or {},
        }
        if job_id:
            async with lock:
                done_count[0] += 1
                n = done_count[0]
            await push_job_progress(
                job_id, {"step": "council", "done": n, "total": total, "ts": time.time()}
            )
        return result

    results = await asyncio.gather(
        *[optimize(m, i) for i, m in enumerate(models)],
        return_exceptions=True,
    )

    valid = []
    for i, r in enumerate(results):
        if isinstance(r, dict):
            valid.append(r)
        else:
            logger.error(
                "Council model %s failed: %s: %s",
                llm_settings.COUNCIL_MODELS[i],
                type(r).__name__,
                r,
            )

    return {"council_responses": valid}
```

- [ ] **Step 2: Run make check**

```bash
make check
```
Expected: `✅ All checks passed`

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/graph/nodes/council_vote.py
git commit -m "feat(streaming): instrument council_vote with per-model progress events"
```

---

## Task 5: Wire job_id through the Celery task

**Files:**
- Modify: `qa-chatbot/src/app/workers/tasks.py`

- [ ] **Step 1: Pass job_id to service.process()**

Open `qa-chatbot/src/app/workers/tasks.py`. In `_run()`, find the `service.process()` call and add `job_id=job_id`:

```python
result = await service.process(
    user_id=user_id,
    raw_prompt=raw_prompt,
    session_id=session_id,
    feedback=feedback,
    title=_fallback_title(raw_prompt),
    job_id=job_id,
)
```

- [ ] **Step 2: Run make check**

```bash
make check
```
Expected: `✅ All checks passed`

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/workers/tasks.py
git commit -m "feat(streaming): pass job_id into graph state via ChatService"
```

---

## Task 6: Add SSE stream endpoint

**Files:**
- Modify: `qa-chatbot/src/app/api/v1/chat.py`

- [ ] **Step 1: Add necessary imports to chat.py**

Open `qa-chatbot/src/app/api/v1/chat.py`. Add these imports (merge with existing import block):

```python
import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi.responses import StreamingResponse
```

Also add `get_job_progress_from` to the existing `app.core.cache` import line:

```python
from app.core.cache import get_job_result, get_job_progress_from, get_job_status, set_job_status
```

- [ ] **Step 2: Add the SSE endpoint after the existing poll_chat_job route**

Insert the following route after `poll_chat_job` (after the `/jobs/{job_id}` GET handler):

```python
@router.get(
    "/jobs/{job_id}/stream",
    response_class=StreamingResponse,
)
async def stream_job_progress(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """
    SSE stream of real-time pipeline progress events.

    Streams JSON events as `data: {...}\\n\\n` until the job completes or fails.
    The terminal `completed` event embeds the full result so no second fetch is needed.
    Poll interval on the server side: 250 ms.
    """

    async def generate() -> AsyncGenerator[str, None]:
        last_idx = 0
        while True:
            # Emit any new events since last poll
            events = await get_job_progress_from(job_id, last_idx)
            for ev in events:
                yield f"data: {json.dumps(ev)}\n\n"
                last_idx += 1

            status = await get_job_status(job_id)

            if status == "completed":
                # Drain any events written between the last LRANGE and the status check
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

- [ ] **Step 3: Run make check**

```bash
make check
```
Expected: `✅ All checks passed`

- [ ] **Step 4: Smoke-test the endpoint exists**

With the dev server running (`make dev`), run:
```bash
curl -s http://localhost:8000/docs | grep -o 'stream_job_progress'
```
Expected output: `stream_job_progress`

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/api/v1/chat.py
git commit -m "feat(streaming): add SSE /jobs/{id}/stream endpoint"
```

---

## Task 7: Frontend types

**Files:**
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add progress event types**

Open `frontend/src/types/api.ts`. Add the following after the `JobStatusResponse` interface (around line 47):

```typescript
export type ProgressStep =
  | 'intent'
  | 'council'
  | 'critic'
  | 'synthesize'
  | 'completed'
  | 'failed';

export interface JobProgressEvent {
  step: ProgressStep;
  done?: number;      // council only: which model just finished (1-4)
  total?: number;     // council only: total council size (always 4)
  ts?: number;        // unix timestamp from server
  result?: JobResult; // completed only: full result embedded
  error?: string;     // failed only
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no output (clean)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat(streaming): add JobProgressEvent and ProgressStep types"
```

---

## Task 8: useJobStream hook

**Files:**
- Create: `frontend/src/hooks/use-job-stream.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/use-job-stream.ts` with the following content:

```typescript
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
 *
 * Replaces useJobPoller — provides real-time progress events as the LangGraph
 * pipeline progresses through intent → council (x4) → critic → synthesize.
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
          setError(`Stream request failed: ${res.status}`);
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
          // SSE lines end with \n; double \n separates events — process complete lines only
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
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no output (clean)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-job-stream.ts
git commit -m "feat(streaming): add useJobStream hook with fetch+ReadableStream"
```

---

## Task 9: JobProgress component

**Files:**
- Create: `frontend/src/components/optimize/job-progress.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/optimize/job-progress.tsx`:

```tsx
'use client';

import type { JobProgressEvent } from '@/types/api';

interface StepDef {
  id: string;
  label: string;
}

const STEPS: StepDef[] = [
  { id: 'intent',     label: 'Analyzing prompt' },
  { id: 'council_1',  label: 'Optimizer 1 / 4' },
  { id: 'council_2',  label: 'Optimizer 2 / 4' },
  { id: 'council_3',  label: 'Optimizer 3 / 4' },
  { id: 'council_4',  label: 'Optimizer 4 / 4' },
  { id: 'critic',     label: 'Peer reviewing' },
  { id: 'synthesize', label: 'Synthesizing result' },
];

function resolvedStepIds(progress: JobProgressEvent[]): Set<string> {
  const done = new Set<string>();
  for (const ev of progress) {
    if (ev.step === 'intent') done.add('intent');
    else if (ev.step === 'council' && ev.done != null) done.add(`council_${ev.done}`);
    else if (ev.step === 'critic') done.add('critic');
    else if (ev.step === 'synthesize') done.add('synthesize');
  }
  return done;
}

interface Props {
  progress: JobProgressEvent[];
}

export function JobProgress({ progress }: Props) {
  const done = resolvedStepIds(progress);
  // First step not yet completed is the active one
  const activeIdx = STEPS.findIndex((s) => !done.has(s.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      {STEPS.map((step, i) => {
        const isComplete = done.has(step.id);
        const isActive = i === activeIdx;

        return (
          <div
            key={step.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: !isComplete && !isActive ? 0.35 : 1,
              transition: 'opacity 300ms',
            }}
          >
            {/* Dot / spinner / checkmark */}
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isComplete
                  ? 'rgba(124,92,255,0.15)'
                  : isActive
                    ? 'rgba(124,92,255,0.12)'
                    : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isComplete || isActive ? 'rgba(124,92,255,0.4)' : '#2a2a2e'}`,
              }}
            >
              {isComplete ? (
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="#7c5cff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : isActive ? (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#7c5cff',
                    animation: 'pulse 1.4s ease-in-out infinite',
                  }}
                />
              ) : (
                <div
                  style={{ width: 5, height: 5, borderRadius: '50%', background: '#3a3a40' }}
                />
              )}
            </div>

            {/* Label */}
            <span
              style={{
                fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 11.5,
                color: isComplete ? '#7c5cff' : isActive ? '#c4b5fd' : '#5a5a60',
                fontWeight: isActive ? 500 : 400,
                transition: 'color 300ms',
              }}
            >
              {step.label}
            </span>

            {isComplete && (
              <span
                style={{
                  fontFamily: 'var(--font-geist-mono, monospace)',
                  fontSize: 10,
                  color: '#3a3a40',
                  marginLeft: 'auto',
                }}
              >
                done
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/job-progress.tsx
git commit -m "feat(streaming): add JobProgress 7-step timeline component"
```

---

## Task 10: Wire optimize-chat.tsx and chat-message.tsx

**Files:**
- Modify: `frontend/src/components/optimize/chat-message.tsx`
- Modify: `frontend/src/components/optimize/optimize-chat.tsx`

- [ ] **Step 1: Update chat-message.tsx to accept and render progress**

Open `frontend/src/components/optimize/chat-message.tsx`.

Add `JobProgressEvent` to the imports at top:
```typescript
import type { ChatTurn, JobProgressEvent } from '@/types/api';
import { JobProgress } from './job-progress';
```

Add `progress?: JobProgressEvent[]` to `AssistantResultProps` and render `<JobProgress>` when it has data:

```typescript
interface AssistantResultProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: () => void;
  progress?: JobProgressEvent[];
}

function AssistantResult({ turn, isTurnSelected, onSelectTurn, progress }: AssistantResultProps) {
  const [copied, setCopied] = useState(false);

  if (turn.status === 'loading') {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <PromptlyIcon />
        <div style={{ flex: 1, background: '#1a1a1a', borderRadius: '4px 14px 14px 14px',
          border: '1px solid #1f1f23', padding: '14px 16px' }}>
          {progress && progress.length > 0 ? (
            <JobProgress progress={progress} />
          ) : (
            <LoadingWords />
          )}
        </div>
      </div>
    );
  }
  // ... rest of AssistantResult unchanged
```

Also add `progress?: JobProgressEvent[]` to the `ChatMessage` component interface and pass it through to `AssistantResult`:

```typescript
interface ChatMessageProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: (tempId: string) => void;
  progress?: JobProgressEvent[];
}

export function ChatMessage({ turn, isTurnSelected, onSelectTurn, progress }: ChatMessageProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <UserBubble text={turn.userText} isFeedback={turn.isFeedback} />
      <AssistantResult
        turn={turn}
        isTurnSelected={isTurnSelected}
        onSelectTurn={() => onSelectTurn(turn.tempId)}
        progress={progress}
      />
    </div>
  );
}
```

- [ ] **Step 2: Replace useJobPoller with useJobStream in optimize-chat.tsx**

Open `frontend/src/components/optimize/optimize-chat.tsx`.

**Change the import** — replace `useJobPoller` with `useJobStream`:
```typescript
// Remove:
import { useJobPoller } from '@/hooks/use-job-poller';
// Add:
import { useJobStream } from '@/hooks/use-job-stream';
```

**Replace the poll hook call** (around line 249). Find:
```typescript
// Poll active job
const { data: jobData } = useJobPoller(activeJobId);
```
Replace with:
```typescript
// Stream active job progress
const { status: streamStatus, result: streamResult, error: streamError, progress: streamProgress } =
  useJobStream(activeJobId);
```

**Replace the jobData useEffect** (lines 251–304). Remove the entire existing `useEffect` that processes `jobData` and replace with:
```typescript
// Handle job completion/failure from the SSE stream
useEffect(() => {
  if (streamStatus === 'completed' && streamResult && activeJobId) {
    const completedJobId = activeJobId;
    const completedResult = streamResult;
    const completedTempId = turnsRef.current.find((t) => t.jobId === completedJobId)?.tempId;

    setTurns((prev) =>
      prev.map((t) =>
        t.jobId === completedJobId ? { ...t, status: 'completed', result: completedResult } : t
      )
    );
    if (completedTempId) {
      setSelectedTurnId(completedTempId);
      setDesktopPanelDismissed(false);
      setMobilePanelOpen(true);
    }
    setActiveJobId(null);
    if (sessionId) sessionStorage.removeItem(`pending_job_${sessionId}`);
    queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    queryClient.invalidateQueries({ queryKey: ['recent-sessions'] });

    // Auto-version: on first result in a session, create the version family silently
    if (!versionPromptId && !completedResult.prompt_id) {
      api
        .post<{ data: { prompt_id: string; name: string; version: number } }>(
          '/api/v1/chat/save-version',
          {
            original_prompt: completedResult.original_prompt,
            optimized_prompt: completedResult.optimized_prompt,
          }
        )
        .then((res) => {
          const { prompt_id, version } = res.data.data;
          setVersionPromptId(prompt_id);
          setTurns((prev) =>
            prev.map((t) =>
              t.jobId === completedJobId && t.result
                ? { ...t, result: { ...t.result, prompt_id, version } }
                : t
            )
          );
        })
        .catch(() => {}); // silent — versioning failure shouldn't block the UX
    }
  } else if (streamStatus === 'failed' && activeJobId) {
    const errMsg = formatApiErrorDetail(streamError ?? undefined, 'Optimization failed');
    setTurns((prev) =>
      prev.map((t) =>
        t.jobId === activeJobId ? { ...t, status: 'failed', error: errMsg } : t
      )
    );
    setActiveJobId(null);
    if (sessionId) sessionStorage.removeItem(`pending_job_${sessionId}`);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [streamStatus, streamResult, streamError]);
```

**Pass progress to the loading ChatMessage** — find the `turns.map(...)` render section (after the messages area). Locate where `<ChatMessage>` is rendered and add the `progress` prop:

```tsx
{turns.map((turn) => (
  <ChatMessage
    key={turn.tempId}
    turn={turn}
    isTurnSelected={turn.tempId === selectedTurnId}
    onSelectTurn={handleSelectTurn}
    progress={turn.jobId === activeJobId ? streamProgress : undefined}
  />
))}
```

- [ ] **Step 3: Run TypeScript check and lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```
Expected: no type errors; only the pre-existing `react-hooks/exhaustive-deps` warning on `optimize-chat.tsx`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/optimize/chat-message.tsx \
        frontend/src/components/optimize/optimize-chat.tsx
git commit -m "feat(streaming): wire useJobStream and JobProgress into optimize chat UI"
```

---

## Task 11: Final backend check and verification

- [ ] **Step 1: Run full backend check**

```bash
cd qa-chatbot && make check
```
Expected: `✅ All checks passed`

- [ ] **Step 2: Verify progress key pattern in Redis (manual smoke test)**

With infra running (`make infra`), backend running (`make dev`), and worker running (`make worker`), submit a prompt and watch the Redis progress list grow:

```bash
# In a separate terminal, after submitting a prompt via the UI:
# Get the job_id from the browser network tab or API response, then:
redis-cli LRANGE "chat:job:<job_id>:progress" 0 -1
```
Expected: 7 JSON strings appearing as the pipeline progresses.

- [ ] **Step 3: Verify SSE stream in browser dev tools**

Open Chrome DevTools → Network tab → filter by "stream". Submit a prompt. Confirm:
- A request to `/api/v1/chat/jobs/{id}/stream` appears
- Type is `text/event-stream`
- EventStream tab shows 7 events before the `completed` event
- The loading bubble in the chat shows the 7-step timeline (not `LoadingWords`)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(streaming): complete real-time SSE optimization progress"
```
