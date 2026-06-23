# SkillOpt: Paper Gap Implementation

**Date**: 2026-06-23
**Paper**: arXiv:2605.23904
**Status**: Approved for implementation

---

## Overview

Seven concepts from the paper were not yet implemented. This spec covers all of them. All new
LLM calls introduced by this work use `google/gemini-2.0-flash` (cheapest available, ~$0.10/1M
tokens) to keep cost impact minimal.

---

## Gap 1 + 2 — Separate Analyst Prompts + Hierarchical Merge + Failure Prioritization

### Problem

Current code uses one combined `_reflect_and_propose()` call that sees both success and failure
traces in the same prompt. The paper uses:
- `analyst_error.md` — analyzes **failure** traces only, proposes fix patches
- `analyst_success.md` — analyzes **success** traces only, proposes reinforce patches
- `merge_failure.md`, `merge_success.md`, `merge_final.md` — hierarchical merge, failure-prioritized

### Design

**New prompt templates** in `system.py`:
- `ANALYST_FAILURE_SYSTEM` / `ANALYST_FAILURE_USER`
- `ANALYST_SUCCESS_SYSTEM` / `ANALYST_SUCCESS_USER`
- `MERGE_FAILURE_SYSTEM` / `MERGE_FAILURE_USER`
- `MERGE_SUCCESS_SYSTEM` / `MERGE_SUCCESS_USER`
- `MERGE_FINAL_SYSTEM` / `MERGE_FINAL_USER`

**New functions** in `skillopt.py`:
```python
async def _analyze_failures(skill, failure_traces, rejected_edits, meta_notes, lr, api_key, ...) -> list[Edit]
async def _analyze_successes(skill, success_traces, meta_notes, lr, api_key, ...) -> list[Edit]
async def _merge_proposals(failure_edit_batches, success_edit_batches, lr, api_key, ...) -> list[Edit]
```

**Edit dataclass** gains `source: str = "failure"` field (values: `"failure"` | `"success"`).

**`_rank_edits()`** sorts by `(0 if source=="failure" else 1, -frequency)` so failure-fix edits
always rank above success-reinforce edits at equal frequency.

**Loop change**: Replace `_reflect_and_propose()` with:
```python
for i in range(n_mini):
    if f_mb: failure_edit_batches.append(await _analyze_failures(...))
    if s_mb: success_edit_batches.append(await _analyze_successes(...))
ranked = await _merge_proposals(failure_edit_batches, success_edit_batches, lr, ...)
```

**Model**: `google/gemini-2.0-flash` for all 5 new call types.

---

## Gap 3 — Score Cache

### Problem

`_score_on_selection()` always re-runs the full D_sel rollout, even when the candidate skill is
identical to one scored before (e.g., two consecutive gate rejections with the same skill).

### Design

A `dict[str, float]` cache inside `optimize_skill()`, keyed by `sha256(skill_text)[:16]`.

```python
_score_cache: dict[str, float] = {}

async def _score_on_selection_cached(skill, d_sel, cache, ...) -> float:
    key = hashlib.sha256(skill.encode()).hexdigest()[:16]
    if key in cache:
        return cache[key]
    score = await _score_on_selection(skill, d_sel, ...)
    cache[key] = score
    return score
```

Replace all `_score_on_selection()` calls (baseline, gate, final) with the cached version.

---

## Gap 4 — Protected Slow-Update Region

### Problem

`_apply_edits()` can overwrite any part of the skill document, including stable consolidated
lessons written by the meta-updater. The paper reserves a protected markdown section for
epoch-wise consolidation that fast (patch-mode) edits cannot touch.

### Design

**Markers**: `<!-- META:START -->` / `<!-- META:END -->`

**Seed generator** appends this block at the end of every generated skill:
```markdown
---
## Consolidated Lessons
<!-- META:START -->
<!-- META:END -->
```

**Two helpers**:
```python
def _extract_protected(skill: str) -> tuple[str, str]:
    # Returns (editable_part, protected_block_including_markers)

def _restore_protected(editable: str, protected: str) -> str:
    # Returns editable.rstrip() + "\n\n" + protected
```

**`_apply_edits()`** calls `_extract_protected()` before applying edits, operates only on the
editable part, then calls `_restore_protected()` to reassemble.

**`_meta_update()`** returns `(lessons: list[str], updated_protected: str)`. The updated_protected
contains lessons formatted as bullet points inside the META markers. The caller replaces the
protected block in `current_skill` after meta update.

