# SkillOpt Paper Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 7 algorithmic gaps between arXiv:2605.23904 and the current SkillOpt codebase.

**Architecture:** All changes are confined to `qa-chatbot/src/promptly/skill_opt/`. The core algorithm lives in `core/skillopt.py`; prompts in `prompts/system.py`. Peripheral schema/model/router/worker files receive additive-only changes.

**Tech Stack:** Python 3.12, asyncio, SQLAlchemy 2.0 async, FastAPI, Alembic, pytest

## Global Constraints

- All **new** LLM calls use `google/gemini-2.0-flash` (cheapest model, ~$0.10/1M tokens)
- Existing model assignments (executor, scorer, seed, optimizer) are **unchanged**
- Minimum examples raised from 6 → **10** everywhere
- All async — no sync SQLAlchemy patterns
- `uv run pytest tests/unit/skill_opt/ -v` must pass after each task
- Run from `qa-chatbot/` directory for all commands

---

### Task 1: Test scaffold + Gap 7 (LR floor)

**Files:**
- Create: `tests/unit/skill_opt/__init__.py`
- Create: `tests/unit/skill_opt/test_core.py`
- Modify: `src/promptly/skill_opt/core/skillopt.py` (line 101-106)

**Interfaces:**
- Produces: `_cosine_lr(base, epoch, total) -> int` with floor=2

- [ ] **Step 1: Create test scaffold**

```python
# tests/unit/skill_opt/__init__.py
# (empty)
```

```python
# tests/unit/skill_opt/test_core.py
from promptly.skill_opt.core.skillopt import _cosine_lr
```

- [ ] **Step 2: Write failing test**

Add to `tests/unit/skill_opt/test_core.py`:

```python
def test_cosine_lr_floor_is_two():
    # Last epoch of a 3-epoch run should not drop below 2
    result = _cosine_lr(base=3, epoch=2, total=3)
    assert result >= 2


def test_cosine_lr_floor_not_one():
    # Extreme case: base=2, final epoch — must still return 2 not 1
    result = _cosine_lr(base=2, epoch=99, total=100)
    assert result == 2


def test_cosine_lr_first_epoch_is_base():
    assert _cosine_lr(base=4, epoch=0, total=4) == 4
```

- [ ] **Step 3: Run — expect FAIL on floor tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

Expected: `test_cosine_lr_floor_not_one` FAIL (returns 1, not 2)

- [ ] **Step 4: Fix `_cosine_lr` in `skillopt.py` line 106**

```python
# Before
return max(1, round(base * (0.5 + 0.5 * factor)))
# After
return max(2, round(base * (0.5 + 0.5 * factor)))
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 6: Commit**

```bash
git add tests/unit/skill_opt/ src/promptly/skill_opt/core/skillopt.py
git commit -m "fix: raise SkillOpt cosine LR floor from 1 to 2 per paper §3"
```

---

### Task 2: Gap 3 — Score cache

**Files:**
- Modify: `src/promptly/skill_opt/core/skillopt.py`
- Modify: `tests/unit/skill_opt/test_core.py`

**Interfaces:**
- Produces: `_score_cache_key(skill: str) -> str`
- Produces: `_score_on_selection_cached(skill, d_sel, cache, api_key, token_counter, executor_model) -> float`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/skill_opt/test_core.py`:

```python
import hashlib
from unittest.mock import AsyncMock, patch

from promptly.skill_opt.core.skillopt import _score_cache_key, _score_on_selection_cached, Example


def test_score_cache_key_is_deterministic():
    assert _score_cache_key("hello") == _score_cache_key("hello")


def test_score_cache_key_differs_for_different_skills():
    assert _score_cache_key("skill A") != _score_cache_key("skill B")


def test_score_cache_key_length():
    assert len(_score_cache_key("any skill")) == 16


async def test_score_cache_hit_skips_llm():
    cache: dict[str, float] = {}
    skill = "my skill"
    cache[_score_cache_key(skill)] = 0.75

    call_count = 0

    async def fake_score(s, d, api_key, tc, em):
        nonlocal call_count
        call_count += 1
        return 0.5

    with patch(
        "promptly.skill_opt.core.skillopt._score_on_selection",
        side_effect=fake_score,
    ):
        result = await _score_on_selection_cached(skill, [], cache, "key", None, "m")

    assert result == 0.75
    assert call_count == 0


async def test_score_cache_miss_calls_llm_and_stores():
    cache: dict[str, float] = {}
    skill = "my skill"

    async def fake_score(s, d, api_key, tc, em):
        return 0.6

    with patch(
        "promptly.skill_opt.core.skillopt._score_on_selection",
        side_effect=fake_score,
    ):
        result = await _score_on_selection_cached(skill, [], cache, "key", None, "m")

    assert result == 0.6
    assert cache[_score_cache_key(skill)] == 0.6
```

