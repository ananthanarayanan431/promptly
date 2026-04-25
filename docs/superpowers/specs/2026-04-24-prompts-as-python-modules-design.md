# Design: Prompts as Python Modules

**Date:** 2026-04-24
**Branch:** making-better-prompts-app
**Status:** Approved

---

## Problem

All LLM system prompts live as `.md` files in `prompts/` and are loaded at module startup via `src/app/graph/prompts.py:load_prompt()`. Variables (user input, feedback, proposals) are injected in Python *after* loading — via ad-hoc helpers like `_build_user_message()` scattered across individual node files. There is no consistent pattern for how variables flow into prompts, no `{{placeholder}}` syntax mirroring tools like Langfuse, and the `.md` format gives no IDE support, no type checking, and no co-location of template + variable contract.

---

## Goal

- Replace every `.md` prompt file with a dedicated Python module under `src/app/graph/prompts/`
- Each module owns its prompt text as a string constant with `{{variable}}` placeholders
- Each module exposes a single builder function that accepts typed parameters, fills placeholders via `.replace()`, and returns `list[dict]` — the full `[system, user]` message list ready for `model.ainvoke()`
- Delete all `.md` files and the old `load_prompt` loader
- All node files and service files import builder functions directly — no more manual message assembly

---

## Package Structure

```
src/app/graph/prompts/            ← replaces src/app/graph/prompts.py
    __init__.py                   ← re-exports all builder functions
    council_optimizer.py
    critic.py
    intent_classifier.py
    synthesize_best.py
    prompt_health_score.py
    prompt_advisory.py

prompts/                          ← DELETE all .md files after migration
```

---

## Per-Module Design

### `intent_classifier.py`

**Placeholders:** `{{raw_prompt}}` (user message only — system prompt is fully static)

```python
_SYSTEM = """...<full intent_classifier.md content>..."""

_USER = "{{raw_prompt}}"

def intent_classifier_messages(raw_prompt: str) -> list[dict]:
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _USER.replace("{{raw_prompt}}", raw_prompt)},
    ]
```

---

### `council_optimizer.py`

**Placeholders:** `{{raw_prompt}}` and optional `{{feedback}}` (both in user message — system prompt is static optimization framework)

```python
_SYSTEM = """...<full council_optimizer.md content>..."""

_USER = "{{raw_prompt}}"
_USER_WITH_FEEDBACK = "{{raw_prompt}}\n\n---\nOptimization Feedback (high-priority directive — override general heuristics if needed):\n{{feedback}}"

def council_optimizer_messages(raw_prompt: str, feedback: str | None) -> list[dict]:
    if feedback:
        user = _USER_WITH_FEEDBACK.replace("{{raw_prompt}}", raw_prompt).replace("{{feedback}}", feedback)
    else:
        user = _USER.replace("{{raw_prompt}}", raw_prompt)
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
```

---

### `critic.py`

**Placeholders:** `{{raw_prompt}}`, `{{proposal_a}}`, `{{proposal_b}}`, `{{proposal_c}}` (user message — system is static)

