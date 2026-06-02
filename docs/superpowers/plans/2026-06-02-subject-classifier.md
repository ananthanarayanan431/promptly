# Subject Classifier Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `subject_classifier` node that runs once before `council_vote`, producing a compact "about + suggestions" analysis that threads as advisory context into the council, critic, and chairman prompts.

**Architecture:** New node sits on every path into `council_vote` (after performance_gate or intent_classifier depending on settings). Outputs two equal-length lists (≤4 points each) stored in graph state; a shared formatter builds an advisory block injected into council/critic/synthesize prompt builders as optional params. Fail-open + feature flag keep it safe.

**Tech Stack:** Python 3.11, LangGraph, LangChain (ChatOpenAI via OpenRouter), pytest + pytest-asyncio, pydantic-settings

**Spec:** `docs/superpowers/specs/2026-06-02-subject-classifier-design.md`

---

## File Map

**New files:**
- `src/app/graph/prompts/subject_classifier.py` — prompt builder + block formatter
- `src/app/graph/nodes/subject_classifier.py` — node (loop-cached model, parse, normalize, fail-open)
- `tests/unit/graph/test_subject_classifier_prompts.py` — prompt + formatter tests
- `tests/unit/graph/test_subject_classifier_node.py` — node normalization + fail-open tests

**Modified files:**
- `src/app/graph/state.py` — add `subject_about`, `subject_suggestions`
- `src/app/llm/settings.py` — add `SUBJECT_CLASSIFIER_ENABLED: bool = True`
- `src/app/llm/pipeline.py` — add `build_subject_classifier()`
- `src/app/graph/prompts/__init__.py` — export `subject_classifier_messages`, `subject_analysis_block`
- `src/app/graph/prompts/council_optimizer.py` — add `subject_block` param
- `src/app/graph/prompts/critic.py` — add `subject_block` param + template placeholder
- `src/app/graph/prompts/synthesize_best.py` — add `subject_block` param
- `src/app/graph/nodes/council_vote.py` — build block from state, pass to messages
- `src/app/graph/nodes/critic.py` — build block from state, pass to messages
- `src/app/graph/nodes/synthesize.py` — build block from state, pass to messages
- `src/app/graph/builder.py` — register node + reroute edges through it
- `src/app/services/chat_service.py` — init new state fields in both `process()` and `stream()`

---

## Task 1: Foundation — state fields, feature flag, LLM builder

**Files:**
- Modify: `src/app/graph/state.py`
- Modify: `src/app/llm/settings.py`
- Modify: `src/app/llm/pipeline.py`

No new tests for this task — these are type/config changes with no logic to test.

- [ ] **Step 1: Add state fields to `GraphState`**

In `src/app/graph/state.py`, add two fields after the `gate_rationale` line:

```python
    # Subject classifier — set before council_vote, reused across refinement loop iterations.
    # None when the classifier is disabled or failed.
    subject_about: list[str] | None
    subject_suggestions: list[str] | None
```

The full `state.py` becomes:

```python
from typing import Annotated, Any

from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class GraphState(TypedDict):
    # Input
    raw_prompt: str
    session_id: str
    user_id: str

    feedback: str | None

    category_slug: str | None
    category_name: str | None
    category_description: str | None
    category_is_predefined: bool

    version_history_diff: str | None

    job_id: str | None

    # Intent classification result: "optimize" | "irrelevant"
    intent: str | None

    # Performance gate
    force_optimize: bool
    already_optimized: bool
    gate_dimension_scores: dict[str, str] | None
    gate_rationale: str | None

    # Subject classifier — set before council_vote, reused across refinement loop iterations.
    # None when the classifier is disabled or failed.
    subject_about: list[str] | None
    subject_suggestions: list[str] | None

    # Pipeline stages
    council_responses: list[dict[str, Any]]
    critic_responses: list[dict[str, Any]]
    final_response: str
    reasoning: dict[str, Any] | None

    # Refinement loop state
    iteration_count: int
    max_iterations: int
    previous_synthesis: str | None

    # Metadata
    messages: Annotated[list[Any], add_messages]
    token_usage: dict[str, Any]
    error: str | None
```

- [ ] **Step 2: Add feature flag to `LLMSettings`**

In `src/app/llm/settings.py`, add after `PERFORMANCE_GATE_ENABLED`:

```python
    # When False, the subject_classifier node is skipped — council receives no analysis context.
    SUBJECT_CLASSIFIER_ENABLED: bool = True
```

- [ ] **Step 3: Add `build_subject_classifier` to `pipeline.py`**

In `src/app/llm/pipeline.py`, add after `build_classifier()`:

```python
def build_subject_classifier() -> ChatOpenAI:
    """Subject analysis — about + suggestions. JSON output, ~512 tokens."""
    from app.llm.settings import get_llm_settings

    return _build(
        get_llm_settings().DEFAULT_MODEL,
        temperature=0,
        max_tokens=512,
    )
```

- [ ] **Step 4: Verify ruff + mypy**

```bash
cd qa-chatbot
uv run ruff check src/app/graph/state.py src/app/llm/settings.py src/app/llm/pipeline.py
uv run mypy src/app/graph/state.py src/app/llm/settings.py src/app/llm/pipeline.py
```

Expected: `All checks passed!` and `Success: no issues found`

- [ ] **Step 5: Commit**

```bash
git add src/app/graph/state.py src/app/llm/settings.py src/app/llm/pipeline.py
git commit -m "feat(subject-classifier): add state fields, feature flag, LLM builder"
```

