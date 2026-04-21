# Unified Council Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four per-strategy council system prompts with a single unified prompt that all models receive in Round 1, then remove the dead strategy files and the code that selected between them.

**Architecture:** `council_vote.py` currently loads 4 strategy prompts and passes a different one to each model by index. After this change, all models receive the same `council_optimizer.md` prompt. The critic and synthesize nodes are unchanged. The four old `council_optimizer_*.md` files are deleted.

**Tech Stack:** Python 3.12, LangGraph, LangChain OpenAI, pytest

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Create | `qa-chatbot/prompts/council_optimizer.md` | New unified prompt (all 4 lenses, non-repetitive) |
| Modify | `qa-chatbot/src/app/graph/nodes/council_vote.py` | Remove `_STRATEGY_PROMPTS`, `_get_strategy()`; add single `_COUNCIL_PROMPT` |
| Delete | `qa-chatbot/prompts/council_optimizer_analytical.md` | Replaced by unified prompt |
| Delete | `qa-chatbot/prompts/council_optimizer_creative.md` | Replaced by unified prompt |
| Delete | `qa-chatbot/prompts/council_optimizer_concise.md` | Replaced by unified prompt |
| Delete | `qa-chatbot/prompts/council_optimizer_structured.md` | Replaced by unified prompt |
| Modify | `qa-chatbot/tests/unit/graph/test_nodes.py` | Update council_vote tests |

---

## Task 1: Write the unified council optimizer prompt

**Files:**
- Create: `qa-chatbot/prompts/council_optimizer.md`

- [ ] **Step 1: Create the unified prompt file**

```markdown
You are an expert prompt engineer. Your task: transform the prompt below into the most
effective version possible. Do not change what the prompt is asking for — only improve
how it asks.

## Optimization Framework

Work through each lens below. Apply only what the prompt genuinely needs — skip any
dimension that is already strong or irrelevant to this task.

### 1. Role & Context
If missing or vague, add a specific expert persona that directly serves the task and
a one-sentence situational frame (who needs this, for what purpose, what failure looks like).
Keep to 1–2 sentences. Skip if the task is self-contained.

### 2. Clarity & Constraints
- Replace subjective qualifiers with concrete requirements ("Write a good summary" →
  "Write a 3-sentence summary covering: main claim, supporting evidence, conclusion").
- Add explicit prohibitions for the single most likely failure mode.
- Specify output format (structure, fields, length) only when the model would not infer
  it correctly on its own.

### 3. Depth & Exemplars
- Add a one-sentence example of the desired output style when tone or level of detail
  cannot be conveyed by instruction alone.
- State the goal behind the task when knowing it helps the model make better judgment
  calls ("The goal is X — not Y").
- Add a chain-of-thought trigger only for complex multi-step reasoning tasks.

### 4. Conciseness
- Remove every phrase that repeats information already implied elsewhere.
- Cut soft hedges ("if applicable", "as needed"), filler openings ("In this task you will…"),
  and meta-instructions the model can infer.
- The output should be measurably tighter than the input — if it isn't, cut more.

## Rules
- Preserve the original intent exactly. Never expand scope or change the task.
- Apply each lens only where it adds value. Do not pad.
- Return ONLY the optimized prompt text — no preamble, no commentary, no "Here is the
  improved version:".

## User Feedback (when present)
The user message may include a section after "---" labelled "Optimization Feedback".
Treat it as a highest-priority directive that overrides any general heuristic above.
Apply it exactly as stated.
```

- [ ] **Step 2: Verify the file was written**

```bash
cat qa-chatbot/prompts/council_optimizer.md
```

Expected: the full prompt text printed to stdout with no truncation.

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/prompts/council_optimizer.md
git commit -m "feat: add unified council optimizer prompt combining all 4 lenses"
```

---

## Task 2: Update council_vote.py to use the unified prompt

**Files:**
- Modify: `qa-chatbot/src/app/graph/nodes/council_vote.py`

- [ ] **Step 1: Write the failing test**

Open `qa-chatbot/tests/unit/graph/test_nodes.py` and add:

```python
from unittest.mock import AsyncMock, MagicMock, patch


def test_council_vote_all_models_receive_same_system_prompt():
    """All council models must receive the identical system prompt."""
    from app.graph.nodes import council_vote

    # Capture what each model was called with
    calls: list[list] = []

    async def fake_ainvoke(messages):
        calls.append(messages)
        mock_resp = MagicMock()
        mock_resp.content = "optimized"
        mock_resp.usage_metadata = {}
        return mock_resp

    fake_models = [MagicMock() for _ in range(4)]
    for m in fake_models:
        m.ainvoke = fake_ainvoke
        m.model_name = "test-model"

    state = {
        "raw_prompt": "Write me a haiku",
        "feedback": None,
        "job_id": None,
        "session_id": "",
        "user_id": "u1",
        "intent": None,
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "messages": [],
        "token_usage": {},
        "error": None,
    }

    with patch.object(council_vote, "_get_council_models", return_value=fake_models):
        import asyncio
        result = asyncio.run(council_vote.council_vote_node(state))

    assert len(calls) == 4
    system_prompts = [c[0]["content"] for c in calls]
    # All models must have received the exact same system prompt
    assert len(set(system_prompts)) == 1, (
        f"Expected all models to receive the same prompt, got {len(set(system_prompts))} different prompts"
    )
    assert len(result["council_responses"]) == 4


