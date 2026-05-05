# Performance Gate — Design

**Date:** 2026-05-05
**Status:** Approved, ready for implementation plan

## Problem

The optimize pipeline currently runs the full 4-model council on every prompt that passes the intent_classifier, even when the prompt is already production-grade. This wastes:

- **User credits** — 10 credits per run, regardless of whether the optimization changes anything material.
- **Latency** — 4 council calls + critic + synthesize + (optional) quality_gate refinement loop, even for prompts that don't need it.
- **LLM spend** — server-side cost we eat regardless of outcome.

A side effect already observed: when an already-strong prompt goes through the council, the synthesis often regresses (over-engineering) or barely changes, then the quality_gate may loop trying to "improve" it further — an endless refinement cycle on a prompt that didn't need refining.

## Goal

Add a single LangGraph node — `performance_gate` — that sits before the council and short-circuits the pipeline when the raw prompt is already optimized. The user receives a clear "already optimized" signal with the same 8-dimension breakdown the rest of the system uses, plus an explicit "Force optimize anyway" escape hatch.

The gate must have a **very low false-positive rate**. Flagging a mediocre prompt as "already optimized" is worse than running an unnecessary council pass — users lose trust in the product. The bar is deliberately stricter than the quality_gate's pass condition.

## Non-goals

- Replacing the quality_gate (it still runs on synthesized output).
- Introducing per-category gate behavior — the gate uses one universal scoring scale.
- Deep semantic analysis of the prompt's domain — out of scope.

## High-level flow

```
intent_classifier
  ├─ irrelevant → END
  └─ optimize  → performance_gate
                  ├─ already_optimized → END (final_response = original prompt)
                  └─ needs_work        → council_vote → critic → synthesize → quality_gate → …
```

The `performance_gate` is registered conditionally based on a new config flag `PERFORMANCE_GATE_ENABLED: bool = True` (env-overridable), matching the pattern used by `QUALITY_GATE_ENABLED`. When disabled, the graph reverts to the current `intent_classifier → council_vote` edge.

A new request flag `force_optimize: bool = False` lets users (and the "Force optimize anyway" UI button) bypass the gate. When `force_optimize=true`, the router sends OPTIMIZE intents directly to `council_vote`, skipping `performance_gate` even if it's enabled.

## The gate's pass condition

A prompt is `already_optimized` only when **all three** of these hold:

1. `goal_clarity` is **strong** (non-negotiable — an unclear goal is the single largest predictor that the council will improve the prompt).
2. **Zero** dimensions scored **missing**.
3. **At most 1** dimension scored **weak**.

This is **stricter than the quality_gate's pass condition** (which allows up to 2 weak dimensions). Justification: the input bar must be higher than the output bar, otherwise the gate would trip on prompts the council itself would only barely improve.

The 8 dimensions are the same as the quality_gate uses: `role_persona`, `goal_clarity`, `context_grounding`, `output_format`, `examples_exemplars`, `constraints_guardrails`, `tone_audience`, `conciseness`. Reusing this scale means the system has one internal language for prompt quality.

## Implementation

### Backend

**New node:** `app/graph/nodes/performance_gate.py`. Reuses the same fast/cheap model (`openai/gpt-4o-mini` via OpenRouter) and the same JSON output shape as `quality_gate.py`. The system prompt is a tightened variant of the quality_gate prompt — same dimensions, same scoring scale, but the pass condition explicitly enforces the stricter bar (≤ 1 weak, zero missing, goal_clarity strong).

The system prompt also includes a calibration instruction emphasizing **"when uncertain, score as 'weak' rather than 'strong'"** — false negatives (sending a good prompt through the council) are cheaper than false positives (skipping optimization the user wanted).

**Defensive parse.** If the gate response fails to parse as JSON, or any required field is missing, the node treats the prompt as **not optimized** and proceeds to council. A flaky LLM call must never block legitimate optimization.

**State additions** (`GraphState`):
- `already_optimized: bool` — defaults to False
- `gate_dimension_scores: dict[str, str] | None` — the 8 dimension labels, populated when the gate runs
- `gate_rationale: str | None` — one-sentence explanation
- `force_optimize: bool` — defaults to False, set from request

**State writes when "already optimized":**
- `already_optimized = True`
- `gate_dimension_scores = {<all 8 dimensions>}`
- `gate_rationale = "<one sentence>"`
- `final_response = state["raw_prompt"]` — original becomes the result so downstream code (DB persistence, response shaping) needs no changes
- `council_responses = []`, `critic_responses = []` — explicit signal that no council ran

**Graph wiring** (`graph/builder.py`):

```python
def _route_after_intent(state: GraphState) -> str:
    intent = state.get("intent")
    if intent == "irrelevant":
        return "blocked"
    if state.get("force_optimize"):
        return "skip_gate"   # straight to council
    return "gate"

def _route_after_performance_gate(state: GraphState) -> str:
    return "exit" if state.get("already_optimized") else "proceed"
```

When `PERFORMANCE_GATE_ENABLED` is false: skip the node and the gate-router; intent_classifier routes OPTIMIZE directly to council_vote (current behavior).

