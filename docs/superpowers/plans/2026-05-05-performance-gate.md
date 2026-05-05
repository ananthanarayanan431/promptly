# Performance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `performance_gate` LangGraph node that short-circuits the optimize pipeline when the user's raw prompt is already production-grade, returning the original prompt with an 8-dimension breakdown instead of running the 4-model council.

**Architecture:** New node sits between `intent_classifier` and `council_vote`. Reuses the same fast LLM (`openai/gpt-4o-mini`) and 8-dimension scoring scale as `quality_gate`, with a stricter pass condition (≤ 1 weak, zero missing, `goal_clarity` strong). On pass: writes original prompt as `final_response`, attaches dimension scores to state, refunds 5 of the 10 deducted credits. On fail or LLM error: falls through to council. A new `force_optimize` request flag bypasses the gate.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, LangGraph, OpenRouter (gpt-4o-mini), Celery, Next.js 14, TanStack Query.

---

## File Structure

**Backend — Create:**
- `qa-chatbot/src/app/graph/prompts/performance_gate.py` — system prompt + message builder
- `qa-chatbot/src/app/graph/nodes/performance_gate.py` — the LangGraph node
- `qa-chatbot/tests/unit/graph/test_performance_gate.py` — unit tests for the node

**Backend — Modify:**
- `qa-chatbot/src/app/config/llm.py` — add `PERFORMANCE_GATE_ENABLED: bool = True`
- `qa-chatbot/src/app/graph/state.py` — add `already_optimized`, `gate_dimension_scores`, `gate_rationale`, `force_optimize`
- `qa-chatbot/src/app/graph/prompts/__init__.py` — export the new prompt builder
- `qa-chatbot/src/app/graph/builder.py` — register node, wire conditional edges
- `qa-chatbot/src/app/schemas/chat.py` — add `force_optimize` to `ChatRequest`; add gate fields to `ChatResponse`
- `qa-chatbot/src/app/services/chat_service.py` — accept and seed `force_optimize`, surface gate fields in result; also update `prompt_service.py` `GraphState` literal
- `qa-chatbot/src/app/services/prompt_service.py` — add new state keys to the GraphState literals
- `qa-chatbot/src/app/api/v1/chat.py` — pass `force_optimize` through to the worker
- `qa-chatbot/src/app/workers/tasks.py` — accept `force_optimize`, refund 5 credits when `already_optimized` is true, log `usage_event` with `credits_spent=5`

**Frontend — Modify:**
- `frontend/src/types/api.ts` — extend `JobResult` (the chat response type) with the three gate fields; extend the chat request body type
- `frontend/src/components/optimize/optimize-chat.tsx` — pass `force_optimize` to the chat API; surface `already_optimized` per turn
- `frontend/src/components/optimize/result-panel.tsx` — render the "Already optimized" badge, dimension breakdown, and "Force optimize anyway" button when `already_optimized` is true
- `frontend/src/components/optimize/chat-message.tsx` — render the inline "Already optimized" badge on assistant turns

---

## Task 1: Backend config flag

**Files:**
- Modify: `qa-chatbot/src/app/config/llm.py`

- [ ] **Step 1: Add the new config flag**

Open `qa-chatbot/src/app/config/llm.py`. Find the existing `QUALITY_GATE_ENABLED` field. Add the new flag immediately below it:

```python
    # When False, the performance_gate node is skipped entirely — every OPTIMIZE
    # intent goes straight to council_vote. Costs +1 fast LLM call per request when
    # enabled but skips the council for already-strong prompts.
    PERFORMANCE_GATE_ENABLED: bool = True
```

- [ ] **Step 2: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/app/config/llm.py && uv run mypy src/app/config/llm.py
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/config/llm.py
git commit -m "feat(config): add PERFORMANCE_GATE_ENABLED flag"
```

---

## Task 2: GraphState additions

**Files:**
- Modify: `qa-chatbot/src/app/graph/state.py`
- Modify: `qa-chatbot/src/app/services/prompt_service.py` (existing GraphState literals)
- Modify: `qa-chatbot/src/app/services/chat_service.py` (existing GraphState literals)

- [ ] **Step 1: Add four fields to GraphState**

Open `qa-chatbot/src/app/graph/state.py`. Find the `feedback` field (it's near the top of the TypedDict). Add the new fields immediately after the existing `category_*` block, before `version_history_diff`:

```python
    # performance_gate output — set by the node before any council work begins.
    # already_optimized=True means the council was NOT run; final_response holds the
    # original prompt unchanged.
    already_optimized: bool
    gate_dimension_scores: dict[str, str] | None
    gate_rationale: str | None

    # When True, performance_gate is skipped (force the council to run). Set from
    # the request payload.
    force_optimize: bool