New prompt additions to `META_SYSTEM` / `META_USER`: include the current protected block and
ask the model to return an updated version.

---

## Gap 5 — Rewrite Mode

### Problem

When the skill has degenerated (no edit passes the gate for multiple consecutive epochs), the
paper allows a full rewrite of the skill document to break out of a local minimum. Only patch
mode is currently implemented.

### Design

**Trigger**: `consecutive_rejections >= 2` (tracked as a counter in the optimization loop).

**New prompts**:
- `REWRITE_SYSTEM` / `REWRITE_USER` — receives current skill + all accumulated traces + meta
  notes, returns a fresh full skill document.

**New function**:
```python
async def _rewrite_skill(skill, all_traces, meta_notes, api_key, token_counter) -> str
```

**Loop integration**:
```python
if consecutive_rejections >= 2:
    candidate_skill = await _rewrite_skill(current_skill, all_epoch_traces, meta_notes, ...)
    consecutive_rejections = 0  # reset regardless of gate outcome
    # then apply same gate logic
```

The rewrite candidate still goes through the standard gate (`candidate_score > current_score`).
If it also fails, `current_skill` is unchanged and the loop continues.

**Model**: `google/gemini-2.0-flash`.

---

## Gap 6 — D_test Split + Minimum Examples

### Problem

Only a 2-way split (D_train / D_sel) is used. The paper uses a 3-way split; D_test is a blind
held-out set used only for final reporting.

### Design

**Split logic** (applied after shuffle, deterministic seed=42):
```python
n_test = max(2, len(parsed) // 5)   # ~20%
n_sel  = max(2, len(parsed) // 4)   # ~20%
d_test = parsed[-n_test:]
d_sel  = parsed[-(n_test + n_sel):-n_test]
d_train = parsed[:-(n_test + n_sel)]
```

**Minimum examples**: raised from 6 → **10** everywhere:
- `optimize_skill()` ValueError check
- `router.py` guard (`project.example_count < 10`)

**After optimization loop**: evaluate `best_skill` on `d_test` using the cached scorer.
```python
score_test = await _score_on_selection_cached(best_skill, d_test, _score_cache, ...)
```

**Return dict** gains `score_test: float`.

**DB**: `score_test` float column on `skill_opt_projects` (nullable).

---

## Gap 7 — LR Floor

### Problem

`_cosine_lr()` uses `max(1, ...)`. Paper states default floor is `L_t = 2`.

### Design

One-line fix:
```python
return max(2, round(base * (0.5 + 0.5 * factor)))
```

---

## Files Changed

| File | Change |
|---|---|
| `skill_opt/prompts/system.py` | Add 10 new prompt strings (analyst_failure, analyst_success, merge_failure, merge_success, merge_final, rewrite) + extend META prompts |
| `skill_opt/core/skillopt.py` | Replace `_reflect_and_propose`, add cache, protected region helpers, rewrite mode, d_test split, LR floor fix |
| `skill_opt/api/router.py` | Raise min example guard 6 → 10 |
| `skill_opt/api/schemas.py` | Add `score_test: float \| None` to `SkillJobPollResponse` and `SkillProjectResponse` |
| `skill_opt/workers/tasks.py` | Pass `score_test` into job result and `set_status()` call |
| `skill_opt/data/models.py` | Add `score_test: Mapped[float \| None]` column |
| `skill_opt/data/repository.py` | Accept `score_test` in `set_status()` |
| Migration | `add_score_test_to_skill_opt_projects` |

---

## Model Assignment

| Call type | Model | Reason |
|---|---|---|
| Executor | per `llm_effort` setting | existing — unchanged |
| Scorer | `openai/gpt-4o-mini` | existing — unchanged |
| Seed generator | `openai/gpt-4o-mini` | existing — unchanged |
| **Analyst failure** | `google/gemini-2.0-flash` | new — cheapest |
| **Analyst success** | `google/gemini-2.0-flash` | new — cheapest |
| **Merge failure** | `google/gemini-2.0-flash` | new — cheapest |
| **Merge success** | `google/gemini-2.0-flash` | new — cheapest |
| **Merge final** | `google/gemini-2.0-flash` | new — cheapest |
| **Rewrite** | `google/gemini-2.0-flash` | new — cheapest |

---

## Out of Scope

Everything already noted as intentionally excluded in the original spec:
- Codex / Claude Code CLI harness
- Sleep / offline evolution mode
- Custom benchmark environments