### Credits

- **API endpoint** (`POST /chat/`): unchanged — deducts 10 credits upfront.
- **Celery worker** (`process_chat_async`): on `already_optimized`, refund 5 credits via `UserRepository.refund_credits` to bring net cost to 5. Log a `usage_event` with `action="optimize"` and `credits_spent=5` (so the existing `(action, job_id)` unique constraint still dedupes retries; analytics reflect actual charge).
- **Force optimize**: charges the regular 10 credits, logs a normal optimize event.
- **Failure mode** inside the gate (LLM error / parse error): the node falls through to council. User pays full 10 credits and gets a real optimization. No refund.

### API contract

**`ChatRequest`** gains:
```python
force_optimize: bool = Field(default=False)
```

**`ChatResponse`** gains:
```python
already_optimized: bool = False
gate_dimension_scores: dict[str, str] | None = None
gate_rationale: str | None = None
```

`council_proposals` remains empty when `already_optimized` is true.

**Persistence.** `Message.council_votes` stays empty for already-optimized turns. The `already_optimized` signal is reconstructable on history load by checking `len(council_votes) == 0`. We do **not** add a new column — keeping the schema unchanged for this iteration.

The `gate_dimension_scores` and `gate_rationale` are returned in the live job result but are **not persisted** to `Message`. If the user reloads the session later, the breakdown is lost — they'd see "already optimized" without the dimension table. This is an explicit trade-off for v1 simplicity. If users complain, a follow-up adds a JSON column.

### Frontend

The chat message and the right panel are reused — only content + a badge change.

**Chat message** (assistant turn when already optimized):
- Text: *"Your prompt is already in great shape — no changes made. Open the right panel to see why."*
- Inline green pill: `Already optimized`

**Right panel header**:
- Same `Already optimized` pill, next to the version chip
- Section label changes from `Optimized prompt` → `Original prompt`

**Right panel body**:
- The original prompt (so existing `Copy` / `Heart` / `Save as version` controls work unchanged)
- New dimension breakdown table reading from `gate_dimension_scores`:
  ```
  ROLE / PERSONA          ●  strong
  GOAL CLARITY            ●  strong
  CONTEXT GROUNDING       ●  strong
  OUTPUT FORMAT           ●  strong
  EXAMPLES / EXEMPLARS    ●  strong
  CONSTRAINTS             ●  weak
  TONE & AUDIENCE         ●  strong
  CONCISENESS             ●  strong
  ```
  - Strong: green dot
  - Weak: yellow dot
  - Missing: red dot
- One-line caption: the `gate_rationale` text
- **`Force optimize anyway`** button below the table — re-submits with `force_optimize: true`, costs 10 credits, runs the full council

## Failure & edge-case handling

| Scenario | Behavior |
|----------|----------|
| Gate LLM returns invalid JSON | Treat as not_optimized; proceed to council. User charged 10 credits. |
| Gate LLM times out | Treat as not_optimized; proceed to council. |
| Gate LLM returns `goal_clarity: "missing"` but other dims `strong` | Pass condition fails (goal_clarity must be strong). Proceed to council. |
| User submits with `force_optimize=true` and gate is disabled | No-op — the flag has no effect; council runs as normal. |
| User toggles `force_optimize=true` in feedback follow-up | Honored — the follow-up bypasses the gate. |

## Testing strategy

**Unit tests** (`tests/unit/`):
- `performance_gate_node`: pass condition correctness across all combinations of (goal_clarity, weak count, missing count). Use mocked LLM responses.
- Defensive-parse path: malformed JSON → `already_optimized=False`.
- State writes match contract on both pass and fail branches.

**Integration tests** (`tests/integration/`):
- End-to-end: submit a known-strong prompt, expect `already_optimized: true` with dimension scores returned.
- End-to-end: submit a known-weak prompt, expect council to run.
- Force-optimize: submit a strong prompt with `force_optimize: true`, expect council to run.
- Refund check: assert credits decreased by 5 (not 10) on already-optimized path.
- `(action, job_id)` dedupe: simulate Celery retry → at most one usage_event row per job.

**Manual QA**:
- Curated set of 10 prompts with hand-rated quality. Expect agreement with gate verdict ≥ 8/10. False-positive rate ≤ 1/10 is the acceptance bar.

## Rollout

1. Ship behind `PERFORMANCE_GATE_ENABLED=true` in dev. Verify against curated set.
2. Default to `true` in prod. Monitor (a) % of optimize requests that short-circuit, (b) "Force optimize anyway" click-through rate. A click-through rate above ~15% would indicate too many false positives — tighten the prompt or revert.
3. If false positives are tracked: add a one-line item to the analytics dashboard for the ratio of `force_optimize` follow-ups within the same session as a recent already-optimized turn.

## Open questions

None. All decisions made:
- Definition of "already optimized" → strict reuse of 8-dimension scale (Q1.A).
- UX → reuse panel + badge + dimension table + force button (Q2.A+B partial).
- Credits → 5 charged, 5 refunded (Q3.A).