- [ ] **Step 2: Run — expect FAIL (functions don't exist yet)**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v -k "cache"
```

- [ ] **Step 3: Add cache helpers to `skillopt.py` after the `_chunked` helper (around line 113)**

```python
import hashlib


def _score_cache_key(skill: str) -> str:
    return hashlib.sha256(skill.encode()).hexdigest()[:16]


async def _score_on_selection_cached(
    skill: str,
    d_sel: list[Example],
    cache: dict[str, float],
    api_key: str,
    token_counter: list[int] | None = None,
    executor_model: str = _EXECUTOR_MODEL,
) -> float:
    key = _score_cache_key(skill)
    if key in cache:
        _log.debug("score_cache_hit", key=key)
        return cache[key]
    score = await _score_on_selection(skill, d_sel, api_key, token_counter, executor_model)
    cache[key] = score
    return score
```

Also add `import hashlib` at the top of `skillopt.py` (after `import math`).

- [ ] **Step 4: Run — expect PASS**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py tests/unit/skill_opt/test_core.py
git commit -m "feat: add score cache keyed by skill hash to avoid redundant D_sel evaluations"
```

---

### Task 3: Gap 6 — D_test split + minimum 10

**Files:**
- Modify: `src/promptly/skill_opt/core/skillopt.py` (`optimize_skill`)
- Modify: `tests/unit/skill_opt/test_core.py`

**Interfaces:**
- `optimize_skill()` now raises `ValueError` if `len(examples) < 10`
- Return dict gains `score_test: float`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/skill_opt/test_core.py`:

```python
import pytest
from promptly.skill_opt.core.skillopt import Example, _split_examples


def test_split_requires_ten_examples():
    with pytest.raises(ValueError, match="10"):
        _split_examples([{"input": "a", "expected": "b"}] * 9, seed=42)


def test_split_produces_three_parts():
    data = [{"input": str(i), "expected": str(i)} for i in range(20)]
    d_train, d_sel, d_test = _split_examples(data, seed=42)
    assert len(d_train) + len(d_sel) + len(d_test) == 20
    assert len(d_test) >= 2
    assert len(d_sel) >= 2
    assert len(d_train) >= 2


def test_split_is_deterministic():
    data = [{"input": str(i), "expected": str(i)} for i in range(15)]
    a = _split_examples(data, seed=42)
    b = _split_examples(data, seed=42)
    assert [e.input for e in a[0]] == [e.input for e in b[0]]
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v -k "split"
```

- [ ] **Step 3: Add `_split_examples` to `skillopt.py` after `_chunked`**

```python
def _split_examples(
    raw: list[dict[str, str]], seed: int = 42
) -> tuple[list[Example], list[Example], list[Example]]:
    """Shuffle and split into (d_train, d_sel, d_test). Minimum 10 examples required."""
    if len(raw) < 10:
        raise ValueError(f"SkillOpt needs at least 10 examples; got {len(raw)}.")
    parsed = [Example(input=e["input"], expected=e["expected"]) for e in raw]
    rng = random.Random(seed)  # noqa: S311
    rng.shuffle(parsed)
    n_test = max(2, len(parsed) // 5)
    n_sel = max(2, len(parsed) // 4)
    d_test = parsed[-n_test:]
    d_sel = parsed[-(n_test + n_sel) : -n_test]
    d_train = parsed[: -(n_test + n_sel)]
    if not d_train:
        d_train = parsed
    return d_train, d_sel, d_test
```

- [ ] **Step 4: Update `optimize_skill` to use `_split_examples`**

Replace the existing split block (lines ~459–467) with:

```python
    d_train, d_sel, d_test = _split_examples(examples, seed=42)
    _score_cache: dict[str, float] = {}
```

Remove the old `rng = random.Random(42)` and `n_sel`/`d_sel`/`d_train` lines.

Replace the old `if len(parsed) < 6` check (it's now inside `_split_examples`).

Remove `parsed = [...]` — `_split_examples` does this.
Change `rng = random.Random(42)` (the one used for `rng.sample` in rollout) to a fresh `rng = random.Random(42)` after the split.

Rename `parsed` references in rollout to `d_train`:
```python
batch = rng.sample(d_train, min(rollout_batch, len(d_train)))
```

Replace all `_score_on_selection(...)` calls with `_score_on_selection_cached(..., _score_cache, ...)`.

After the epoch loop, add:
```python
    score_test = await _score_on_selection_cached(
        best_skill, d_test, _score_cache, api_key, token_counter, executor_model
    )
    _log.info("skillopt_test_score", score_test=round(score_test, 3))
```

Add `"score_test": round(score_test, 4)` to the return dict.

Also remove the old `token_counter: list[int] = [0]` — it stays, just move it after the split.

- [ ] **Step 5: Run tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 6: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py tests/unit/skill_opt/test_core.py
git commit -m "feat: add D_test 3-way split and score cache wiring per paper §3"
```

---

### Task 4: Gap 4 — Protected region helpers + `_apply_edits`

**Files:**
- Modify: `src/promptly/skill_opt/core/skillopt.py`
- Modify: `tests/unit/skill_opt/test_core.py`

**Interfaces:**
- Produces: `_META_START = "<!-- META:START -->"`, `_META_END = "<!-- META:END -->"`
- Produces: `_extract_protected(skill) -> tuple[str, str]`
- Produces: `_restore_protected(editable, protected) -> str`
- `_apply_edits` now preserves the protected block

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/skill_opt/test_core.py`:

```python
from promptly.skill_opt.core.skillopt import (
    _META_END,
    _META_START,
    _apply_edits,
    _extract_protected,
    _restore_protected,
    Edit,
)

SKILL_WITH_META = """\
# Guide

Do step A.
Do step B.

---
## Consolidated Lessons
<!-- META:START -->
- lesson one
<!-- META:END -->"""

SKILL_NO_META = "# Guide\n\nDo step A."


def test_extract_protected_returns_editable_and_block():
    editable, protected = _extract_protected(SKILL_WITH_META)
    assert "<!-- META:START -->" in protected
    assert "<!-- META:END -->" in protected
    assert "<!-- META:START -->" not in editable


def test_extract_protected_no_meta_returns_full_skill():
    editable, protected = _extract_protected(SKILL_NO_META)
    assert editable == SKILL_NO_META
    assert protected == ""


def test_restore_protected_roundtrips():
    editable, protected = _extract_protected(SKILL_WITH_META)
    result = _restore_protected(editable, protected)
    assert "<!-- META:START -->" in result
    assert "Do step A." in result


def test_apply_edits_preserves_protected_block():
    edits = [Edit(op="ADD", target=None, content="New rule here.", rationale="r")]
    result = _apply_edits(SKILL_WITH_META, edits)
    assert "New rule here." in result
    assert "<!-- META:START -->" in result
    assert "<!-- META:END -->" in result


def test_apply_edits_cannot_delete_inside_protected():
    edits = [Edit(op="DELETE", target="lesson one", rationale="r", content=None)]
    result = _apply_edits(SKILL_WITH_META, edits)
    # "lesson one" is inside protected — should still be present
    assert "lesson one" in result
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v -k "protected or meta or extract or restore"
```

- [ ] **Step 3: Add constants and helpers to `skillopt.py`** (after `_chunked`, before `_format_traces`)

```python
_META_START = "<!-- META:START -->"
_META_END = "<!-- META:END -->"
_META_SECTION_HEADER = "\n---\n## Consolidated Lessons\n"


def _extract_protected(skill: str) -> tuple[str, str]:
    """Return (editable_part, protected_block). Protected block starts at the --- separator
    before META:START, or at META:START if no separator found."""
    idx = skill.find(_META_START)
    if idx == -1:
        return skill, ""
    # Walk back to find the section separator
    pre = skill[:idx]
    sep_idx = pre.rfind("\n---\n")
    cut = (sep_idx + 1) if sep_idx != -1 else idx
    return skill[:cut].rstrip(), skill[cut:]


def _restore_protected(editable: str, protected: str) -> str:
    if not protected:
        return editable
    return editable.rstrip() + "\n\n" + protected.lstrip()
```

- [ ] **Step 4: Update `_apply_edits` to protect the META block**

Replace the existing `_apply_edits` function:

```python
def _apply_edits(skill: str, edits: list[Edit]) -> str:
    """Apply ranked edits to the editable portion of the skill document only."""
    editable, protected = _extract_protected(skill)
    result = editable
    for edit in edits:
        if edit.op == "ADD" and edit.content:
            result = result.rstrip() + "\n\n" + edit.content.strip()
        elif edit.op == "DELETE" and edit.target:
            result = result.replace(edit.target, "").strip()
        elif edit.op == "REPLACE" and edit.target and edit.content:
            if edit.target in result:
                result = result.replace(edit.target, edit.content, 1)
            else:
                result = result.rstrip() + "\n\n" + edit.content.strip()
    return _restore_protected(result.strip(), protected)
```

- [ ] **Step 5: Append META block in `_generate_seed_skill`**

At the end of `_generate_seed_skill`, before the `return` statement, add:

```python
        content = str(resp.content).strip()
        if _META_START not in content:
            content = (
                content
                + "\n\n---\n## Consolidated Lessons\n"
                + _META_START
                + "\n"
                + _META_END
            )
        return content
```

Also update the fallback return in the `except` block:

```python
        return (
            f"# Skill Guide: {task_description[:60]}\n\n"
            "Follow the task instructions carefully.\n"
            "Think step by step before answering.\n"
            "Be concise and accurate.\n\n"
            "---\n## Consolidated Lessons\n"
            f"{_META_START}\n{_META_END}"
        )
```

- [ ] **Step 6: Run — expect PASS**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 7: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py tests/unit/skill_opt/test_core.py
git commit -m "feat: add protected slow-update region to skill documents per paper §3"
```

---

### Task 5: Gap 4 — Meta-update returns updated protected block

**Files:**
- Modify: `src/promptly/skill_opt/prompts/system.py` (META prompts)
- Modify: `src/promptly/skill_opt/core/skillopt.py` (`_meta_update` + loop)

**Interfaces:**
- `_meta_update(...)` now returns `tuple[list[str], str]` — `(lessons, updated_protected_block)`

- [ ] **Step 1: Update `META_SYSTEM` and `META_USER` in `system.py`**

Replace the existing `META_SYSTEM`:

```python
META_SYSTEM = """\
You are analyzing an epoch of skill optimization. Given the current skill document, all
accepted and rejected edits from this epoch, and performance trends, synthesize 2–5 stable
lessons and update the protected consolidated-lessons block.

The protected block uses <!-- META:START --> and <!-- META:END --> markers.

Output ONLY valid JSON:
{
  "lessons": [
    {"keep": "<what worked, in one sentence>"},
    {"avoid": "<what to avoid, in one sentence>"}
  ],
  "updated_protected": "---\\n## Consolidated Lessons\\n<!-- META:START -->\\n- lesson\\n<!-- META:END -->"
}"""
```

Replace the existing `META_USER`:

```python
META_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

CURRENT CONSOLIDATED LESSONS (protected region):
{protected_block}

EPOCH SUMMARY:
- Score improvement: {score_before:.3f} → {score_after:.3f}
- Edits accepted: {edits_accepted}
- Edits rejected: {edits_rejected}

ACCEPTED EDITS:
{accepted_edits}

REJECTED EDITS:
{rejected_edits}

Synthesize stable lessons and return an updated protected block."""
```

- [ ] **Step 2: Update `_meta_update` signature and return in `skillopt.py`**

Replace the existing `_meta_update` function:

```python
async def _meta_update(
    current_skill: str,
    score_before: float,
    score_after: float,
    accepted_edits: list[Edit],
    rejected_edits: list[Edit],
    api_key: str,
    token_counter: list[int] | None = None,
) -> tuple[list[str], str]:
    """Returns (lessons, updated_protected_block)."""
    llm = _build(_OPTIMIZER_MODEL, temperature=0.3, max_tokens=500, api_key=api_key)
    _, protected = _extract_protected(current_skill)

    def fmt_edits(edits: list[Edit]) -> str:
        return (
            "\n".join(f"- [{e.op}] {e.content or e.target or '(no text)'}" for e in edits[:5])
            or "(none)"
        )

    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": META_SYSTEM},
                {
                    "role": "user",
                    "content": META_USER.format(
                        current_skill=current_skill[:1500],
                        protected_block=protected or "(none)",
                        score_before=score_before,
                        score_after=score_after,
                        edits_accepted=len(accepted_edits),
                        edits_rejected=len(rejected_edits),
                        accepted_edits=fmt_edits(accepted_edits),
                        rejected_edits=fmt_edits(rejected_edits),
                    ),
                },
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        obj = _json_safe(str(resp.content))
        notes: list[str] = []
        for lesson in obj.get("lessons", [])[:5]:
            if isinstance(lesson, dict):
                text = lesson.get("keep") or lesson.get("avoid") or ""
                if text:
                    notes.append(str(text)[:200])
        updated_protected: str = obj.get("updated_protected", protected) or protected
        # Validate markers present
        if _META_START not in updated_protected:
            updated_protected = protected
        return notes, updated_protected
    except Exception as exc:
        _log.warning("meta_update_failed", error=str(exc))
        return [], protected
```

- [ ] **Step 3: Update the meta-update call in the optimization loop**

Find the existing `new_meta = await _meta_update(...)` call and replace:

```python
        new_meta, updated_protected = await _meta_update(
            current_skill=current_skill,
            score_before=epoch_score_before,
            score_after=current_score,
            accepted_edits=epoch_accepted_edits,
            rejected_edits=list(rejected_edit_buffer),
            api_key=api_key,
            token_counter=token_counter,
        )
        meta_notes = (meta_notes + new_meta)[-10:]

        # Apply the meta-update to the protected block in current_skill
        editable, _ = _extract_protected(current_skill)
        current_skill = _restore_protected(editable, updated_protected)
        # Also update best_skill if it is the same document
        if current_skill == best_skill or best_score == current_score:
            best_skill = current_skill
```

- [ ] **Step 4: Run tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py src/promptly/skill_opt/prompts/system.py
git commit -m "feat: meta-update now writes lessons into the protected skill region"
```

---

### Task 6: Gap 5 — Rewrite mode

**Files:**
- Modify: `src/promptly/skill_opt/prompts/system.py`
- Modify: `src/promptly/skill_opt/core/skillopt.py`
- Modify: `tests/unit/skill_opt/test_core.py`

**Interfaces:**
- New model constant: `_REWRITE_MODEL = "google/gemini-2.0-flash"`
- Produces: `_rewrite_skill(current_skill, all_traces, meta_notes, api_key, token_counter) -> str`

- [ ] **Step 1: Add rewrite prompts to `system.py`**

Add after the `META_USER` block:

```python
# ── Rewrite (full document rewrite when patch mode stalls) ────────────────────

REWRITE_SYSTEM = """\
You are rewriting a skill document from scratch. The current document has stalled — repeated
edit attempts did not improve performance. Write a completely fresh skill document that learns
from all accumulated evidence.

A skill document is a compact, actionable markdown guide (150–400 words) containing:
1. A brief task description (2–3 sentences)
2. Step-by-step reasoning strategy
3. Common pitfalls to avoid (derived from failure patterns)
4. Output format guidelines

End the document with this exact block (fill in lessons from evidence):
---
## Consolidated Lessons
<!-- META:START -->
<!-- META:END -->

Output ONLY the skill document in markdown. No preamble."""

REWRITE_USER = """\
CURRENT SKILL (for reference — feel free to depart from it):
{current_skill}

SUCCESS EXAMPLES ({n_success} examples):
{success_traces}

FAILURE EXAMPLES ({n_failure} examples):
{failure_traces}

META LESSONS FROM PRIOR EPOCHS:
{meta_notes}

Write a fresh skill document."""
```

- [ ] **Step 2: Add `_REWRITE_MODEL` constant and `_rewrite_skill` function to `skillopt.py`**

Add `_REWRITE_MODEL = "google/gemini-2.0-flash"` to the model config section (after `_SEED_MODEL`).

Add the function after `_meta_update`:

```python
async def _rewrite_skill(
    current_skill: str,
    all_traces: list[Trace],
    meta_notes: list[str],
    api_key: str,
    token_counter: list[int] | None = None,
) -> str:
    """Full skill document rewrite for when patch-mode stalls (2+ consecutive rejections)."""
    from promptly.skill_opt.prompts.system import REWRITE_SYSTEM, REWRITE_USER

    llm = _build(_REWRITE_MODEL, temperature=0.7, max_tokens=800, api_key=api_key)
    successes = [t for t in all_traces if t.score >= 0.5]
    failures = [t for t in all_traces if t.score < 0.5]
    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": REWRITE_SYSTEM},
                {
                    "role": "user",
                    "content": REWRITE_USER.format(
                        current_skill=current_skill[:1500],
                        n_success=len(successes),
                        success_traces=_format_traces(successes, max_per=3),
                        n_failure=len(failures),
                        failure_traces=_format_traces(failures, max_per=3),
                        meta_notes="\n".join(f"- {n}" for n in meta_notes[-5:]) or "(none)",
                    ),
                },
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        content = str(resp.content).strip()
        if _META_START not in content:
            content += f"\n\n---\n## Consolidated Lessons\n{_META_START}\n{_META_END}"
        return content
    except Exception as exc:
        _log.warning("rewrite_skill_failed", error=str(exc))
        return current_skill
```

- [ ] **Step 3: Add `consecutive_rejections` counter and rewrite trigger to the optimization loop**

In `optimize_skill`, add before the epoch loop:

```python
    consecutive_rejections: int = 0
    all_epoch_traces: list[Trace] = []
```

Inside the loop, after `traces = await _rollout_batch(...)`:

```python
        all_epoch_traces.extend(traces)
```

In the gate rejection branch (after `rejected_edit_buffer.extend(ranked)`), add:

```python
            consecutive_rejections += 1
            if consecutive_rejections >= 2:
                _log.info("skillopt_rewrite_triggered", epoch=epoch + 1)
                rewrite_candidate = await _rewrite_skill(
                    current_skill, all_epoch_traces, meta_notes, api_key, token_counter
                )
                rewrite_score = await _score_on_selection_cached(
                    rewrite_candidate, d_sel, _score_cache, api_key, token_counter, executor_model
                )
                if rewrite_score > current_score:
                    _log.info(
                        "skillopt_rewrite_accepted",
                        epoch=epoch + 1,
                        score=round(rewrite_score, 3),
                    )
                    current_skill = rewrite_candidate
                    current_score = rewrite_score
                    if rewrite_score > best_score:
                        best_skill = rewrite_candidate
                        best_score = rewrite_score
                consecutive_rejections = 0
```

In the gate acceptance branch (after `best_skill = candidate_skill`), add:

```python
            consecutive_rejections = 0
```

- [ ] **Step 4: Write unit test for `_rewrite_skill`**

Add to `tests/unit/skill_opt/test_core.py`:

```python
from unittest.mock import MagicMock, patch, AsyncMock
from promptly.skill_opt.core.skillopt import _rewrite_skill, Trace, Example, _META_START


async def test_rewrite_skill_appends_meta_block_if_missing():
    mock_resp = MagicMock()
    mock_resp.content = "# Fresh Skill\n\nDo things."
    mock_resp.usage_metadata = None

    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    with patch("promptly.skill_opt.core.skillopt._build", return_value=mock_llm):
        result = await _rewrite_skill("old skill", [], [], "key", None)

    assert _META_START in result


async def test_rewrite_skill_returns_current_on_error():
    with patch("promptly.skill_opt.core.skillopt._build", side_effect=Exception("fail")):
        result = await _rewrite_skill("fallback skill", [], [], "key", None)
    assert result == "fallback skill"
```

- [ ] **Step 5: Run tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 6: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py src/promptly/skill_opt/prompts/system.py tests/unit/skill_opt/test_core.py
git commit -m "feat: add rewrite mode triggered after 2 consecutive gate rejections per paper §3"
```

---

### Task 7: Gap 1+2 — New analyst + merge prompts in `system.py`

**Files:**
- Modify: `src/promptly/skill_opt/prompts/system.py`

- [ ] **Step 1: Add all new prompt strings**

Add the following sections to `system.py` after the `REJECTED_EDITS_BLOCK` block and before the `META_SYSTEM` block:

```python
# ── Analyst: Failure (separate failure-trace analysis) ────────────────────────

ANALYST_FAILURE_SYSTEM = """\
You are a skill document failure analyst. Analyze ONLY the failure traces below — cases where
a frozen language model scored below 0.5 on the task.

Identify what the current skill document is missing or getting wrong that caused these failures.
Propose precise, bounded edit patches.

Edit operations:
- ADD: add a new rule or step
- DELETE: remove a rule that is causing failures
- REPLACE: replace a rule with a better version

STRICT CONSTRAINTS:
- Propose at most {lr_budget} edits
- Focus ONLY on failure patterns — ignore successes
- Each edit must address a specific failure mode from the traces
- Do NOT rewrite the entire document

{rejected_edits_block}

Respond with ONLY valid JSON:
{{
  "analysis": "<2–3 sentence diagnosis of what caused the failures>",
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

ANALYST_FAILURE_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

FAILURE TRAJECTORIES ({n_failure} examples, score < 0.5):
{failure_traces}

Propose up to {lr_budget} edits to fix these failure patterns."""

# ── Analyst: Success (separate success-trace analysis) ────────────────────────

ANALYST_SUCCESS_SYSTEM = """\
You are a skill document success analyst. Analyze ONLY the success traces below — cases where
a frozen language model scored 0.5 or above on the task.

Identify what in the current skill document is working well and should be reinforced or sharpened.
Propose precise edit patches.

Edit operations:
- ADD: add a new rule that reinforces what's working
- REPLACE: sharpen an existing rule that is partially working

STRICT CONSTRAINTS:
- Propose at most {lr_budget} edits
- Focus ONLY on success patterns — ignore failures
- Propose 0 edits if the document already captures what's working perfectly
- Do NOT rewrite the entire document

Respond with ONLY valid JSON:
{{
  "analysis": "<2–3 sentence summary of what is working well>",
  "edits": [
    {{"op": "ADD|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

ANALYST_SUCCESS_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

SUCCESS TRAJECTORIES ({n_success} examples, score >= 0.5):
{success_traces}

Propose up to {lr_budget} edits to reinforce these success patterns."""

# ── Merge: Failure proposals ───────────────────────────────────────────────────

MERGE_FAILURE_SYSTEM = """\
You are merging multiple sets of failure-fix edit proposals into one unified set.
Each set was generated independently from a different batch of failure traces.

1. Identify the most impactful unique edits across all sets
2. Remove duplicates (keep the version with the clearest rationale)
3. Return the top {lr_budget} failure-fix edits ranked by expected impact

Respond with ONLY valid JSON:
{{
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

MERGE_FAILURE_USER = """\
FAILURE-FIX EDIT PROPOSALS ({n_batches} batches):
{edit_batches}

Merge into the top {lr_budget} unique high-impact failure-fix edits."""

# ── Merge: Success proposals ───────────────────────────────────────────────────

MERGE_SUCCESS_SYSTEM = """\
You are merging multiple sets of success-reinforcement edit proposals into one unified set.
Each set was generated independently from a different batch of success traces.

1. Identify the most impactful unique edits across all sets
2. Remove duplicates (keep the version with the clearest rationale)
3. Return the top {lr_budget} success-reinforcement edits ranked by expected impact

Respond with ONLY valid JSON:
{{
  "edits": [
    {{"op": "ADD|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

MERGE_SUCCESS_USER = """\
SUCCESS-REINFORCEMENT EDIT PROPOSALS ({n_batches} batches):
{edit_batches}

Merge into the top {lr_budget} unique high-impact success-reinforcement edits."""

# ── Merge: Final (failure-prioritized combination) ────────────────────────────

MERGE_FINAL_SYSTEM = """\
You are combining failure-fix edits and success-reinforcement edits into a single final list.

Priority rules:
1. Failure-fix edits take priority over success-reinforcement when there is a conflict
2. Never include edits that contradict each other
3. Return at most {lr_budget} total edits

Each edit must include a "source" field: "failure" or "success".

Respond with ONLY valid JSON:
{{
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>", "source": "failure|success"}}
  ]
}}"""

MERGE_FINAL_USER = """\
FAILURE-FIX EDITS (higher priority):
{failure_edits}

SUCCESS-REINFORCEMENT EDITS (lower priority):
{success_edits}

CURRENT SKILL (for context):
{current_skill}

Produce the final ranked list of at most {lr_budget} edits."""
```

- [ ] **Step 2: Update imports in `skillopt.py`**

Add the new prompt names to the import from `promptly.skill_opt.prompts.system`:

```python
from promptly.skill_opt.prompts.system import (
    ANALYST_FAILURE_SYSTEM,
    ANALYST_FAILURE_USER,
    ANALYST_SUCCESS_SYSTEM,
    ANALYST_SUCCESS_USER,
    EXECUTOR_SYSTEM,
    EXECUTOR_USER,
    MERGE_FAILURE_SYSTEM,
    MERGE_FAILURE_USER,
    MERGE_FINAL_SYSTEM,
    MERGE_FINAL_USER,
    MERGE_SUCCESS_SYSTEM,
    MERGE_SUCCESS_USER,
    META_SYSTEM,
    META_USER,
    REJECTED_EDITS_BLOCK,
    REWRITE_SYSTEM,
    REWRITE_USER,
    SCORER_SYSTEM,
    SCORER_USER,
    SEED_SYSTEM,
    SEED_USER,
)
```

- [ ] **Step 3: Commit**

```bash
git add src/promptly/skill_opt/prompts/system.py src/promptly/skill_opt/core/skillopt.py
git commit -m "feat: add analyst and hierarchical merge prompt templates per paper §3"
```

---

### Task 8: Gap 2 — `Edit.source` + updated `_rank_edits`

**Files:**
- Modify: `src/promptly/skill_opt/core/skillopt.py`
- Modify: `tests/unit/skill_opt/test_core.py`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/skill_opt/test_core.py`:

```python
from promptly.skill_opt.core.skillopt import Edit, _rank_edits


def test_rank_edits_failure_before_success_at_equal_frequency():
    edits = [
        Edit(op="ADD", target=None, content="success rule", rationale="r", source="success"),
        Edit(op="ADD", target=None, content="failure rule", rationale="r", source="failure"),
    ]
    ranked = _rank_edits(edits, budget=2)
    assert ranked[0].source == "failure"
    assert ranked[1].source == "success"


def test_rank_edits_frequency_still_wins_within_same_source():
    edits = [
        Edit(op="ADD", target=None, content="rare failure", rationale="r", source="failure", frequency=1),
        Edit(op="ADD", target=None, content="common failure", rationale="r", source="failure", frequency=3),
    ]
    ranked = _rank_edits(edits, budget=2)
    assert ranked[0].content == "common failure"


def test_edit_default_source_is_failure():
    e = Edit(op="ADD", target=None, content="x", rationale="r")
    assert e.source == "failure"
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v -k "rank_edits or source"
```

- [ ] **Step 3: Update `Edit` dataclass to add `source` field**

```python
@dataclass
class Edit:
    op: str  # ADD | DELETE | REPLACE
    target: str | None
    content: str | None
    rationale: str
    frequency: int = 1
    source: str = "failure"  # "failure" | "success"
```

- [ ] **Step 4: Update `_rank_edits` to sort by source then frequency**

```python
def _rank_edits(all_edits: list[Edit], budget: int) -> list[Edit]:
    """Deduplicate and rank: failure-source first, then by frequency descending."""
    seen: dict[str, Edit] = {}
    for e in all_edits:
        key = f"{e.op}::{(e.target or '')[:80]}::{(e.content or '')[:80]}"
        if key in seen:
            seen[key].frequency += 1
        else:
            seen[key] = e
    ranked = sorted(
        seen.values(),
        key=lambda x: (0 if x.source == "failure" else 1, -x.frequency),
    )
    return ranked[:budget]
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 6: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py tests/unit/skill_opt/test_core.py
git commit -m "feat: Edit.source field and failure-prioritized _rank_edits per paper §3"
```

---

### Task 9: Gap 1 — Analyst functions + hierarchical merge

**Files:**
- Modify: `src/promptly/skill_opt/core/skillopt.py`
- Modify: `tests/unit/skill_opt/test_core.py`

**Interfaces:**
- New model constant: `_ANALYST_MODEL = "google/gemini-2.0-flash"`
- New model constant: `_MERGE_MODEL = "google/gemini-2.0-flash"`
- Produces: `_analyze_failures(skill, failures, rejected_edits, meta_notes, lr, api_key, token_counter) -> list[Edit]`
- Produces: `_analyze_successes(skill, successes, meta_notes, lr, api_key, token_counter) -> list[Edit]`
- Produces: `_merge_proposals(failure_batches, success_batches, skill, lr, api_key, token_counter) -> list[Edit]`

- [ ] **Step 1: Add model constants to `skillopt.py` model config section**

After `_SEED_MODEL`:

```python
_ANALYST_MODEL = "google/gemini-2.0-flash"
_MERGE_MODEL = "google/gemini-2.0-flash"
```

- [ ] **Step 2: Add `_format_edit_batch` helper** (after `_format_traces`)

```python
def _format_edit_batch(edits: list[Edit]) -> str:
    if not edits:
        return "(none)"
    return "\n".join(
        f"[{e.op}] target={e.target!r} content={(e.content or '')[:120]!r}"
        for e in edits
    )
```

- [ ] **Step 3: Add `_analyze_failures` function** (after `_reflect_and_propose`, which will be removed in Task 10)

```python
async def _analyze_failures(
    current_skill: str,
    failures: list[Trace],
    rejected_edits: list[Edit],
    meta_notes: list[str],
    lr_budget: int,
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[Edit]:
    """Analyze failure traces and propose fix patches (source='failure')."""
    if not failures:
        return []
    llm = _build(_ANALYST_MODEL, temperature=0.5, max_tokens=600, api_key=api_key)

    rejected_block = ""
    if rejected_edits:
        lines = "\n".join(
            f"- [{e.op}] {e.content or e.target or '(no text)'}: {e.rationale}"
            for e in rejected_edits[-8:]
        )
        rejected_block = REJECTED_EDITS_BLOCK.format(rejected_list=lines)

    meta_block = ""
    if meta_notes:
        meta_block = "\nMETA LESSONS:\n" + "\n".join(f"- {n}" for n in meta_notes[-5:])

    try:
        resp = await llm.ainvoke(
            [
                {
                    "role": "system",
                    "content": ANALYST_FAILURE_SYSTEM.format(
                        lr_budget=lr_budget,
                        rejected_edits_block=rejected_block + meta_block,
                    ),
                },
                {
                    "role": "user",
                    "content": ANALYST_FAILURE_USER.format(
                        current_skill=current_skill[:2000],
                        n_failure=len(failures),
                        failure_traces=_format_traces(failures),
                        lr_budget=lr_budget,
                    ),
                },
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        obj = _json_safe(str(resp.content))
        return [
            Edit(
                op=str(e.get("op", "ADD")).upper(),
                target=e.get("target") or None,
                content=e.get("content") or None,
                rationale=str(e.get("rationale", ""))[:200],
                source="failure",
            )
            for e in obj.get("edits", [])[:lr_budget]
            if isinstance(e, dict) and str(e.get("op", "")).upper() in ("ADD", "DELETE", "REPLACE")
        ]
    except Exception as exc:
        _log.warning("analyze_failures_failed", error=str(exc))
        return []
```

- [ ] **Step 4: Add `_analyze_successes` function** (after `_analyze_failures`)

```python
async def _analyze_successes(
    current_skill: str,
    successes: list[Trace],
    meta_notes: list[str],
    lr_budget: int,
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[Edit]:
    """Analyze success traces and propose reinforcement patches (source='success')."""
    if not successes:
        return []
    llm = _build(_ANALYST_MODEL, temperature=0.5, max_tokens=600, api_key=api_key)

    meta_block = ""
    if meta_notes:
        meta_block = "\nMETA LESSONS:\n" + "\n".join(f"- {n}" for n in meta_notes[-5:])

    try:
        resp = await llm.ainvoke(
            [
                {
                    "role": "system",
                    "content": ANALYST_SUCCESS_SYSTEM.format(
                        lr_budget=lr_budget,
                    )
                    + meta_block,
                },
                {
                    "role": "user",
                    "content": ANALYST_SUCCESS_USER.format(
                        current_skill=current_skill[:2000],
                        n_success=len(successes),
                        success_traces=_format_traces(successes),
                        lr_budget=lr_budget,
                    ),
                },
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        obj = _json_safe(str(resp.content))
        return [
            Edit(
                op=str(e.get("op", "ADD")).upper(),
                target=e.get("target") or None,
                content=e.get("content") or None,
                rationale=str(e.get("rationale", ""))[:200],
                source="success",
            )
            for e in obj.get("edits", [])[:lr_budget]
            if isinstance(e, dict) and str(e.get("op", "")).upper() in ("ADD", "REPLACE")
        ]
    except Exception as exc:
        _log.warning("analyze_successes_failed", error=str(exc))
        return []
```

- [ ] **Step 5: Add `_merge_proposals` function** (after `_analyze_successes`)

```python
async def _merge_proposals(
    failure_batches: list[list[Edit]],
    success_batches: list[list[Edit]],
    current_skill: str,
    lr_budget: int,
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[Edit]:
    """Hierarchical merge: merge failure sets → merge success sets → combine, failure-prioritized."""

    async def _merge_set(
        batches: list[list[Edit]],
        source: str,
        system: str,
        user_tpl: str,
    ) -> list[Edit]:
        if not batches:
            return []
        if len(batches) == 1:
            return batches[0]
        llm = _build(_MERGE_MODEL, temperature=0.3, max_tokens=600, api_key=api_key)
        batch_text = "\n\n".join(
            f"Batch {i + 1}:\n{_format_edit_batch(b)}" for i, b in enumerate(batches)
        )
        try:
            resp = await llm.ainvoke(
                [
                    {"role": "system", "content": system.format(lr_budget=lr_budget)},
                    {
                        "role": "user",
                        "content": user_tpl.format(
                            n_batches=len(batches),
                            edit_batches=batch_text,
                            lr_budget=lr_budget,
                        ),
                    },
                ]
            )
            if token_counter is not None:
                meta = getattr(resp, "usage_metadata", None)
                if meta:
                    token_counter[0] += meta.get("total_tokens", 0) or 0
            obj = _json_safe(str(resp.content))
            return [
                Edit(
                    op=str(e.get("op", "ADD")).upper(),
                    target=e.get("target") or None,
                    content=e.get("content") or None,
                    rationale=str(e.get("rationale", ""))[:200],
                    source=source,
                )
                for e in obj.get("edits", [])[:lr_budget]
                if isinstance(e, dict)
            ]
        except Exception as exc:
            _log.warning("merge_set_failed", source=source, error=str(exc))
            return [e for batch in batches for e in batch]

    merged_failure = await _merge_set(
        failure_batches, "failure", MERGE_FAILURE_SYSTEM, MERGE_FAILURE_USER
    )
    merged_success = await _merge_set(
        success_batches, "success", MERGE_SUCCESS_SYSTEM, MERGE_SUCCESS_USER
    )

    if not merged_failure:
        return _rank_edits(merged_success, lr_budget)
    if not merged_success:
        return _rank_edits(merged_failure, lr_budget)

    # Final merge combining both sets, failure-prioritized
    llm = _build(_MERGE_MODEL, temperature=0.3, max_tokens=600, api_key=api_key)
    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": MERGE_FINAL_SYSTEM.format(lr_budget=lr_budget)},
                {
                    "role": "user",
                    "content": MERGE_FINAL_USER.format(
                        failure_edits=_format_edit_batch(merged_failure),
                        success_edits=_format_edit_batch(merged_success),
                        current_skill=current_skill[:1000],
                        lr_budget=lr_budget,
                    ),
                },
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        obj = _json_safe(str(resp.content))
        final: list[Edit] = []
        for e in obj.get("edits", [])[:lr_budget]:
            if not isinstance(e, dict):
                continue
            op = str(e.get("op", "ADD")).upper()
            if op not in ("ADD", "DELETE", "REPLACE"):
                continue
            src = str(e.get("source", "failure"))
            if src not in ("failure", "success"):
                src = "failure"
            final.append(
                Edit(
                    op=op,
                    target=e.get("target") or None,
                    content=e.get("content") or None,
                    rationale=str(e.get("rationale", ""))[:200],
                    source=src,
                )
            )
        return final if final else _rank_edits(merged_failure + merged_success, lr_budget)
    except Exception as exc:
        _log.warning("merge_final_failed", error=str(exc))
        return _rank_edits(merged_failure + merged_success, lr_budget)
```

- [ ] **Step 6: Write unit tests**

Add to `tests/unit/skill_opt/test_core.py`:

```python
from unittest.mock import MagicMock, AsyncMock, patch
from promptly.skill_opt.core.skillopt import (
    _analyze_failures, _analyze_successes, _merge_proposals, Trace, Example, Edit
)


def _make_trace(score: float) -> Trace:
    return Trace(
        example=Example(input="q", expected="a"),
        output="o",
        score=score,
        feedback="ok",
    )


async def test_analyze_failures_returns_empty_for_no_failures():
    result = await _analyze_failures("skill", [], [], [], 3, "key")
    assert result == []


async def test_analyze_successes_returns_empty_for_no_successes():
    result = await _analyze_successes("skill", [], [], 3, "key")
    assert result == []


async def test_analyze_failures_tags_edits_as_failure():
    mock_resp = MagicMock()
    mock_resp.content = '{"analysis": "ok", "edits": [{"op": "ADD", "target": null, "content": "fix", "rationale": "r"}]}'
    mock_resp.usage_metadata = None
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    with patch("promptly.skill_opt.core.skillopt._build", return_value=mock_llm):
        edits = await _analyze_failures("skill", [_make_trace(0.2)], [], [], 3, "key")

    assert all(e.source == "failure" for e in edits)


async def test_analyze_successes_tags_edits_as_success():
    mock_resp = MagicMock()
    mock_resp.content = '{"analysis": "ok", "edits": [{"op": "ADD", "target": null, "content": "reinforce", "rationale": "r"}]}'
    mock_resp.usage_metadata = None
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    with patch("promptly.skill_opt.core.skillopt._build", return_value=mock_llm):
        edits = await _analyze_successes("skill", [_make_trace(0.8)], [], 3, "key")

    assert all(e.source == "success" for e in edits)


async def test_merge_proposals_empty_batches_returns_empty():
    result = await _merge_proposals([], [], "skill", 3, "key")
    assert result == []
```

- [ ] **Step 7: Run tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/test_core.py -v
```

- [ ] **Step 8: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py tests/unit/skill_opt/test_core.py
git commit -m "feat: separate failure/success analyst functions and hierarchical merge per paper §3"
```

---

### Task 10: Gap 1 — Wire analysts into optimization loop

**Files:**
- Modify: `src/promptly/skill_opt/core/skillopt.py`

- [ ] **Step 1: Replace the reflection loop body in `optimize_skill`**

Find the existing minibatch loop (around lines 580–603):

```python
        all_proposed: list[Edit] = []
        s_chunks = _chunked(successes, reflect_mini)
        f_chunks = _chunked(failures, reflect_mini)
        n_mini = max(len(s_chunks), len(f_chunks), 1)

        for i in range(n_mini):
            s_mb = s_chunks[i] if i < len(s_chunks) else []
            f_mb = f_chunks[i] if i < len(f_chunks) else []
            if not s_mb and not f_mb:
                continue
            edits = await _reflect_and_propose(
                current_skill=current_skill,
                successes=s_mb,
                failures=f_mb,
                rejected_edits=rejected_edit_buffer,
                meta_notes=meta_notes,
                lr_budget=lr,
                api_key=api_key,
                token_counter=token_counter,
            )
            all_proposed.extend(edits)

            if cancel_check and await cancel_check():
                raise InterruptedError("Cancelled by user.")

        ranked = _rank_edits(all_proposed, lr)
```

Replace with:

```python
        failure_edit_batches: list[list[Edit]] = []
        success_edit_batches: list[list[Edit]] = []
        s_chunks = _chunked(successes, reflect_mini)
        f_chunks = _chunked(failures, reflect_mini)
        n_mini = max(len(s_chunks), len(f_chunks), 1)

        for i in range(n_mini):
            s_mb = s_chunks[i] if i < len(s_chunks) else []
            f_mb = f_chunks[i] if i < len(f_chunks) else []
            if not s_mb and not f_mb:
                continue
            if f_mb:
                f_edits = await _analyze_failures(
                    current_skill=current_skill,
                    failures=f_mb,
                    rejected_edits=rejected_edit_buffer,
                    meta_notes=meta_notes,
                    lr_budget=lr,
                    api_key=api_key,
                    token_counter=token_counter,
                )
                failure_edit_batches.append(f_edits)
            if s_mb:
                s_edits = await _analyze_successes(
                    current_skill=current_skill,
                    successes=s_mb,
                    meta_notes=meta_notes,
                    lr_budget=lr,
                    api_key=api_key,
                    token_counter=token_counter,
                )
                success_edit_batches.append(s_edits)
            if cancel_check and await cancel_check():
                raise InterruptedError("Cancelled by user.")

        ranked = await _merge_proposals(
            failure_edit_batches,
            success_edit_batches,
            current_skill,
            lr,
            api_key,
            token_counter,
        )
```

- [ ] **Step 2: Remove `_reflect_and_propose` function** (no longer called anywhere)

Delete the entire `_reflect_and_propose` function (lines ~269–338 in original).

- [ ] **Step 3: Run all skill_opt tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/skill_opt/ -v
```

- [ ] **Step 4: Commit**

```bash
git add src/promptly/skill_opt/core/skillopt.py
git commit -m "feat: wire separate analyst functions and hierarchical merge into optimization loop"
```

---

### Task 11: Data + API layer — `score_test` + minimum 10

**Files:**
- Modify: `src/promptly/skill_opt/data/models.py`
- Modify: `src/promptly/skill_opt/data/repository.py`
- Modify: `src/promptly/skill_opt/api/schemas.py`
- Modify: `src/promptly/skill_opt/api/router.py`
- Modify: `src/promptly/skill_opt/workers/tasks.py`

- [ ] **Step 1: Add `score_test` column to `models.py`**

After the `score_after` line:

```python
    score_test: Mapped[float | None] = mapped_column(Float, nullable=True)
```

- [ ] **Step 2: Add `score_test` param to `repository.py` `set_status()`**

Add to the signature:

```python
        score_test: float | None = None,
```

Add to the body (after the `score_after` block):

```python
        if score_test is not None:
            project.score_test = score_test
```

- [ ] **Step 3: Update `schemas.py`**

In `SetExamplesRequest`, change `min_length=6` → `min_length=10`:

```python
class SetExamplesRequest(BaseModel):
    examples: list[SkillExample] = Field(min_length=10, max_length=500)
```

In `SkillProjectResponse`, add after `score_after`:

```python
    score_test: float | None = None
```

- [ ] **Step 4: Update `router.py` minimum guard**

Find and change:

```python
    if not project.example_count or project.example_count < 6:
```

to:

```python
    if not project.example_count or project.example_count < 10:
```

- [ ] **Step 5: Wire `score_test` through `tasks.py`**

In the `set_status()` call inside `tasks.py`:

```python
                await repo.set_status(
                    project,
                    SkillOptStatus.completed,
                    seed_skill=result["seed_skill"],
                    best_skill=result["best_skill"],
                    score_before=result["score_before"],
                    score_after=result["score_after"],
                    score_test=result.get("score_test"),
                    epochs_run=result["epochs_run"],
                    edits_accepted=result["edits_accepted"],
                    edits_rejected=result["edits_rejected"],
                    example_count=result["example_count"],
                )
```

In the `set_so_job_result()` call, add:

```python
                    "score_test": result.get("score_test"),
```

- [ ] **Step 6: Run lint + typecheck**

```bash
cd qa-chatbot && uv run ruff check src/promptly/skill_opt/ && uv run mypy src/promptly/skill_opt/
```

Fix any issues.

- [ ] **Step 7: Commit**

```bash
git add src/promptly/skill_opt/
git commit -m "feat: add score_test field through model/repo/schema/router/worker stack"
```

---

### Task 12: Alembic migration for `score_test`

**Files:**
- Create: `src/promptly/migrations/versions/f6a7b8c9d0e1_add_score_test_to_skill_opt_projects.py`

- [ ] **Step 1: Generate migration**

```bash
cd qa-chatbot && make migration name=add_score_test_to_skill_opt_projects
```

- [ ] **Step 2: Verify generated file and edit if needed**

Open the generated file. Ensure `upgrade()` contains:

```python
def upgrade() -> None:
    op.add_column(
        "skill_opt_projects",
        sa.Column("score_test", sa.Float(), nullable=True),
    )
```

And `downgrade()` contains:

```python
def downgrade() -> None:
    op.drop_column("skill_opt_projects", "score_test")
```

- [ ] **Step 3: Run migration (requires infra running)**

```bash
cd qa-chatbot && make migrate
```

Expected: `Running upgrade ... -> <rev>, add score_test_to_skill_opt_projects`

- [ ] **Step 4: Run full unit test suite**

```bash
cd qa-chatbot && uv run pytest tests/unit/ -v --tb=short
```

- [ ] **Step 5: Final commit**

```bash
git add src/promptly/migrations/
git commit -m "feat: migrate score_test column onto skill_opt_projects"
```

---

## Self-Review Checklist

- [x] All 7 gaps from spec covered: LR floor ✓, Score cache ✓, D_test split ✓, Protected region ✓, Rewrite mode ✓, Separate analysts + merge ✓, Failure prioritization ✓
- [x] All new LLM calls use `google/gemini-2.0-flash`
- [x] Min examples raised to 10 in router, schema, and `_split_examples`
- [x] `_reflect_and_propose` removed after being replaced by analysts + merge
- [x] `score_test` flows: `optimize_skill` → `tasks.py` → DB + Redis job result → `schemas.py`
- [x] Protected META block preserved through `_apply_edits`, rewrite, and meta-update
- [x] `_meta_update` signature change (returns tuple) handled in the loop
- [x] `Edit.source` default="failure" — existing `_rank_edits` calls unaffected