---

## Task 2: Prompt builder and block formatter

**Files:**
- Create: `src/app/graph/prompts/subject_classifier.py`
- Create: `tests/unit/graph/test_subject_classifier_prompts.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph/test_subject_classifier_prompts.py`:

```python
"""Tests for subject_classifier prompt builder and subject_analysis_block formatter."""

from app.graph.prompts.subject_classifier import (
    subject_analysis_block,
    subject_classifier_messages,
)


# ---------------------------------------------------------------------------
# subject_classifier_messages
# ---------------------------------------------------------------------------


def test_messages_structure_no_feedback():
    msgs = subject_classifier_messages("You are a helpful assistant.")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"
    assert msgs[1]["content"] == "You are a helpful assistant."


def test_messages_system_contains_json_instruction():
    msgs = subject_classifier_messages("some prompt")
    system = msgs[0]["content"]
    assert '"about"' in system
    assert '"suggestions"' in system
    assert "JSON" in system


def test_messages_system_contains_equal_count_rule():
    msgs = subject_classifier_messages("some prompt")
    assert "SAME number" in msgs[0]["content"]


def test_messages_without_feedback_no_feedback_label():
    msgs = subject_classifier_messages("some prompt")
    assert "feedback" not in msgs[1]["content"].lower()


def test_messages_with_feedback_injects_feedback():
    msgs = subject_classifier_messages("You are a summarizer.", "Make it more concise")
    user = msgs[1]["content"]
    assert "You are a summarizer." in user
    assert "Make it more concise" in user


def test_messages_with_feedback_has_feedback_label():
    msgs = subject_classifier_messages("prompt text", "add JSON output")
    user = msgs[1]["content"]
    assert "feedback" in user.lower() or "Feedback" in user


def test_messages_with_feedback_has_folding_rule_in_system():
    msgs = subject_classifier_messages("some prompt", "Make it shorter")
    system = msgs[0]["content"]
    assert "FIRST" in system or "first" in system


# ---------------------------------------------------------------------------
# subject_analysis_block
# ---------------------------------------------------------------------------


def test_block_returns_none_for_none_inputs():
    assert subject_analysis_block(None, None) is None


def test_block_returns_none_for_empty_lists():
    assert subject_analysis_block([], []) is None


def test_block_returns_none_when_about_empty():
    assert subject_analysis_block([], ["suggestion"]) is None


def test_block_returns_none_when_suggestions_empty():
    assert subject_analysis_block(["about"], []) is None


def test_block_contains_about_points():
    result = subject_analysis_block(["It handles data extraction."], ["Add output format."])
    assert result is not None
    assert "It handles data extraction." in result


def test_block_contains_suggestion_points():
    result = subject_analysis_block(["Data extraction prompt."], ["Add a JSON schema."])
    assert result is not None
    assert "Add a JSON schema." in result


def test_block_contains_advisory_label():
    result = subject_analysis_block(["About point."], ["Suggestion point."])
    assert result is not None
    assert "advisory" in result.lower() or "ADVISORY" in result


def test_block_uses_bullet_format():
    result = subject_analysis_block(["Point A.", "Point B."], ["Sug A.", "Sug B."])
    assert result is not None
    assert "- Point A." in result
    assert "- Point B." in result
    assert "- Sug A." in result
    assert "- Sug B." in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/unit/graph/test_subject_classifier_prompts.py -v 2>&1 | head -20
```

Expected: `ImportError` — module doesn't exist yet.

- [ ] **Step 3: Implement `subject_classifier.py`**

Create `src/app/graph/prompts/subject_classifier.py`:

```python
_SYSTEM = """\
You are a prompt analysis expert. Analyze the AI prompt you receive and return a JSON object
with exactly two sections: what the prompt is about, and how it can be enhanced.

<rules>
1. Both sections MUST have the SAME number of points.
2. Each section has BETWEEN 1 and 4 points — pick the count that fits the prompt complexity.
   Do not pad to reach 4. Do not exceed 4.
3. Each point is ONE short, specific sentence. No vague generalities. No padding.
4. Write for an expert who will use your analysis to optimize the prompt.
</rules>

<feedback_rule>
If user feedback is provided below the prompt, it MUST become the FIRST point in
"suggestions", rephrased as a specific enhancement directive. Fill remaining suggestion
points (to match the "about" count) with other genuine improvement opportunities.
If feedback alone fills the needed count, do not add more suggestions.
</feedback_rule>

<output_format>
Return ONLY valid JSON. No preamble, no markdown fences, no trailing text.
The first character of your output must be "{".

{
  "about": ["<what this prompt is about / its purpose — one sentence>", "..."],
  "suggestions": ["<specific, actionable enhancement — one sentence>", "..."]
}
</output_format>
"""

_USER = "{{raw_prompt}}"
_USER_WITH_FEEDBACK = "{{raw_prompt}}\n\n---\nUser feedback: {{feedback}}"


def subject_classifier_messages(
    raw_prompt: str, feedback: str | None = None
) -> list[dict[str, str]]:
    """Build subject classifier messages.

    On feedback turns, the feedback is appended so the model folds it
    into the first suggestion point (per the feedback_rule in the system prompt).
    """
    if feedback:
        user = (
            _USER_WITH_FEEDBACK.replace("{{raw_prompt}}", raw_prompt).replace(
                "{{feedback}}", feedback
            )
        )
    else:
        user = _USER.replace("{{raw_prompt}}", raw_prompt)
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


def subject_analysis_block(
    about: list[str] | None,
    suggestions: list[str] | None,
) -> str | None:
    """Format the analysis as an advisory context block for downstream prompts.

    Returns None when there is no analysis to inject, so callers can skip cleanly.
    """
    if not about or not suggestions:
        return None
    about_lines = "\n".join(f"- {p}" for p in about)
    suggestion_lines = "\n".join(f"- {p}" for p in suggestions)
    return (
        "PROMPT ANALYSIS (advisory context — consider these insights, but user feedback\n"
        "and quality gaps remain the overriding directives):\n"
        f"What this prompt is about:\n{about_lines}\n"
        f"Suggested enhancements to consider:\n{suggestion_lines}"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/unit/graph/test_subject_classifier_prompts.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Ruff + mypy**

```bash
uv run ruff check src/app/graph/prompts/subject_classifier.py
uv run mypy src/app/graph/prompts/subject_classifier.py
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/graph/prompts/subject_classifier.py tests/unit/graph/test_subject_classifier_prompts.py
git commit -m "feat(subject-classifier): prompt builder and block formatter with tests"
```

---

## Task 3: Subject classifier node

**Files:**
- Create: `src/app/graph/nodes/subject_classifier.py`
- Create: `tests/unit/graph/test_subject_classifier_node.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph/test_subject_classifier_node.py`:

```python
"""Tests for subject_classifier node: normalization logic and fail-open behavior."""