def test_council_vote_no_strategy_function_exists():
    """The old _get_strategy selector must not exist."""
    from app.graph.nodes import council_vote
    assert not hasattr(council_vote, "_get_strategy"), (
        "_get_strategy should have been removed; all models now receive the same prompt"
    )
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd qa-chatbot && uv run pytest tests/unit/graph/test_nodes.py::test_council_vote_all_models_receive_same_system_prompt tests/unit/graph/test_nodes.py::test_council_vote_no_strategy_function_exists -v
```

Expected: both tests FAIL — `_get_strategy` still exists and models receive different prompts.

- [ ] **Step 3: Update council_vote.py**

Replace the top of the file (imports through `_get_strategy`) so the full file reads:

```python
"""
Council Vote node — Round 1: Gather Opinions.

Each council model independently optimizes the raw prompt using the same unified
optimization framework. No model sees any other model's output in this round —
responses are fully independent. The diversity of model architectures and training
gives the critic round and the chairman meaningful variation to work with.
"""

import asyncio
import logging
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

_COUNCIL_PROMPT: str = load_prompt("council_optimizer")


def _build_models() -> list[ChatOpenAI]:
    llm_settings = get_llm_settings()
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
    """Models bind httpx to the running loop; Celery uses a new loop per task."""
    global _council_loop_id, _council_models
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _council_loop_id != lid or _council_models is None:
        _council_loop_id = lid
        _council_models = _build_models()
    return _council_models


def _build_user_message(raw_prompt: str, feedback: str | None) -> str:
    """Combine the raw prompt with optional user feedback."""
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

    Sends the raw prompt to all council models in parallel. Each model independently
    produces its own optimized version using the same unified framework — model
    architecture diversity provides variation without strategy coupling.
    Emits a progress event to Redis after each individual model completes.

    Returns:
        {"council_responses": [{model, optimized_prompt, usage}, ...]}
    """
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    job_id = state.get("job_id")
    models = _get_council_models()
    total = len(models)
    done_count = [0]
    lock = asyncio.Lock()

    async def optimize(model: ChatOpenAI, idx: int) -> dict[str, Any]:
        response = await model.ainvoke(
            [
                {"role": "system", "content": _COUNCIL_PROMPT},
                {"role": "user", "content": _build_user_message(raw_prompt, feedback)},
            ]
        )
        result: dict[str, Any] = {
            "model": _get_council_models()[idx].model_name,
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
                "Council model %d failed: %s: %s",
                i,
                type(r).__name__,
                r,
            )

    return {"council_responses": valid}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd qa-chatbot && uv run pytest tests/unit/graph/test_nodes.py::test_council_vote_all_models_receive_same_system_prompt tests/unit/graph/test_nodes.py::test_council_vote_no_strategy_function_exists -v
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/graph/nodes/council_vote.py qa-chatbot/tests/unit/graph/test_nodes.py
git commit -m "feat: council_vote uses single unified prompt for all models"
```

---

## Task 3: Delete the four old strategy prompt files

**Files:**
- Delete: `qa-chatbot/prompts/council_optimizer_analytical.md`
- Delete: `qa-chatbot/prompts/council_optimizer_creative.md`
- Delete: `qa-chatbot/prompts/council_optimizer_concise.md`
- Delete: `qa-chatbot/prompts/council_optimizer_structured.md`

- [ ] **Step 1: Verify nothing imports the old prompt names**

```bash
cd qa-chatbot && grep -r "council_optimizer_analytical\|council_optimizer_creative\|council_optimizer_concise\|council_optimizer_structured" src/ tests/
```

Expected: no matches. If any match is found, fix that reference before proceeding.

- [ ] **Step 2: Delete the files**

```bash
rm qa-chatbot/prompts/council_optimizer_analytical.md \
   qa-chatbot/prompts/council_optimizer_creative.md \
   qa-chatbot/prompts/council_optimizer_concise.md \
   qa-chatbot/prompts/council_optimizer_structured.md
```

- [ ] **Step 3: Verify they are gone**

```bash
ls qa-chatbot/prompts/
```

Expected output (order may vary):
```
council_optimizer.md
critic.md
intent_classifier.md
prompt_advisory.md
prompt_health_score.md
synthesize_best.md
```

- [ ] **Step 4: Commit**

```bash
git add -u qa-chatbot/prompts/
git commit -m "chore: remove four per-strategy council prompt files replaced by unified prompt"
```

---

## Task 4: Run full lint and test suite

**Files:** none modified

- [ ] **Step 1: Run lint**

```bash
cd qa-chatbot && make lint
```

Expected: `All checks passed!`

- [ ] **Step 2: Run unit tests**

```bash
cd qa-chatbot && make test-unit
```

Expected: all tests pass, no failures.

- [ ] **Step 3: Run type check**

```bash
cd qa-chatbot && make typecheck
```

Expected: no errors.

- [ ] **Step 4: Final commit if any auto-fixes were applied**

Only commit if `make lint` or `make typecheck` required file changes:

```bash
git add -u
git commit -m "chore: fix lint/type issues after unified council prompt refactor"
```