The current `_build_review_message()` logic in `critic.py` (which excludes the reviewer's own proposal and labels A/B/C) moves into this builder.

```python
_SYSTEM = """...<full critic.md content>..."""

_USER = "Original prompt:\n{{raw_prompt}}\n\n---\n\nProposal A:\n{{proposal_a}}\n\nProposal B:\n{{proposal_b}}\n\nProposal C:\n{{proposal_c}}"

def critic_messages(raw_prompt: str, proposal_a: str, proposal_b: str, proposal_c: str) -> list[dict]:
    user = (
        _USER
        .replace("{{raw_prompt}}", raw_prompt)
        .replace("{{proposal_a}}", proposal_a)
        .replace("{{proposal_b}}", proposal_b)
        .replace("{{proposal_c}}", proposal_c)
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
```

The caller (`critic.py` node) is responsible for slicing the proposals list to exclude the reviewer's own — it passes only 3 strings to this function.

---

### `synthesize_best.py`

**Placeholders:** `{{raw_prompt}}`, `{{proposals_block}}`, `{{critiques_block}}`, optional `{{feedback}}` (user message — system is static)

The current `_build_user_message()` in `synthesize.py` moves into this builder.

```python
_SYSTEM = """...<full synthesize_best.md content>..."""

_USER = (
    "Original prompt:\n{{raw_prompt}}\n\n"
    "---\n\n"
    "Round 1 — Council proposals:\n\n{{proposals_block}}\n\n"
    "---\n\n"
    "Round 2 — Peer critiques:\n\n{{critiques_block}}"
)

_FEEDBACK_SUFFIX = "\n\n---\n\nUser Feedback Directive (highest priority — must be reflected in the final output):\n{{feedback}}"

def synthesize_messages(
    raw_prompt: str,
    proposals_block: str,
    critiques_block: str,
    feedback: str | None,
) -> list[dict]:
    user = (
        _USER
        .replace("{{raw_prompt}}", raw_prompt)
        .replace("{{proposals_block}}", proposals_block)
        .replace("{{critiques_block}}", critiques_block)
    )
    if feedback:
        user += _FEEDBACK_SUFFIX.replace("{{feedback}}", feedback)
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
```

The caller (`synthesize.py` node) is responsible for building `proposals_block` and `critiques_block` strings from `GraphState` before calling this function.

---

### `prompt_health_score.py`

**Placeholders:** `{{prompt_to_evaluate}}` (user message — system is static)

```python
_SYSTEM = """...<full prompt_health_score.md content>..."""

_USER = "<prompt_to_evaluate>\n{{prompt_to_evaluate}}\n</prompt_to_evaluate>"

def prompt_health_score_messages(prompt: str) -> list[dict]:
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _USER.replace("{{prompt_to_evaluate}}", prompt)},
    ]
```

---

### `prompt_advisory.py`

**Placeholders:** `{{prompt_to_evaluate}}` (user message — system is static)

```python
_SYSTEM = """...<full prompt_advisory.md content>..."""

_USER = "<prompt_to_evaluate>\n{{prompt_to_evaluate}}\n</prompt_to_evaluate>"

def prompt_advisory_messages(prompt: str) -> list[dict]:
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _USER.replace("{{prompt_to_evaluate}}", prompt)},
    ]
```

---

### `__init__.py`

Re-exports all builder functions so callers use a single import path:

```python
from app.graph.prompts.council_optimizer import council_optimizer_messages
from app.graph.prompts.critic import critic_messages
from app.graph.prompts.intent_classifier import intent_classifier_messages
from app.graph.prompts.synthesize_best import synthesize_messages
from app.graph.prompts.prompt_health_score import prompt_health_score_messages
from app.graph.prompts.prompt_advisory import prompt_advisory_messages

__all__ = [
    "council_optimizer_messages",
    "critic_messages",
    "intent_classifier_messages",
    "synthesize_messages",
    "prompt_health_score_messages",
    "prompt_advisory_messages",
]
```

---

## Node / Service Changes

| File | Change |
|------|--------|
| `nodes/intent_classifier.py` | Remove `load_prompt`, `_SYSTEM_PROMPT`. Import `intent_classifier_messages`. Replace manual `ainvoke([system, user])` with `ainvoke(intent_classifier_messages(raw))` |
| `nodes/council_vote.py` | Remove `load_prompt`, `_COUNCIL_PROMPT`, `_build_user_message`. Import `council_optimizer_messages`. Replace inline message build with `council_optimizer_messages(raw_prompt, feedback)` |
| `nodes/critic.py` | Remove `load_prompt`, `_CRITIC_PROMPT`, `_build_review_message`. Import `critic_messages`. Pass 3 proposals (reviewer's own excluded) as positional args |
| `nodes/synthesize.py` | Remove `load_prompt`, `_SYSTEM_PROMPT`, `_build_user_message`. Import `synthesize_messages`. Build `proposals_block` and `critiques_block` strings inline, then call `synthesize_messages(...)` |
| `services/prompt_service.py` | Remove `load_prompt` calls for `_health_score_prompt`, `_advisory_prompt`. Import `prompt_health_score_messages`, `prompt_advisory_messages`. Replace `ainvoke([system, user])` calls |

---

## Deletion

- `prompts/council_optimizer.md`
- `prompts/critic.md`
- `prompts/intent_classifier.md`
- `prompts/synthesize_best.md`
- `prompts/prompt_health_score.md`
- `prompts/prompt_advisory.md`
- `prompts/favorite_auto_tag.md` — used by `favorite_service.py` line 114 via `.replace("{prompt}", content)`; migrated in the same PR (see below)
- `src/app/graph/prompts.py` — replaced by `src/app/graph/prompts/` package

---

### `favorite_auto_tag.py`

**Placeholders:** `{{prompt}}` (user message only — **no system message**, unlike all other prompts)

```python
_USER = """You generate concise tag/category metadata...\n\nPrompt to classify:\n---\n{{prompt}}\n---\n\nRespond with JSON only."""

def favorite_auto_tag_messages(prompt: str) -> list[dict]:
    return [
        {"role": "user", "content": _USER.replace("{{prompt}}", prompt)},
    ]
```

Caller (`favorite_service.py` line 114) changes from:
```python
prompt = _AUTO_TAG_PROMPT.replace("{prompt}", content[:4000])
model.ainvoke([{"role": "user", "content": prompt}])
```
to:
```python
model.ainvoke(favorite_auto_tag_messages(content[:4000]))
```

This module lives at `src/app/graph/prompts/favorite_auto_tag.py` and is re-exported from `__init__.py`.

---

## Out of Scope

- `favorite_auto_tag.py` — outside the graph pipeline but migrated in the same PR for completeness
- No changes to `GraphState`, LangGraph wiring, Celery tasks, or API layer
- No changes to prompt *content* — text is copied verbatim from `.md` files into Python constants
