# Subject Classifier Node — Design

**Date:** 2026-06-02
**Status:** Approved design, pending implementation plan
**Component:** `qa-chatbot` LangGraph optimization pipeline

## Problem

The optimization pipeline currently goes `intent_classifier → performance_gate → council_vote → critic → synthesize`. The council, critic, and chairman work directly from the raw prompt with no shared, explicit understanding of *what the prompt is about* or *what specific improvements it most needs*.

We want a dedicated node that produces a compact, structured analysis of the input prompt — what it is about, and concrete suggestions to enhance it — and feeds that analysis into the council, critic, and chairman so every stage shares the same framing.

## Goals

- Add a `subject_classifier` node that runs once per user turn, before `council_vote`.
- Output two sections, each a list of short points:
  - **about** — what the prompt is about / its purpose
  - **suggestions** — how to enhance it
- Both sections capped at **4 points**, can be fewer, always **equal counts**. Deliberately small to avoid over-engineering the downstream prompts.
- Thread this analysis into the **council**, **critic**, and **chairman (synthesize)** prompts as **advisory context** — it informs them but never overrides user feedback or critic quality-gaps.
- Handle the **feedback** case correctly (see below).

## Non-goals (for now)

- No UI display and no DB persistence of the analysis. It is internal pipeline context only.
- No change to credit pricing (optimization stays 10 credits).
- No change to the existing intent_classifier or the gates' behavior.

## Design

### Graph placement

The node sits on **every path that reaches `council_vote`**, so it runs exactly once before Round 1. The quality-gate refinement loop re-enters at `council_vote` and therefore does **not** re-run subject_classifier; the analysis is stored in state and reused across loop iterations.

```
intent_classifier ─ blocked ─────────────────────► END
        │
        ├─ force_optimize ──────────────────────► subject_classifier ─► council_vote
        ├─ gate ─► performance_gate ─ exit ─────► END
        │                          └ proceed ───► subject_classifier ─► council_vote
        └─ (gate disabled) proceed ─────────────► subject_classifier ─► council_vote

council_vote → critic → synthesize → (quality_gate ⟲ council_vote | END)
```

When `SUBJECT_CLASSIFIER_ENABLED` is `False`, the node is not registered and all the above paths point straight at `council_vote` (today's behavior — a clean no-op).

### Behavior

`subject_classifier_node` receives `state["raw_prompt"]` and `state["feedback"]`:

- **Normal (first) turn:** `raw_prompt` is the user's prompt. The node analyzes it.
  - **about** — ≤4 points on what the prompt is about.
  - **suggestions** — equal count of enhancement points.
- **Feedback turn:** the frontend sends the latest optimized prompt as the prompt and the user's guidance as feedback, so `state["raw_prompt"]` **is the latest optimized prompt** and `state["feedback"]` is the new directive (confirmed in `api/v1/chat.py`). The node:
  - analyzes the **latest optimized prompt** for **about**, and
  - **reads the feedback and folds it into suggestions** — the user's feedback becomes the leading enhancement point(s); remaining points (up to the equal-count cap) cover other gaps.
  - The normal pipeline then runs with this analysis as advisory context.

### Output contract

The LLM returns JSON:

```json
{
  "about": ["...", "..."],
  "suggestions": ["...", "..."]
}
```

Node-side normalization (deterministic, after parse):
1. Coerce both to lists of non-empty trimmed strings.
2. Cap each at 4 points.
3. Truncate both to `min(len(about), len(suggestions))` so counts are always equal.
4. If either list ends up empty → treat as "no analysis": set both state fields to `None`.

**Fail-open:** any LLM error or JSON parse/type failure → return `{"subject_about": None, "subject_suggestions": None}` and let the pipeline proceed normally. A flaky analysis node must never block or break optimization (same philosophy as `performance_gate`).

### Advisory threading

A shared formatter builds the block injected into the three downstream prompts (returns `None` when there is no analysis):

```
PROMPT ANALYSIS (advisory context — consider these, but user feedback and peer
quality gaps remain the overriding directives):
What this prompt is about:
- ...
Suggested enhancements to consider:
- ...
```

Placement in each downstream user message: inserted as context **after the prompt/proposals but before the feedback and quality-gap blocks**, so those remain the strongest/last signals.

- **council** — guidance to consider while optimizing.
- **critic** — context so reviewers can check whether proposals leveraged the relevant suggestions.
- **chairman (synthesize)** — context so the final prompt reflects the relevant suggestions.

## Components / files

**New:**
- `src/app/graph/prompts/subject_classifier.py` — `subject_classifier_messages(raw_prompt, feedback)` with a tight, specific system prompt (two sections only, JSON out, ≤4 equal points, one short sentence each, explicit "no padding" instruction, feedback-folding rule). Also `subject_analysis_block(about, suggestions) -> str | None` formatter.
- `src/app/graph/nodes/subject_classifier.py` — node with loop-affinity-cached model, JSON parse, normalization, fail-open, `"subject"` SSE progress step.
- Tests for the prompt builder and the node.

**Modified:**
- `src/app/graph/state.py` — add `subject_about: list[str] | None`, `subject_suggestions: list[str] | None`.
- `src/app/graph/builder.py` — register node + reroute intent/performance-gate edges through it (guarded by the flag).
- `src/app/graph/prompts/__init__.py` — export the two new functions.
- `src/app/llm/pipeline.py` — `build_subject_classifier()` (DEFAULT_MODEL, temperature 0, small max_tokens).
- `src/app/llm/settings.py` — `SUBJECT_CLASSIFIER_ENABLED: bool = True`.
- `src/app/graph/prompts/council_optimizer.py`, `critic.py`, `synthesize_best.py` — add optional `subject_block: str | None = None` param, inject as advisory context (default `None` keeps backward compatibility).
- `src/app/graph/nodes/council_vote.py`, `critic.py`, `synthesize.py` — build the block from state and pass it through.

### State initialization

`chat_service.py` and `tasks.py` build the initial `GraphState`. The two new keys must be initialized (to `None`) wherever the initial state dict is constructed, to keep the `TypedDict` complete.

## Cost & safety

- One extra lightweight LLM call per user turn. Credit price unchanged.
- Fail-open + `SUBJECT_CLASSIFIER_ENABLED` flag mean the node can never block optimization and can be disabled instantly.

## Testing

- **Prompt builder:** message construction with and without feedback; feedback-folding instruction present only when feedback is given.
- **Node normalization:** valid JSON → equal-count ≤4; unequal counts → truncated to `min`; >4 → capped; malformed JSON / LLM error → fail-open `None`.
- **Block formatter:** `None` when both lists empty; correct format otherwise.
- **Graph:** compiles and routes correctly with the flag on and off; subject_classifier runs once (not per refinement loop). Existing council/critic/synthesize tests stay green because all new prompt params default to `None`.