import copy
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graph.nodes.subject_classifier import _normalize, subject_classifier_node

# ---------------------------------------------------------------------------
# Base state — mirrors the pattern in test_performance_gate.py
# ---------------------------------------------------------------------------

_BASE_STATE: dict[str, Any] = {
    "raw_prompt": "You are a helpful assistant. Summarize the document provided.",
    "session_id": "s1",
    "user_id": "u1",
    "feedback": None,
    "category_slug": None,
    "category_name": None,
    "category_description": None,
    "category_is_predefined": False,
    "version_history_diff": None,
    "job_id": None,
    "intent": "optimize",
    "force_optimize": False,
    "already_optimized": False,
    "gate_dimension_scores": None,
    "gate_rationale": None,
    "subject_about": None,
    "subject_suggestions": None,
    "council_responses": [],
    "critic_responses": [],
    "final_response": "",
    "messages": [],
    "token_usage": {},
    "error": None,
    "iteration_count": 0,
    "max_iterations": 1,
    "previous_synthesis": None,
    "reasoning": None,
}


def _llm_response(payload: dict[str, Any]) -> MagicMock:
    m = MagicMock()
    m.content = json.dumps(payload)
    return m


# ---------------------------------------------------------------------------
# _normalize unit tests
# ---------------------------------------------------------------------------