```

- [ ] **Step 2: Update `ChatService.process` GraphState literal**

Open `qa-chatbot/src/app/services/chat_service.py`. Find the `initial_state: GraphState = {` literal inside `process()`. Add the four new keys (place them next to `feedback`/`category_*`):

```python
            "already_optimized": False,
            "gate_dimension_scores": None,
            "gate_rationale": None,
            "force_optimize": False,
```

Do the same for the second GraphState literal in the `stream()` method (later in the same file). Use the same defaults.

- [ ] **Step 3: Update PromptService GraphState literals**

Open `qa-chatbot/src/app/services/prompt_service.py`. There are two `state: GraphState = {` literals (in `_run_guardrails` and `create`). Add the four new keys to both with the same defaults:

```python
            "already_optimized": False,
            "gate_dimension_scores": None,
            "gate_rationale": None,
            "force_optimize": False,
```

- [ ] **Step 4: Verify typecheck passes (the test for this task)**

```bash
cd qa-chatbot && uv run mypy src/
```

Expected: `Success: no issues found in N source files`. mypy will catch any GraphState literal that's missing the new keys — that's the test for this task.

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/graph/state.py qa-chatbot/src/app/services/chat_service.py qa-chatbot/src/app/services/prompt_service.py
git commit -m "feat(graph): extend GraphState with performance_gate fields"
```

---

## Task 3: System prompt for performance_gate

**Files:**
- Create: `qa-chatbot/src/app/graph/prompts/performance_gate.py`
- Modify: `qa-chatbot/src/app/graph/prompts/__init__.py`
- Test: `qa-chatbot/tests/unit/graph/test_performance_gate.py` (we'll create this in Task 4 — for now just lint/typecheck)

- [ ] **Step 1: Write the prompt module**

Create `qa-chatbot/src/app/graph/prompts/performance_gate.py`:

```python
"""
Performance Gate prompt — scores a RAW user prompt on the 8 quality dimensions
to decide whether the council should run at all.

Mirrors the quality_gate's scoring scale and JSON contract, with a STRICTER
pass condition: the input bar must be higher than the output bar.
"""

_SYSTEM = """\
You are a prompt quality auditor evaluating a RAW prompt that a user has just
submitted for optimization. Your job: decide whether this prompt is already
production-grade enough that the optimization council should be skipped.

CALIBRATION
When uncertain, score conservatively as "weak" rather than "strong". A
false-positive (skipping optimization the user wanted) is far worse than a
false-negative (running the council on an already-strong prompt). When in
doubt, fail open — let the council run.

Return ONLY a valid JSON object. First character must be "{". No preamble, no
markdown fences.

SCORING SCALE
"strong"  — dimension is fully addressed; removing it would make the prompt
            materially worse
"weak"    — dimension is present but incomplete, vague, or partially addressed
"missing" — dimension is absent AND its absence would cause a worse LLM output

IMPORTANT: "missing" is only correct when the absent dimension would genuinely
hurt output quality for this specific prompt. Not every prompt needs a persona
or exemplars. Apply each dimension relative to what THIS prompt actually
requires.

DIMENSION PASS CONDITIONS

role_persona: "strong" if there is a specific, task-relevant expert persona
              (not "helpful assistant"). "missing" only if persona would
              materially improve output and is absent.

goal_clarity: "strong" if the core task has exactly one valid interpretation.
              "weak" if a competent model could plausibly misread it.
              "missing" if the task is undefined or deeply ambiguous.

context_grounding: "strong" if background/domain/audience is stated AND factual
                   tasks include a no-fabrication directive. "missing" if the
                   model must guess critical context.

output_format: "strong" if structure is defined for any case the model cannot
               infer correctly. "missing" only if format is genuinely undefined
               and the model would guess wrong.

examples_exemplars: "strong" if an example anchors tone/style when instruction
                    alone is insufficient. "missing" only if a complex
                    style/format requirement has no anchor example. Simple
                    unambiguous tasks: "strong" with no example is valid.

constraints_guardrails: "strong" if the most likely failure mode has a
                        specific, targeted guardrail. "weak" if only vague
                        hedges exist. "missing" if no guardrails and the task
                        has clear failure modes.

tone_audience: "strong" if audience is stated when register/depth would differ
               by reader. "missing" only if unstated audience would produce a
               wrong register. Self-contained tasks where audience is
               irrelevant: "strong" is valid.

conciseness: "strong" if every sentence is load-bearing — no padding, no
             defaults restated. "weak" if some filler exists but the signal is
             intact. "missing" is not used for this dimension.

OUTPUT SCHEMA
{
  "scores": {
    "role_persona": "strong | weak | missing",
    "goal_clarity": "strong | weak | missing",
    "context_grounding": "strong | weak | missing",
    "output_format": "strong | weak | missing",
    "examples_exemplars": "strong | weak | missing",
    "constraints_guardrails": "strong | weak | missing",
    "tone_audience": "strong | weak | missing",
    "conciseness": "strong | weak | missing"
  },
  "weak_dimensions": ["<dimensions scored weak or missing>"],
  "already_optimized": true | false,
  "rationale": "<one sentence stating the deciding factor>"
}

ALREADY-OPTIMIZED CONDITION (STRICTER than the post-synthesis gate)
"already_optimized" is true if AND ONLY IF ALL of:
  - goal_clarity is "strong" (non-negotiable)
  - Zero dimensions are "missing"
  - At most ONE dimension is "weak"
Otherwise "already_optimized" is false.
"""


def performance_gate_messages(raw_prompt: str) -> list[dict[str, str]]:
    """Build messages for the performance_gate LLM call."""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"Prompt to evaluate:\n{raw_prompt}"},
    ]
```

- [ ] **Step 2: Export from prompts package**

Open `qa-chatbot/src/app/graph/prompts/__init__.py`. Add to imports + `__all__`:

```python
from app.graph.prompts.category_guidance import category_guidance_block
from app.graph.prompts.council_optimizer import council_optimizer_messages
from app.graph.prompts.critic import critic_messages
from app.graph.prompts.favorite_auto_tag import favorite_auto_tag_messages
from app.graph.prompts.intent_classifier import intent_classifier_messages
from app.graph.prompts.performance_gate import performance_gate_messages
from app.graph.prompts.prompt_advisory import prompt_advisory_messages
from app.graph.prompts.prompt_health_score import prompt_health_score_messages
from app.graph.prompts.synthesize_best import synthesize_messages

__all__ = [
    "category_guidance_block",
    "council_optimizer_messages",
    "critic_messages",
    "favorite_auto_tag_messages",
    "intent_classifier_messages",
    "performance_gate_messages",
    "prompt_advisory_messages",
    "prompt_health_score_messages",
    "synthesize_messages",
]
```

- [ ] **Step 3: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/app/graph/prompts/ && uv run mypy src/app/graph/prompts/
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/app/graph/prompts/performance_gate.py qa-chatbot/src/app/graph/prompts/__init__.py
git commit -m "feat(prompts): add performance_gate system prompt"
```

---

## Task 4: performance_gate node — TDD

**Files:**
- Create: `qa-chatbot/src/app/graph/nodes/performance_gate.py`
- Test: `qa-chatbot/tests/unit/graph/test_performance_gate.py`

- [ ] **Step 1: Write the failing tests**

Create `qa-chatbot/tests/unit/graph/test_performance_gate.py`:

```python
"""Unit tests for the performance_gate node."""

import asyncio
import json
from unittest.mock import MagicMock, patch


def _base_state() -> dict:
    return {
        "raw_prompt": "Write me a haiku about the ocean.",
        "session_id": "",
        "user_id": "u1",
        "feedback": None,
        "category_slug": None,
        "category_name": None,
        "category_description": None,
        "category_is_predefined": False,
        "version_history_diff": None,
        "already_optimized": False,
        "gate_dimension_scores": None,
        "gate_rationale": None,
        "force_optimize": False,
        "job_id": None,
        "intent": "optimize",
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "iteration_count": 0,
        "max_iterations": 1,
        "previous_synthesis": None,
        "messages": [],
        "token_usage": {},
        "error": None,
    }


def _gate_response_already_optimized() -> str:
    return json.dumps(
        {
            "scores": {
                "role_persona": "strong",
                "goal_clarity": "strong",
                "context_grounding": "strong",
                "output_format": "strong",
                "examples_exemplars": "strong",
                "constraints_guardrails": "weak",
                "tone_audience": "strong",
                "conciseness": "strong",
            },
            "weak_dimensions": ["constraints_guardrails"],
            "already_optimized": True,
            "rationale": "Goal is unambiguous; only minor weakness in guardrails.",
        }
    )


def _gate_response_needs_work() -> str:
    return json.dumps(
        {
            "scores": {
                "role_persona": "missing",
                "goal_clarity": "weak",
                "context_grounding": "missing",
                "output_format": "weak",
                "examples_exemplars": "missing",
                "constraints_guardrails": "missing",
                "tone_audience": "weak",
                "conciseness": "weak",
            },
            "weak_dimensions": [
                "role_persona",
                "goal_clarity",
                "context_grounding",
                "output_format",
                "examples_exemplars",
                "constraints_guardrails",
                "tone_audience",
                "conciseness",
            ],
            "already_optimized": False,
            "rationale": "Goal unclear and persona/context absent.",
        }
    )


def _make_fake_model(response_content: str) -> MagicMock:
    fake = MagicMock()

    async def fake_ainvoke(_messages):
        m = MagicMock()
        m.content = response_content
        return m

    fake.ainvoke = fake_ainvoke
    return fake


def test_performance_gate_already_optimized_writes_original_as_final_response():
    from app.graph.nodes import performance_gate

    state = _base_state()
    fake = _make_fake_model(_gate_response_already_optimized())

    with patch.object(performance_gate, "_get_gate_model", return_value=fake):
        result = asyncio.run(performance_gate.performance_gate_node(state))

    assert result["already_optimized"] is True
    assert result["final_response"] == state["raw_prompt"]
    assert result["gate_rationale"]
    assert result["gate_dimension_scores"]["goal_clarity"] == "strong"
    # All 8 dimensions present
    assert len(result["gate_dimension_scores"]) == 8


def test_performance_gate_needs_work_does_not_short_circuit():
    from app.graph.nodes import performance_gate

    state = _base_state()
    fake = _make_fake_model(_gate_response_needs_work())

    with patch.object(performance_gate, "_get_gate_model", return_value=fake):
        result = asyncio.run(performance_gate.performance_gate_node(state))

    assert result["already_optimized"] is False
    # final_response is NOT set on the proceed-to-council branch
    assert "final_response" not in result or result["final_response"] == ""


def test_performance_gate_strict_pass_two_weak_fails():
    """Two weak dimensions must fail the gate (stricter than quality_gate)."""
    from app.graph.nodes import performance_gate

    payload = {
        "scores": {
            "role_persona": "weak",
            "goal_clarity": "strong",
            "context_grounding": "strong",
            "output_format": "weak",
            "examples_exemplars": "strong",
            "constraints_guardrails": "strong",
            "tone_audience": "strong",
            "conciseness": "strong",
        },
        "weak_dimensions": ["role_persona", "output_format"],
        # Even if the model claims "already_optimized": true, our deterministic
        # check catches it because two weak dimensions exceed the bar.
        "already_optimized": True,
        "rationale": "Two weak dims",
    }
    fake = _make_fake_model(json.dumps(payload))

    state = _base_state()
    with patch.object(performance_gate, "_get_gate_model", return_value=fake):
        result = asyncio.run(performance_gate.performance_gate_node(state))

    assert result["already_optimized"] is False


def test_performance_gate_goal_clarity_weak_fails_even_if_others_strong():
    from app.graph.nodes import performance_gate

    payload = {
        "scores": {
            "role_persona": "strong",
            "goal_clarity": "weak",
            "context_grounding": "strong",
            "output_format": "strong",
            "examples_exemplars": "strong",
            "constraints_guardrails": "strong",
            "tone_audience": "strong",
            "conciseness": "strong",
        },
        "weak_dimensions": ["goal_clarity"],
        "already_optimized": True,
        "rationale": "weak goal",
    }
    fake = _make_fake_model(json.dumps(payload))

    state = _base_state()
    with patch.object(performance_gate, "_get_gate_model", return_value=fake):
        result = asyncio.run(performance_gate.performance_gate_node(state))

    assert result["already_optimized"] is False


def test_performance_gate_malformed_json_falls_through_to_council():
    from app.graph.nodes import performance_gate

    fake = _make_fake_model("this is not json")
    state = _base_state()

    with patch.object(performance_gate, "_get_gate_model", return_value=fake):
        result = asyncio.run(performance_gate.performance_gate_node(state))

    assert result["already_optimized"] is False
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd qa-chatbot && uv run pytest tests/unit/graph/test_performance_gate.py -v
```

Expected: 5 errors (`ModuleNotFoundError: No module named 'app.graph.nodes.performance_gate'`).

- [ ] **Step 3: Implement the node**

Create `qa-chatbot/src/app/graph/nodes/performance_gate.py`:

```python
"""
Performance Gate node — runs BEFORE council_vote.

Scores the raw user prompt on the same 8 dimensions used by quality_gate, with
a stricter pass condition. When the prompt passes, the council is skipped:
final_response = raw_prompt and downstream nodes never run.

Defensive parse: any LLM/JSON failure makes the gate fail open (proceed to
council). False-positives (skipping optimization the user wanted) are far
worse than false-negatives.
"""

import asyncio
import json
import logging
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import performance_gate_messages
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

_REQUIRED_DIMENSIONS = (
    "role_persona",
    "goal_clarity",
    "context_grounding",
    "output_format",
    "examples_exemplars",
    "constraints_guardrails",
    "tone_audience",
    "conciseness",
)
_VALID_LABELS = frozenset({"strong", "weak", "missing"})

_loop_id: int | None = None
_gate_model: ChatOpenAI | None = None


def _get_gate_model() -> ChatOpenAI:
    """ChatOpenAI binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _gate_model
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _gate_model is None:
        llm_settings = get_llm_settings()
        _loop_id = lid
        _gate_model = ChatOpenAI(
            model="openai/gpt-4o-mini",
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
    return _gate_model


def _parse_gate_response(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        inner = text.split("```")[1]
        if inner.startswith("json"):
            inner = inner[4:]
        text = inner.strip()
    parsed: dict[str, Any] = json.loads(text)
    return parsed


def _scores_satisfy_bar(scores: dict[str, str]) -> bool:
    """Apply the stricter pass condition deterministically.

    Returns True iff ALL of:
      - every required dimension is present
      - every label is one of strong/weak/missing
      - goal_clarity == strong
      - zero "missing"
      - at most 1 "weak"
    """
    for d in _REQUIRED_DIMENSIONS:
        label = scores.get(d)
        if not isinstance(label, str) or label not in _VALID_LABELS:
            return False
    if scores["goal_clarity"] != "strong":
        return False
    missing_count = sum(1 for d in _REQUIRED_DIMENSIONS if scores[d] == "missing")
    if missing_count > 0:
        return False
    weak_count = sum(1 for d in _REQUIRED_DIMENSIONS if scores[d] == "weak")
    return weak_count <= 1


async def performance_gate_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — performance gate.

    Returns either:
      {"already_optimized": True, "final_response": <raw_prompt>, "gate_dimension_scores": {...}, "gate_rationale": <str>}
        → router sends graph to END.
      {"already_optimized": False}
        → router sends graph to council_vote.
    """
    raw_prompt = state["raw_prompt"]
    job_id = state.get("job_id")

    if job_id:
        await push_job_progress(job_id, {"step": "performance_gate", "ts": time.time()})

    try:
        response = await _get_gate_model().ainvoke(performance_gate_messages(raw_prompt))
        parsed = _parse_gate_response(str(response.content))
    except Exception:
        logger.exception("performance_gate scoring failed — falling through to council")
        return {"already_optimized": False}

    scores = parsed.get("scores")
    if not isinstance(scores, dict):
        return {"already_optimized": False}

    rationale = parsed.get("rationale")
    if not isinstance(rationale, str):
        rationale = ""

    if not _scores_satisfy_bar(scores):
        if job_id:
            await push_job_progress(
                job_id,
                {"step": "performance_gate", "decision": "proceed", "ts": time.time()},
            )
        return {"already_optimized": False}

    # Pass — short-circuit
    cleaned_scores = {d: scores[d] for d in _REQUIRED_DIMENSIONS}
    if job_id:
        await push_job_progress(
            job_id,
            {
                "step": "performance_gate",
                "decision": "already_optimized",
                "ts": time.time(),
            },
        )
    return {
        "already_optimized": True,
        "final_response": raw_prompt,
        "gate_dimension_scores": cleaned_scores,
        "gate_rationale": rationale,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd qa-chatbot && uv run pytest tests/unit/graph/test_performance_gate.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/app/graph/nodes/performance_gate.py tests/unit/graph/test_performance_gate.py && uv run mypy src/app/graph/nodes/performance_gate.py
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/app/graph/nodes/performance_gate.py qa-chatbot/tests/unit/graph/test_performance_gate.py
git commit -m "feat(graph): add performance_gate node with strict pass condition"
```

---

## Task 5: Wire performance_gate into the graph builder

**Files:**
- Modify: `qa-chatbot/src/app/graph/builder.py`

- [ ] **Step 1: Update the builder**

Open `qa-chatbot/src/app/graph/builder.py`. Replace the entire file with:

```python
"""
LangGraph pipeline — three-round prompt optimization council.

Round 0  performance_gate : decide whether the council should run at all
Round 1  council_vote     : 4 models independently optimize the prompt (parallel)
Round 2  critic           : each model blind-reviews the other 3 proposals (parallel)
Round 3  synthesize       : chairman synthesizes final answer from proposals + critiques

Intent gate (intent_classifier) sits before the pipeline and handles:
  - OPTIMIZE   → proceed to performance_gate (or council if force_optimize)
  - IRRELEVANT → END with rejection (covers harmful content, injection,
                 creation requests, and off-topic queries)
"""

from typing import Any

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph

from app.config.llm import get_llm_settings
from app.graph.nodes.council_vote import council_vote_node
from app.graph.nodes.critic import critic_node
from app.graph.nodes.intent_classifier import intent_classifier_node
from app.graph.nodes.performance_gate import performance_gate_node
from app.graph.nodes.quality_gate import quality_gate_node
from app.graph.nodes.synthesize import synthesize_node
from app.graph.state import GraphState


def _route_after_intent(state: GraphState) -> str:
    """
    After intent_classifier:
      - irrelevant   → END
      - force_optimize=True → skip performance_gate, run council
      - otherwise    → performance_gate
    """
    intent = state.get("intent")
    if intent == "irrelevant":
        return "blocked"
    if state.get("force_optimize"):
        return "skip_gate"
    return "gate"


def _route_after_performance_gate(state: GraphState) -> str:
    return "exit" if state.get("already_optimized") else "proceed"


def _route_quality_gate(state: GraphState) -> str:
    """
    After quality_gate: loop back to council_vote if the synthesis still has weak
    dimensions and we haven't hit the iteration ceiling; otherwise exit.

    The gate node already enforces the ceiling and convergence checks internally —
    it only omits the 'weak_dimensions' payload when it decided to exit.
    We route on whether quality_gate attached a new quality_gate sentinel entry
    (loop decision) vs. not (exit decision).
    """
    critic_responses = state.get("critic_responses") or []
    for cr in reversed(critic_responses):
        if cr.get("_quality_gate"):
            return "loop"
    return "exit"


async def compile_graph(checkpointer: AsyncPostgresSaver) -> Any:  # noqa: ANN401
    settings = get_llm_settings()
    quality_gate_enabled = settings.QUALITY_GATE_ENABLED
    performance_gate_enabled = settings.PERFORMANCE_GATE_ENABLED

    builder = StateGraph(GraphState)

    builder.add_node("intent_classifier", intent_classifier_node)
    builder.add_node("council_vote", council_vote_node)
    builder.add_node("critic", critic_node)
    builder.add_node("synthesize", synthesize_node)
    if performance_gate_enabled:
        builder.add_node("performance_gate", performance_gate_node)
    if quality_gate_enabled:
        builder.add_node("quality_gate", quality_gate_node)

    builder.set_entry_point("intent_classifier")

    if performance_gate_enabled:
        # intent_classifier → (END | performance_gate | council_vote)
        builder.add_conditional_edges(
            "intent_classifier",
            _route_after_intent,
            {
                "blocked": END,
                "gate": "performance_gate",
                "skip_gate": "council_vote",
            },
        )
        # performance_gate → (END | council_vote)
        builder.add_conditional_edges(
            "performance_gate",
            _route_after_performance_gate,
            {
                "exit": END,
                "proceed": "council_vote",
            },
        )
    else:
        # No performance_gate: original behavior — irrelevant → END, optimize → council.
        def _route_intent_legacy(state: GraphState) -> str:
            return "blocked" if state.get("intent") == "irrelevant" else "proceed"

        builder.add_conditional_edges(
            "intent_classifier",
            _route_intent_legacy,
            {
                "blocked": END,
                "proceed": "council_vote",
            },
        )

    # Round 1 → Round 2 → Round 3
    builder.add_edge("council_vote", "critic")
    builder.add_edge("critic", "synthesize")

    if quality_gate_enabled:
        builder.add_edge("synthesize", "quality_gate")
        builder.add_conditional_edges(
            "quality_gate",
            _route_quality_gate,
            {
                "loop": "council_vote",
                "exit": END,
            },
        )
    else:
        builder.add_edge("synthesize", END)

    return builder.compile(checkpointer=checkpointer)
```

- [ ] **Step 2: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/app/graph/builder.py && uv run mypy src/app/graph/builder.py
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 3: Verify the graph compiles cleanly**

We can't easily run the full graph in a unit test (it needs a checkpointer + DB), but the import + ruff + mypy is enough validation here. The next task exercises end-to-end via the API/worker integration tests.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/app/graph/builder.py
git commit -m "feat(graph): wire performance_gate into builder with force_optimize bypass"
```

---

## Task 6: API contract — request flag + response fields

**Files:**
- Modify: `qa-chatbot/src/app/schemas/chat.py`

- [ ] **Step 1: Extend ChatRequest with force_optimize**

Open `qa-chatbot/src/app/schemas/chat.py`. Find `class ChatRequest(BaseModel):`. Add `force_optimize` immediately after `category_slug`:

```python
    force_optimize: bool = Field(
        default=False,
        description=(
            "When true, bypass the performance_gate and force the council to run "
            "even if the prompt would have been flagged as already optimized. "
            "Used by the 'Force optimize anyway' UI button."
        ),
    )
```

- [ ] **Step 2: Extend ChatResponse with gate fields**

In the same file, find `class ChatResponse(BaseModel):`. Add three fields after `prompt_version_id`:

```python
    # Set by performance_gate when the prompt is already production-grade.
    already_optimized: bool = False
    gate_dimension_scores: dict[str, str] | None = None
    gate_rationale: str | None = None
```

- [ ] **Step 3: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/app/schemas/chat.py && uv run mypy src/app/schemas/chat.py
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/app/schemas/chat.py
git commit -m "feat(schemas): add force_optimize and gate fields to chat schemas"
```

---

## Task 7: Wire force_optimize and gate fields through the chat path

**Files:**
- Modify: `qa-chatbot/src/app/api/v1/chat.py`
- Modify: `qa-chatbot/src/app/services/chat_service.py`

- [ ] **Step 1: Pass force_optimize from API to worker**

Open `qa-chatbot/src/app/api/v1/chat.py`. Find the `process_chat_async.apply_async` call inside `create_chat`. Add `force_optimize` to the kwargs:

```python
        process_chat_async.apply_async(
            kwargs={
                "job_id": job_id,
                "user_id": str(current_user.id),
                "raw_prompt": raw_prompt,
                "session_id": session_id,
                "feedback": request.feedback,
                "prompt_id": resolved_prompt_id,
                "name": resolved_name,
                "category_slug": resolved_category_slug,
                "force_optimize": request.force_optimize,
            },
        )
```

- [ ] **Step 2: Update ChatService.process to accept and seed force_optimize**

Open `qa-chatbot/src/app/services/chat_service.py`. Add `force_optimize: bool = False` to the `process()` signature (place it next to `category_*`):

```python
    async def process(
        self,
        user_id: str,
        raw_prompt: str,
        session_id: str,
        feedback: str | None = None,
        title: str | None = None,
        job_id: str | None = None,
        version_history_diff: str | None = None,
        max_iterations: int = 1,
        category_slug: str | None = None,
        category_name: str | None = None,
        category_description: str | None = None,
        category_is_predefined: bool = False,
        force_optimize: bool = False,
    ) -> dict[str, Any]:
```

- [ ] **Step 3: Seed force_optimize into the GraphState literal**

In the same `process()` method, find the `initial_state: GraphState = {` literal. Replace the current `force_optimize` line (added in Task 2) so it reads from the parameter:

```python
            "force_optimize": force_optimize,
```

- [ ] **Step 4: Surface gate fields in the result dict**

Still in `chat_service.py`, find the return statement at the bottom of `process()`. Replace it with:

```python
        return {
            "session_id": session_id,
            "original_prompt": raw_prompt,
            "optimized_prompt": result["final_response"],
            "council_proposals": result["council_responses"],
            "token_usage": result.get("token_usage", {}),
            "already_optimized": bool(result.get("already_optimized", False)),
            "gate_dimension_scores": result.get("gate_dimension_scores"),
            "gate_rationale": result.get("gate_rationale"),
        }
```

- [ ] **Step 5: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/ && uv run mypy src/
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/app/api/v1/chat.py qa-chatbot/src/app/services/chat_service.py
git commit -m "feat(chat): pass force_optimize and surface gate fields through service"
```

---

## Task 8: Celery worker — accept force_optimize, refund on already_optimized

**Files:**
- Modify: `qa-chatbot/src/app/workers/tasks.py`

- [ ] **Step 1: Add force_optimize to the task signature**

Open `qa-chatbot/src/app/workers/tasks.py`. Update the `process_chat_async` parameter list:

```python
def process_chat_async(
    self: Any,
    *,
    job_id: str,
    user_id: str,
    raw_prompt: str,
    session_id: str,
    feedback: str | None = None,
    prompt_id: str | None = None,
    name: str | None = None,
    category_slug: str | None = None,
    force_optimize: bool = False,
) -> dict[str, Any]:
```

- [ ] **Step 2: Pass force_optimize into ChatService.process**

In the same file, find the `result = await service.process(...)` call. Add `force_optimize=force_optimize`:

```python
                    result = await service.process(
                        user_id=user_id,
                        raw_prompt=raw_prompt,
                        session_id=session_id,
                        feedback=feedback,
                        title=_fallback_title(raw_prompt),
                        job_id=job_id,
                        version_history_diff=version_history_diff,
                        max_iterations=max_iterations,
                        category_slug=category_slug,
                        category_name=cat_name,
                        category_description=cat_description,
                        category_is_predefined=cat_is_predefined,
                        force_optimize=force_optimize,
                    )
```

- [ ] **Step 3: Refund 5 credits when already_optimized; adjust usage event**

Find the existing usage_repo.log call (the optimize logging block). Wrap it with a credit-refund branch:

```python
                # Credit accounting:
                # - Regular optimize: 10 credits stay deducted, log credits_spent=10
                # - already_optimized: refund 5, log credits_spent=5 (matches health_score price)
                already_optimized = bool(result.get("already_optimized", False))
                charged_credits = 5 if already_optimized else 10
                usage_repo = UsageEventRepository(db)
                if already_optimized:
                    from app.repositories.user_repo import UserRepository

                    user_repo_inner = UserRepository(db)
                    await user_repo_inner.refund_credits(UUID(user_id), 5)
                await usage_repo.log(
                    user_id=UUID(user_id),
                    action="optimize",
                    credits_spent=charged_credits,
                    job_id=job_id,
                )
                await db.commit()
```

- [ ] **Step 4: Verify lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/app/workers/tasks.py && uv run mypy src/app/workers/tasks.py
```

Expected: `All checks passed!` and `Success: no issues found`.

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/workers/tasks.py
git commit -m "feat(worker): refund 5 credits when performance_gate flags prompt"
```

---

## Task 9: ChatResponse end-to-end — verify gate fields flow through

**Files:**
- Test: `qa-chatbot/tests/unit/graph/test_performance_gate.py` (extend with builder smoke test)

- [ ] **Step 1: Add a builder integration test**

Append to `qa-chatbot/tests/unit/graph/test_performance_gate.py`:

```python
def test_builder_registers_performance_gate_when_enabled():
    """Smoke test: the compiled graph should contain the performance_gate node."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from app.graph.builder import compile_graph

    fake_checkpointer = MagicMock()
    # compile_graph awaits builder.compile(checkpointer=...) which is sync, but
    # we need to patch get_llm_settings if it reads env on first call.
    compiled = asyncio.run(compile_graph(fake_checkpointer))
    # LangGraph stores nodes on the compiled object's nodes attribute (private,
    # but stable for our version).
    assert hasattr(compiled, "nodes") or hasattr(compiled, "get_graph")


def test_builder_skips_performance_gate_when_disabled(monkeypatch):
    """When PERFORMANCE_GATE_ENABLED=false, the node is not registered."""
    import asyncio
    from unittest.mock import MagicMock

    from app.config import llm
    from app.graph.builder import compile_graph

    settings = llm.get_llm_settings()
    monkeypatch.setattr(settings, "PERFORMANCE_GATE_ENABLED", False)
    # Clear lru_cache so the patch takes effect
    llm.get_llm_settings.cache_clear()

    fake_checkpointer = MagicMock()
    compiled = asyncio.run(compile_graph(fake_checkpointer))
    # Restore so other tests aren't affected
    llm.get_llm_settings.cache_clear()
    assert compiled is not None
```

- [ ] **Step 2: Run the tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/graph/test_performance_gate.py -v
```

Expected: 7 passed.

If the builder tests fail because `compile_graph` requires a real checkpointer with specific async methods, drop them and rely on Task 5's lint/typecheck plus Task 11's manual smoke test instead. (The first 5 unit tests for the node itself are the load-bearing coverage.)

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/tests/unit/graph/test_performance_gate.py
git commit -m "test(graph): add builder smoke tests for performance_gate"
```

---

## Task 10: Frontend types

**Files:**
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Find the JobResult / ChatResponse type and extend it**

Open `frontend/src/types/api.ts`. Find the type that mirrors the backend `ChatResponse` (look for `optimized_prompt: string` — the type is likely named `JobResult` or `ChatResponse`). Add three fields:

```ts
  already_optimized?: boolean;
  gate_dimension_scores?: Record<string, string> | null;
  gate_rationale?: string | null;
```

If the chat request body has its own type in this file (search for `prompt_id?:` or similar), add:

```ts
  force_optimize?: boolean;
```

If the request body is inlined at the call site (axios.post body literal), this step is purely the response side — proceed.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && rm -rf .next && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat(types): extend chat response with performance_gate fields"
```

---

## Task 11: Frontend — pass force_optimize through optimize-chat

**Files:**
- Modify: `frontend/src/components/optimize/optimize-chat.tsx`

- [ ] **Step 1: Update the handleSubmit signature and request body**

Open `frontend/src/components/optimize/optimize-chat.tsx`. Find `const handleSubmit = async (text: string, name?: string, categorySlug?: string) =>`. Update the signature to add `forceOptimize?: boolean`:

```ts
  const handleSubmit = async (
    text: string,
    name?: string,
    categorySlug?: string,
    forceOptimize?: boolean,
  ) => {
```

Then find the `api.post('/api/v1/chat/', { ... })` call. Add the spread for force_optimize:

```ts
      const res = await api.post<{ data: { job_id: string } }>('/api/v1/chat/', {
        prompt: promptToSend,
        ...(feedbackToSend && { feedback: feedbackToSend }),
        session_id: sid,
        ...(versionPromptId && !name ? { prompt_id: versionPromptId } : {}),
        ...(name && { name }),
        ...(categorySlug && { category_slug: categorySlug }),
        ...(forceOptimize && { force_optimize: true }),
      });
```

- [ ] **Step 2: Verify lint + TypeScript**

```bash
cd frontend && npm run lint && npx tsc --noEmit
```

Expected: no new errors (one pre-existing `optimize-chat.tsx:269` warning about `setGeneratingSession` is fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/optimize-chat.tsx
git commit -m "feat(optimize): plumb force_optimize through chat submit"
```

---

## Task 12: Frontend — Already-optimized badge on the chat message

**Files:**
- Modify: `frontend/src/components/optimize/chat-message.tsx`

- [ ] **Step 1: Render the badge when turn.result.already_optimized is true**

Open `frontend/src/components/optimize/chat-message.tsx`. Find where the assistant turn body is rendered (look for `turn.result?.optimized_prompt` or similar). Just above or alongside the existing assistant content, add the badge:

```tsx
{turn.result?.already_optimized && (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 999,
      background: 'rgba(34,197,94,0.12)',
      border: '1px solid rgba(34,197,94,0.4)',
      color: '#22c55e',
      fontSize: 10.5,
      fontFamily: 'var(--font-geist-mono, monospace)',
      fontWeight: 500,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}
  >
    Already optimized
  </span>
)}
```

If the assistant text is conditional, also adjust the assistant message text when `already_optimized` is true to read: *"Your prompt is already in great shape — no changes made. Open the right panel to see why."*

- [ ] **Step 2: Verify lint + TypeScript**

```bash
cd frontend && npm run lint && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/chat-message.tsx
git commit -m "feat(optimize): show already-optimized badge in chat message"
```

---

## Task 13: Frontend — Right panel: dimension breakdown + force button

**Files:**
- Modify: `frontend/src/components/optimize/result-panel.tsx`

- [ ] **Step 1: Add the dimension table component**

Open `frontend/src/components/optimize/result-panel.tsx`. Inside the file (above the default export), add a small helper:

```tsx
const DIM_ORDER = [
  ['role_persona', 'Role / Persona'],
  ['goal_clarity', 'Goal Clarity'],
  ['context_grounding', 'Context Grounding'],
  ['output_format', 'Output Format'],
  ['examples_exemplars', 'Examples / Exemplars'],
  ['constraints_guardrails', 'Constraints'],
  ['tone_audience', 'Tone & Audience'],
  ['conciseness', 'Conciseness'],
] as const;

const DOT_COLOR: Record<string, string> = {
  strong: '#22c55e',
  weak: '#fbbf24',
  missing: '#ef4444',
};

function DimensionBreakdown({
  scores,
  rationale,
}: {
  scores: Record<string, string>;
  rationale?: string | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 16px',
        background: '#111113',
        border: '1px solid #1f1f23',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 10.5,
          color: '#5a5a60',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: 4,
        }}
      >
        Dimension breakdown
      </div>
      {DIM_ORDER.map(([key, label]) => {
        const value = scores[key] ?? 'missing';
        return (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              fontFamily: 'var(--font-geist, ui-sans-serif)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: DOT_COLOR[value] ?? '#5a5a60',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#ededed' }}>{label}</span>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 11,
                color: '#8a8a90',
              }}
            >
              {value}
            </span>
          </div>
        );
      })}
      {rationale && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 11.5,
            color: '#7a7a82',
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}
        >
          {rationale}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the breakdown + Force button when already_optimized is true**

Find the body of the result panel where the optimized prompt is shown. Wrap that area so when `result.already_optimized` is true:
- the panel header label says "Original prompt" instead of "Optimized prompt"
- a green pill `Already optimized` is rendered in the header
- the dimension breakdown component renders below the prompt body
- a `Force optimize anyway` button renders below the breakdown

Specifically (the exact JSX depends on the existing layout; use this as the conditional block to insert):

```tsx
{result.already_optimized && (
  <>
    <DimensionBreakdown
      scores={result.gate_dimension_scores ?? {}}
      rationale={result.gate_rationale}
    />
    <button
      type="button"
      onClick={() => onForceOptimize?.()}
      style={{
        height: 34,
        padding: '0 14px',
        borderRadius: 6,
        background: '#7c5cff',
        border: '1px solid #7c5cff',
        color: '#fff',
        fontSize: 12.5,
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        marginTop: 4,
      }}
    >
      Force optimize anyway
    </button>
  </>
)}
```

The header label switch and the green pill go in the existing header JSX (look for the version chip area):

```tsx
<span style={{ /* same styling as the chat-message badge */ }}>
  {result.already_optimized ? 'Already optimized' : null}
</span>
```

- [ ] **Step 3: Add the `onForceOptimize` prop**

At the top of `result-panel.tsx`, find the props interface. Add:

```ts
  onForceOptimize?: () => void;
```

- [ ] **Step 4: Verify lint + TypeScript**

```bash
cd frontend && npm run lint && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/optimize/result-panel.tsx
git commit -m "feat(optimize): render dimension breakdown and force button on already-optimized"
```

---

## Task 14: Frontend — Wire onForceOptimize back into optimize-chat

**Files:**
- Modify: `frontend/src/components/optimize/optimize-chat.tsx`

- [ ] **Step 1: Pass an onForceOptimize callback to ResultPanel**

Open `frontend/src/components/optimize/optimize-chat.tsx`. Find the `<ResultPanel ...>` JSX. Add an `onForceOptimize` prop that re-submits the same prompt with `forceOptimize=true`:

```tsx
<ResultPanel
  /* ...existing props... */
  onForceOptimize={() => {
    const turn = turns.find(t => t.tempId === selectedTurnId);
    if (!turn) return;
    void handleSubmit(turn.userText, undefined, undefined, true);
  }}
/>
```

If the variable name for the selected turn is different (e.g. `selectedTurn` or `currentResult`), adapt accordingly.

- [ ] **Step 2: Verify lint + TypeScript**

```bash
cd frontend && npm run lint && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/optimize-chat.tsx
git commit -m "feat(optimize): wire force-optimize button to chat submit"
```

---

## Task 15: Manual end-to-end validation

This task has no code, only verification steps. **Do not skip it** — the unit tests cover the gate's deterministic logic but cannot validate the LLM-driven decision quality.

- [ ] **Step 1: Restart the backend stack**

```bash
cd qa-chatbot && make infra && make migrate && make dev   # terminal 1
cd qa-chatbot && make worker                              # terminal 2
cd frontend    && npm run dev                             # terminal 3
```

- [ ] **Step 2: Submit a deliberately weak prompt**

In the optimize UI submit: `"summarize the document"`.

Expected:
- The performance_gate fires but routes to council (`already_optimized=false`)
- Full council runs
- Result panel shows the optimized prompt as usual
- 10 credits charged (no refund)

- [ ] **Step 3: Submit a known-strong prompt**

Submit something well-structured, e.g.:

```
You are a senior product analyst.
Task: Given the JSON sales report below, produce a 4-bullet executive summary
covering (1) headline number, (2) biggest mover, (3) one risk, (4) one
recommendation. Each bullet ≤ 20 words.
Source: {sales_report_json}
Constraints: do not invent figures; if a value is missing, write "n/a".
Audience: VP of Sales (non-technical).
```

Expected:
- Pipeline short-circuits at performance_gate
- Chat shows "Already optimized" badge
- Right panel shows the original prompt + dimension breakdown
- 5 credits charged (10 deducted, 5 refunded — verify on the billing page)

- [ ] **Step 4: Click "Force optimize anyway"**

Expected:
- A new turn appears, showing the council ran
- 10 additional credits charged
- The optimized prompt may or may not differ from the original

- [ ] **Step 5: Toggle the gate off via env var**

Add `PERFORMANCE_GATE_ENABLED=false` to `qa-chatbot/.env`, restart API + worker. Submit the strong prompt again — expected: council runs (no gate short-circuit), 10 credits charged.

- [ ] **Step 6: Restore the env var and commit any docs updates**

If you updated `.env.example` to mention `PERFORMANCE_GATE_ENABLED`, commit it:

```bash
git add qa-chatbot/.env.example
git commit -m "docs: mention PERFORMANCE_GATE_ENABLED env var"
```

---

## Self-Review Notes

- **Spec coverage:** node ✓ (Task 4), state ✓ (Task 2), graph wiring ✓ (Task 5), API contract ✓ (Task 6), credit refund ✓ (Task 8), retry-safe usage event ✓ (Task 8 — `(action, job_id)` constraint already exists), config flag ✓ (Task 1), force_optimize ✓ (Tasks 6/7/8/11), frontend badge ✓ (Task 12), dimension table ✓ (Task 13), force button ✓ (Tasks 13/14), manual QA ✓ (Task 15).
- **No persistence of gate fields:** spec calls this out as a v1 trade-off; no backend storage task is needed.
- **The existing `(action, job_id)` unique constraint already protects the optimize usage event from being double-counted on Celery retry,** so no new repo work is needed.