def test_normalize_equal_valid_lists():
    about, suggestions = _normalize(["A.", "B."], ["X.", "Y."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_truncates_longer_list_to_shorter():
    about, suggestions = _normalize(["A.", "B.", "C."], ["X.", "Y."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_truncates_suggestions_when_shorter():
    about, suggestions = _normalize(["A.", "B."], ["X.", "Y.", "Z."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_caps_at_4():
    long = ["A.", "B.", "C.", "D.", "E."]
    about, suggestions = _normalize(long, long)
    assert about == ["A.", "B.", "C.", "D."]
    assert suggestions == ["A.", "B.", "C.", "D."]


def test_normalize_caps_then_equalizes():
    # about=5 items (capped to 4), suggestions=3 items → result is 3 each
    about, suggestions = _normalize(
        ["A.", "B.", "C.", "D.", "E."],
        ["X.", "Y.", "Z."],
    )
    assert len(about) == 3
    assert len(suggestions) == 3


def test_normalize_strips_whitespace():
    about, suggestions = _normalize(["  A.  "], ["  X.  "])
    assert about == ["A."]
    assert suggestions == ["X."]


def test_normalize_skips_empty_strings():
    about, suggestions = _normalize(["A.", "", "B."], ["X.", "", "Y."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_returns_none_when_either_empty():
    assert _normalize([], ["X."]) == (None, None)
    assert _normalize(["A."], []) == (None, None)
    assert _normalize([], []) == (None, None)


def test_normalize_returns_none_for_non_list_input():
    assert _normalize(None, None) == (None, None)
    assert _normalize("bad", ["X."]) == (None, None)
    assert _normalize(["A."], 42) == (None, None)


# ---------------------------------------------------------------------------
# subject_classifier_node integration tests (LLM mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_node_returns_about_and_suggestions_on_success():
    payload = {
        "about": ["It summarizes documents.", "It targets a general audience."],
        "suggestions": ["Add a word-count constraint.", "Specify the output format."],
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("app.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] == ["It summarizes documents.", "It targets a general audience."]
    assert result["subject_suggestions"] == ["Add a word-count constraint.", "Specify the output format."]


@pytest.mark.asyncio
async def test_node_normalizes_unequal_counts():
    payload = {
        "about": ["A.", "B.", "C."],
        "suggestions": ["X.", "Y."],
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("app.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is not None
    assert result["subject_suggestions"] is not None
    assert len(result["subject_about"]) == len(result["subject_suggestions"])


@pytest.mark.asyncio
async def test_node_fail_open_on_invalid_json():
    mock_model = AsyncMock()
    bad = MagicMock()
    bad.content = "not json at all"
    mock_model.ainvoke = AsyncMock(return_value=bad)

    with patch("app.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is None
    assert result["subject_suggestions"] is None


@pytest.mark.asyncio
async def test_node_fail_open_on_llm_exception():
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("network error"))

    with patch("app.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is None
    assert result["subject_suggestions"] is None


@pytest.mark.asyncio
async def test_node_fail_open_when_lists_empty_after_normalize():
    payload = {"about": [], "suggestions": []}
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("app.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is None
    assert result["subject_suggestions"] is None


@pytest.mark.asyncio
async def test_node_passes_feedback_to_messages():
    """Node forwards state feedback to the prompt builder."""
    state_with_feedback = {**_BASE_STATE, "feedback": "Make it more concise"}
    payload = {"about": ["A document summarizer."], "suggestions": ["Make it more concise per user feedback."]}
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("app.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        with patch("app.graph.nodes.subject_classifier.subject_classifier_messages") as mock_msgs:
            mock_msgs.return_value = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
            await subject_classifier_node(state_with_feedback)  # type: ignore[arg-type]

    mock_msgs.assert_called_once_with(
        "You are a helpful assistant. Summarize the document provided.",
        "Make it more concise",
    )
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/unit/graph/test_subject_classifier_node.py -v 2>&1 | head -20
```

Expected: `ImportError` — module doesn't exist yet.

- [ ] **Step 3: Implement the node**

Create `src/app/graph/nodes/subject_classifier.py`:

```python
"""
Subject Classifier node — runs between performance_gate/intent_classifier and council_vote.

Produces a compact two-section analysis of the input prompt:
  - subject_about:       ≤4 points on what the prompt is about
  - subject_suggestions: equal count of enhancement suggestions

On feedback turns, state["feedback"] is passed to the prompt builder, which folds
the feedback into the first suggestion point (see prompts/subject_classifier.py).

Fail-open: any LLM error or parse failure → both fields None, pipeline continues.
The quality-gate refinement loop re-enters at council_vote, so this node does NOT
re-run on refinement iterations — it runs once per user turn.
"""

import asyncio
import json
import time
from typing import Any

from app.core.cache import push_job_progress
from app.graph.prompts.subject_classifier import subject_classifier_messages
from app.graph.state import GraphState
from app.llm import LLMClient
from app.llm.pipeline import build_subject_classifier
from app.utils.log import get_logger

log = get_logger(__name__)

_loop_id: int | None = None
_model: LLMClient | None = None


def _get_model() -> LLMClient:
    """LLMClient binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _model
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _model is None:
        _loop_id = lid
        _model = build_subject_classifier()
    m = _model
    if m is None:
        raise RuntimeError("subject classifier model failed to initialise")
    return m


def _parse_response(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        inner = text.split("```")[1]
        if inner.startswith("json"):
            inner = inner[4:]
        text = inner.strip()
    result: dict[str, Any] = json.loads(text)
    return result


def _normalize(
    about_raw: Any,  # noqa: ANN401
    suggestions_raw: Any,  # noqa: ANN401
) -> tuple[list[str] | None, list[str] | None]:
    """Coerce, cap at 4, truncate both to equal length."""

    def coerce(lst: Any) -> list[str]:  # noqa: ANN401
        if not isinstance(lst, list):
            return []
        return [s.strip() for s in lst if isinstance(s, str) and s.strip()][:4]

    about = coerce(about_raw)
    suggestions = coerce(suggestions_raw)
    n = min(len(about), len(suggestions))
    if n == 0:
        return None, None
    return about[:n], suggestions[:n]


async def subject_classifier_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Subject Classifier.

    Returns partial state with subject_about and subject_suggestions populated,
    or both None on any failure (fail-open: a broken analysis must never block optimization).
    """
    raw = state.get("raw_prompt", "").strip()
    feedback = state.get("feedback")
    job_id = state.get("job_id")

    try:
        response = await _get_model().ainvoke(subject_classifier_messages(raw, feedback))
        parsed = _parse_response(str(response.content))
        about, suggestions = _normalize(parsed.get("about"), parsed.get("suggestions"))
    except Exception:
        log.warning("subject_classifier_failed", prompt_length=len(raw))
        return {"subject_about": None, "subject_suggestions": None}

    if job_id:
        await push_job_progress(job_id, {"step": "subject", "ts": time.time()})

    log.info(
        "subject_classified",
        about_count=len(about) if about else 0,
        suggestions_count=len(suggestions) if suggestions else 0,
    )
    return {"subject_about": about, "subject_suggestions": suggestions}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/unit/graph/test_subject_classifier_node.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Ruff + mypy**

```bash
uv run ruff check src/app/graph/nodes/subject_classifier.py
uv run mypy src/app/graph/nodes/subject_classifier.py
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/graph/nodes/subject_classifier.py tests/unit/graph/test_subject_classifier_node.py
git commit -m "feat(subject-classifier): node with normalization, fail-open, and tests"
```

---

## Task 4: Export from prompts `__init__` + update downstream prompt builders

**Files:**
- Modify: `src/app/graph/prompts/__init__.py`
- Modify: `src/app/graph/prompts/council_optimizer.py`
- Modify: `src/app/graph/prompts/critic.py`
- Modify: `src/app/graph/prompts/synthesize_best.py`
- Modify: `tests/unit/graph/test_prompts.py` (add new tests for subject_block param)

- [ ] **Step 1: Write failing tests for the new `subject_block` params**

Add the following to the end of `tests/unit/graph/test_prompts.py`:

```python
from app.graph.prompts.subject_classifier import subject_analysis_block


def test_council_optimizer_with_subject_block():
    block = subject_analysis_block(["Data extraction prompt."], ["Add JSON schema."])
    msgs = council_optimizer_messages("My prompt.", None, subject_block=block)
    assert block is not None
    assert block in msgs[1]["content"]


def test_council_optimizer_subject_block_before_feedback():
    block = subject_analysis_block(["About."], ["Suggestion."])
    msgs = council_optimizer_messages("My prompt.", "Make shorter", subject_block=block)
    user = msgs[1]["content"]
    assert block is not None
    assert user.index(block) < user.index("Make shorter")


def test_council_optimizer_without_subject_block_unchanged():
    msgs_with = council_optimizer_messages("My prompt.", None, subject_block=None)
    msgs_without = council_optimizer_messages("My prompt.", None)
    assert msgs_with[1]["content"] == msgs_without[1]["content"]


def test_critic_messages_with_subject_block():
    block = subject_analysis_block(["A data extraction prompt."], ["Specify output format."])
    msgs = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB"), ("C", "CCC")],
        subject_block=block,
    )
    assert block is not None
    assert block in msgs[1]["content"]


def test_critic_messages_without_subject_block_unchanged():
    msgs_with = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB")],
        subject_block=None,
    )
    msgs_without = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB")],
    )
    assert msgs_with[1]["content"] == msgs_without[1]["content"]


def test_synthesize_messages_with_subject_block():
    from app.graph.prompts.synthesize_best import synthesize_messages

    block = subject_analysis_block(["A code review prompt."], ["Add severity levels."])
    msgs = synthesize_messages(
        raw_prompt="Review my code.",
        proposals_block="[Proposal A]:\nProposal text",
        critiques_block="[Critic A]\nRanking: A\nRationale: Good.",
        feedback=None,
        subject_block=block,
    )
    assert block is not None
    assert block in msgs[1]["content"]


def test_synthesize_messages_subject_block_before_feedback():
    from app.graph.prompts.synthesize_best import synthesize_messages

    block = subject_analysis_block(["About."], ["Suggestion."])
    msgs = synthesize_messages(
        raw_prompt="Review my code.",
        proposals_block="[Proposal A]:\ntext",
        critiques_block="[Critic A]\nRanking: A\nRationale: ok.",
        feedback="Keep it under 50 words",
        subject_block=block,
    )
    user = msgs[1]["content"]
    assert block is not None
    assert user.index(block) < user.index("Keep it under 50 words")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/unit/graph/test_prompts.py -v -k "subject" 2>&1 | head -20
```

Expected: `TypeError` — `subject_block` param not accepted yet.

- [ ] **Step 3: Update `prompts/__init__.py`**

Replace the contents of `src/app/graph/prompts/__init__.py`:

```python
from app.graph.prompts.category_guidance import category_guidance_block
from app.graph.prompts.council_optimizer import council_optimizer_messages
from app.graph.prompts.critic import critic_messages
from app.graph.prompts.favorite_auto_tag import favorite_auto_tag_messages
from app.graph.prompts.intent_classifier import intent_classifier_messages
from app.graph.prompts.performance_gate import performance_gate_messages
from app.graph.prompts.prompt_advisory import prompt_advisory_messages
from app.graph.prompts.prompt_health_score import prompt_health_score_messages
from app.graph.prompts.reasoning import reasoning_messages
from app.graph.prompts.subject_classifier import subject_analysis_block, subject_classifier_messages
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
    "reasoning_messages",
    "subject_analysis_block",
    "subject_classifier_messages",
    "synthesize_messages",
]
```

- [ ] **Step 4: Update `council_optimizer.py`**

In `src/app/graph/prompts/council_optimizer.py`, update `council_optimizer_messages` to accept and inject `subject_block`. Add `subject_block: str | None = None` to the signature, and insert it **after `previous_synthesis` and before `quality_gaps`**:

```python
def council_optimizer_messages(
    raw_prompt: str,
    feedback: str | None,
    version_history_diff: str | None = None,
    previous_synthesis: str | None = None,
    quality_gaps: list[str] | None = None,
    category_block: str | None = None,
    subject_block: str | None = None,
) -> list[dict[str, str]]:
    """
    Build council optimizer messages.

    subject_block: advisory context from the subject_classifier — inserted before
        quality_gaps and feedback so those remain the dominant directives.
    version_history_diff: diff summary of prior versions in this family.
    previous_synthesis: the last iteration's output — present on refinement passes.
    quality_gaps: dimensions flagged as still weak/missing by the critic.
    category_block: optional category-conditioning text appended to the system prompt.
    """
    parts: list[str] = [raw_prompt]

    if version_history_diff:
        parts.append(
            "---\n"
            "VERSION HISTORY (prior iterations of this prompt family — do not regress these gains):\n"
            + version_history_diff
        )

    if previous_synthesis:
        parts.append(
            "---\n"
            "PREVIOUS SYNTHESIS (last refinement pass — your output must be measurably better):\n"
            + previous_synthesis
        )

    if subject_block:
        parts.append("---\n" + subject_block)

    if quality_gaps:
        gaps_text = "\n".join(f"- {g}" for g in quality_gaps)
        parts.append(
            "---\n"
            "QUALITY GAPS TO RESOLVE (flagged as still weak/missing by peer reviewers — "
            "address ALL of these explicitly in your optimization):\n" + gaps_text
        )

    if feedback:
        parts.append(
            "---\n"
            "Optimization Feedback "
            "(high-priority directive — overrides general heuristics if needed):\n" + feedback
        )

    user = "\n\n".join(parts)
    system = _SYSTEM if not category_block else f"{_SYSTEM}\n\n{category_block}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
```

- [ ] **Step 5: Update `critic.py` (prompts)**

In `src/app/graph/prompts/critic.py`:

1. Add `{{subject_block}}` to `_USER_TEMPLATE` between `{{raw_prompt}}` and `{{feedback_block}}`:

```python
_USER_TEMPLATE = """\
ORIGINAL PROMPT:
{{raw_prompt}}

{{subject_block}}{{feedback_block}}{{previous_synthesis_block}}\
---

{{proposals_block}}
---

Review all {{proposal_count}} proposals against the original prompt, the 8-dimension quality \
rubric, and any context above. Return your critique as a valid JSON object. \
No output outside the JSON object.\
"""
```

2. Add `subject_block: str | None = None` to `critic_messages` signature and inject it in the `.replace()` chain:

```python
def critic_messages(
    raw_prompt: str,
    proposals: list[tuple[str, str]],
    feedback: str | None = None,
    previous_synthesis: str | None = None,
    subject_block: str | None = None,
) -> list[dict[str, str]]:
    """
    Build critic review messages for N proposals.

    subject_block: advisory context from subject_classifier injected before feedback
        so it informs reviewers without overriding directives.
    proposals: list of (label, text) tuples — e.g. [("A", "..."), ("B", "...")]
    """
    labels = [label for label, _ in proposals]
    label_str = ", ".join(labels)
    count = len(labels)

    proposals_block = "\n\n---\n\n".join(f"Proposal {label}:\n{text}" for label, text in proposals)

    schema = _build_output_schema(labels)
    system = (
        _SYSTEM_TEMPLATE.replace("{{proposal_count}}", str(count))
        .replace("{{proposal_labels}}", label_str)
        .replace("{{output_schema_block}}", schema)
    )

    subject_section = f"{subject_block}\n\n" if subject_block else ""
    feedback_block = (
        f"USER FEEDBACK (highest-priority directive — proposals must honour this):\n{feedback}\n\n"
        if feedback
        else ""
    )
    previous_synthesis_block = (
        f"PREVIOUS SYNTHESIS (already-locked improvements — do not regress these):\n"
        f"{previous_synthesis}\n\n"
        if previous_synthesis
        else ""
    )
    user = (
        _USER_TEMPLATE.replace("{{raw_prompt}}", raw_prompt)
        .replace("{{subject_block}}", subject_section)
        .replace("{{feedback_block}}", feedback_block)
        .replace("{{previous_synthesis_block}}", previous_synthesis_block)
        .replace("{{proposals_block}}", proposals_block)
        .replace("{{proposal_count}}", str(count))
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
```

- [ ] **Step 6: Update `synthesize_best.py`**

In `src/app/graph/prompts/synthesize_best.py`, add a `_SUBJECT_BLOCK_SECTION` constant and update `synthesize_messages`. Add `subject_block: str | None = None` to the signature, inserting it **after the critiques block and before quality_gaps/feedback**:

```python
_SUBJECT_BLOCK_SECTION = "\n\n---\n\n{{subject_block}}"
```

Update `synthesize_messages`:

```python
def synthesize_messages(
    raw_prompt: str,
    proposals_block: str,
    critiques_block: str,
    feedback: str | None,
    previous_synthesis: str | None = None,
    quality_gaps: list[str] | None = None,
    category_block: str | None = None,
    subject_block: str | None = None,
) -> list[dict[str, str]]:
    user = (
        _USER.replace("{{raw_prompt}}", raw_prompt)
        .replace("{{proposals_block}}", proposals_block)
        .replace("{{critiques_block}}", critiques_block)
    )
    if subject_block:
        user += _SUBJECT_BLOCK_SECTION.replace("{{subject_block}}", subject_block)
    if previous_synthesis:
        user += _PREVIOUS_SYNTHESIS_BLOCK.replace("{{previous_synthesis}}", previous_synthesis)
    if quality_gaps:
        gaps_text = "\n".join(f"- {g}" for g in quality_gaps)
        user += _QUALITY_GAPS_BLOCK.replace("{{quality_gaps}}", gaps_text)
    if feedback:
        user += _FEEDBACK_SUFFIX.replace("{{feedback}}", feedback)
    system = _SYSTEM if not category_block else f"{_SYSTEM}\n\n{category_block}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
```

- [ ] **Step 7: Run all prompt tests**

```bash
uv run pytest tests/unit/graph/test_prompts.py -v
```

Expected: all tests pass (including the new `subject_block` tests).

- [ ] **Step 8: Ruff + mypy on modified prompt files**

```bash
uv run ruff check src/app/graph/prompts/
uv run mypy src/app/graph/prompts/
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add \
  src/app/graph/prompts/__init__.py \
  src/app/graph/prompts/council_optimizer.py \
  src/app/graph/prompts/critic.py \
  src/app/graph/prompts/synthesize_best.py \
  tests/unit/graph/test_prompts.py
git commit -m "feat(subject-classifier): thread subject_block through council/critic/synthesize prompt builders"
```

---

## Task 5: Update downstream nodes to build and pass `subject_block`

**Files:**
- Modify: `src/app/graph/nodes/council_vote.py`
- Modify: `src/app/graph/nodes/critic.py`
- Modify: `src/app/graph/nodes/synthesize.py`

These nodes just read the two new state fields and pass the formatted block to the message builders — no new tests needed (the prompt builder tests in Task 4 cover the block; the node logic is trivial).

- [ ] **Step 1: Update `council_vote.py`**

In `src/app/graph/nodes/council_vote.py`:

1. Change the import line for prompts:

```python
from app.graph.prompts import category_guidance_block, council_optimizer_messages, subject_analysis_block
```

2. In `council_vote_node`, build the block before the `async def optimize` inner function:

```python
async def council_vote_node(state: GraphState) -> dict[str, Any]:
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    version_history_diff = state.get("version_history_diff")
    previous_synthesis = state.get("previous_synthesis")
    iteration = state.get("iteration_count", 0)
    job_id = state.get("job_id")

    category_block = category_guidance_block(
        category_slug=state.get("category_slug"),
        category_name=state.get("category_name"),
        category_description=state.get("category_description"),
        is_predefined=state.get("category_is_predefined", False),
    )

    subject_block = subject_analysis_block(
        state.get("subject_about"),
        state.get("subject_suggestions"),
    )

    quality_gaps = _extract_quality_gaps(state) if iteration > 0 else []

    models = _get_council_models()
    total = len(models)
    done_count = [0]
    lock = asyncio.Lock()

    async def optimize(model: LLMClient) -> dict[str, Any]:
        messages = council_optimizer_messages(
            raw_prompt=raw_prompt,
            feedback=feedback,
            version_history_diff=version_history_diff,
            previous_synthesis=previous_synthesis if iteration > 0 else None,
            quality_gaps=quality_gaps if quality_gaps else None,
            category_block=category_block,
            subject_block=subject_block,
        )
        # ... rest of function unchanged
```

The full updated `council_vote.py` (only the changed sections — keep all other code as-is):

```python
from app.graph.prompts import category_guidance_block, council_optimizer_messages, subject_analysis_block
```

And in `optimize()` inner function, add `subject_block=subject_block` to the `council_optimizer_messages` call.

- [ ] **Step 2: Update `critic.py` (node)**

In `src/app/graph/nodes/critic.py`:

1. Change import:

```python
from app.graph.prompts import critic_messages, subject_analysis_block
```

2. In `critic_node`, build the block before the `async def critique` inner function:

```python
async def critic_node(state: GraphState) -> dict[str, Any]:
    proposals = state["council_responses"]
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    previous_synthesis = state.get("previous_synthesis")

    subject_block = subject_analysis_block(
        state.get("subject_about"),
        state.get("subject_suggestions"),
    )

    # ... existing early-exit check unchanged ...

    async def critique(model: LLMClient, reviewer_idx: int) -> dict[str, Any]:
        others = [...]
        messages = critic_messages(
            raw_prompt=raw_prompt,
            proposals=others,
            feedback=feedback,
            previous_synthesis=previous_synthesis,
            subject_block=subject_block,
        )
        # ... rest unchanged
```

- [ ] **Step 3: Update `synthesize.py` (node)**

In `src/app/graph/nodes/synthesize.py`:

1. Change import:

```python
from app.graph.prompts import category_guidance_block, reasoning_messages, synthesize_messages, subject_analysis_block
```

2. In `synthesize_node`, build the block before the `ainvoke` call:

```python
    subject_block = subject_analysis_block(
        state.get("subject_about"),
        state.get("subject_suggestions"),
    )

    response = await _get_synthesizer().ainvoke(
        synthesize_messages(
            raw_prompt=state["raw_prompt"],
            proposals_block=proposals_block,
            critiques_block=critiques_block,
            feedback=state.get("feedback"),
            previous_synthesis=state.get("previous_synthesis"),
            quality_gaps=quality_gaps if quality_gaps else None,
            category_block=category_block,
            subject_block=subject_block,
        )
    )
```

- [ ] **Step 4: Ruff + mypy on all three node files**

```bash
uv run ruff check src/app/graph/nodes/council_vote.py src/app/graph/nodes/critic.py src/app/graph/nodes/synthesize.py
uv run mypy src/app/graph/nodes/council_vote.py src/app/graph/nodes/critic.py src/app/graph/nodes/synthesize.py
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add \
  src/app/graph/nodes/council_vote.py \
  src/app/graph/nodes/critic.py \
  src/app/graph/nodes/synthesize.py
git commit -m "feat(subject-classifier): pass subject_block through council, critic, synthesize nodes"
```

---

## Task 6: Graph builder rewiring + state initialization

**Files:**
- Modify: `src/app/graph/builder.py`
- Modify: `src/app/services/chat_service.py`

- [ ] **Step 1: Update `builder.py`**

In `src/app/graph/builder.py`:

1. Add import at top of import block:

```python
from app.graph.nodes.subject_classifier import subject_classifier_node
```

2. Replace the `compile_graph` function body — the key change is that paths into `council_vote` now route through `subject_classifier` when the flag is enabled:

```python
async def compile_graph(checkpointer: AsyncPostgresSaver) -> Any:  # noqa: ANN401
    builder = StateGraph(GraphState)

    settings = get_llm_settings()
    quality_gate_enabled = settings.QUALITY_GATE_ENABLED
    performance_gate_enabled = settings.PERFORMANCE_GATE_ENABLED
    subject_classifier_enabled = settings.SUBJECT_CLASSIFIER_ENABLED

    builder.add_node("intent_classifier", intent_classifier_node)
    builder.add_node("council_vote", council_vote_node)
    builder.add_node("critic", critic_node)
    builder.add_node("synthesize", synthesize_node)
    if performance_gate_enabled:
        builder.add_node("performance_gate", performance_gate_node)
    if quality_gate_enabled:
        builder.add_node("quality_gate", quality_gate_node)
    if subject_classifier_enabled:
        builder.add_node("subject_classifier", subject_classifier_node)

    # Entry point
    builder.set_entry_point("intent_classifier")

    # The first node after intent/gate decisions — either subject_classifier or council_vote
    # depending on the feature flag.
    council_entry = "subject_classifier" if subject_classifier_enabled else "council_vote"

    if performance_gate_enabled:
        builder.add_conditional_edges(
            "intent_classifier",
            _route_intent,
            {
                "blocked": END,
                "gate": "performance_gate",
                "skip_gate": council_entry,
            },
        )
        builder.add_conditional_edges(
            "performance_gate",
            _route_performance_gate,
            {
                "exit": END,
                "proceed": council_entry,
            },
        )
    else:
        builder.add_conditional_edges(
            "intent_classifier",
            _route_intent,
            {
                "blocked": END,
                "proceed": council_entry,
            },
        )

    if subject_classifier_enabled:
        builder.add_edge("subject_classifier", "council_vote")

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

    graph = builder.compile(checkpointer=checkpointer)
    log.info(
        "graph_compiled",
        performance_gate=performance_gate_enabled,
        quality_gate=quality_gate_enabled,
        subject_classifier=subject_classifier_enabled,
    )
    return graph
```

- [ ] **Step 2: Update state initialization in `chat_service.py`**

In `src/app/services/chat_service.py`, add `subject_about` and `subject_suggestions` to **both** `GraphState` dicts — the one in `process()` (around line 46) and the one in `stream()` (around line 127).

In `process()`, add after `"reasoning": None,`:

```python
            "subject_about": None,
            "subject_suggestions": None,
```

In `stream()`, add after `"reasoning": None,`:

```python
            "subject_about": None,
            "subject_suggestions": None,
```

- [ ] **Step 3: Ruff + mypy**

```bash
uv run ruff check src/app/graph/builder.py src/app/services/chat_service.py
uv run mypy src/app/graph/builder.py src/app/services/chat_service.py
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/graph/builder.py src/app/services/chat_service.py
git commit -m "feat(subject-classifier): wire node into graph and initialize state fields"
```

---

## Task 7: Full test suite verification

- [ ] **Step 1: Run all unit tests**

```bash
cd qa-chatbot
uv run pytest tests/unit/ -v --tb=short 2>&1 | tail -30
```

Expected: all existing tests pass + the new `test_subject_classifier_prompts.py` and `test_subject_classifier_node.py` tests pass. Zero regressions.

- [ ] **Step 2: Full lint + type check**

```bash
uv run ruff check src/
uv run mypy src/
```

Expected: only the two pre-existing errors in `main.py` and `tests/unit/test_clerk_core.py` (unchanged from before this feature). No new errors.

- [ ] **Step 3: Quick smoke-test the graph compiles**

```bash
uv run python - <<'PY'
import asyncio, sys, os
sys.path.insert(0, "src")

async def main():
    from app.graph.checkpointer import get_checkpointer_pool
    from app.graph.builder import compile_graph
    from unittest.mock import AsyncMock, MagicMock
    checkpointer = MagicMock()
    checkpointer.__aenter__ = AsyncMock(return_value=checkpointer)
    checkpointer.__aexit__ = AsyncMock(return_value=None)
    graph = await compile_graph(checkpointer)
    print("Graph compiled OK, nodes:", list(graph.nodes.keys()))

asyncio.run(main())
PY
```

Expected output contains: `subject_classifier` in the nodes list.

- [ ] **Step 4: Verify flag-off behavior**

```bash
uv run python - <<'PY'
import asyncio, sys
sys.path.insert(0, "src")

async def main():
    from unittest.mock import AsyncMock, MagicMock, patch
    with patch.dict("os.environ", {"SUBJECT_CLASSIFIER_ENABLED": "false"}):
        import importlib, app.llm.settings as s
        s.get_llm_settings.cache_clear()
        from app.graph.builder import compile_graph
        checkpointer = MagicMock()
        checkpointer.__aenter__ = AsyncMock(return_value=checkpointer)
        checkpointer.__aexit__ = AsyncMock(return_value=None)
        graph = await compile_graph(checkpointer)
        node_names = list(graph.nodes.keys())
        assert "subject_classifier" not in node_names, f"Expected no subject_classifier, got: {node_names}"
        print("Flag-off OK — subject_classifier absent:", node_names)
        s.get_llm_settings.cache_clear()

asyncio.run(main())
PY
```

Expected: prints `Flag-off OK` with no `subject_classifier` in the node list.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(subject-classifier): complete — analysis node wired into optimization pipeline

Adds subject_classifier node that produces a compact about+suggestions analysis
before council_vote. Analysis is advisory context in council/critic/chairman prompts.
Fail-open, flag-gated (SUBJECT_CLASSIFIER_ENABLED), feedback-aware."
```
