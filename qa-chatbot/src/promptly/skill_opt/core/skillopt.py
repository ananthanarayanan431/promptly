"""
SkillOpt — text-space optimizer for agent skills.

Faithful implementation of arXiv:2605.23904, adapted for web use:
  - Direct-chat harness only (no Codex/Claude Code loops)
  - Smaller batch sizes for cost efficiency
  - Live Redis state for frontend visualization

Algorithm (per epoch):
  1. Rollout   : run examples with current skill → scored traces
  2. Partition : separate successes / failures
  3. Reflect   : optimizer proposes ADD/DELETE/REPLACE edits (per minibatch)
  4. Merge     : aggregate & rank edits under lr_budget
  5. Apply     : build candidate skill
  6. Gate      : validate on D_sel — accept only if strictly improving
  7. Buffer    : rejected edits → negative feedback for next reflection call
  8. Meta      : epoch-end slow/meta update for stable lessons
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from promptly.llm._client import _build
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
    OPTIMIZER_SYSTEM,
    OPTIMIZER_USER,
    REJECTED_EDITS_BLOCK,
    REWRITE_SYSTEM,
    REWRITE_USER,
    SCORER_SYSTEM,
    SCORER_USER,
    SEED_SYSTEM,
    SEED_USER,
)
from promptly.utils.log import get_logger

_log = get_logger(__name__)

# ── Model config ──────────────────────────────────────────────────────────────
# Default models when no llm_effort override is set
_EXECUTOR_MODEL = "anthropic/claude-3.5-haiku"
_OPTIMIZER_MODEL = "openai/gpt-4o-mini"
_SCORER_MODEL = "openai/gpt-4o-mini"
_SEED_MODEL = "openai/gpt-4o-mini"
_REWRITE_MODEL = "google/gemini-2.0-flash"
_ANALYST_MODEL = "google/gemini-2.0-flash"
_MERGE_MODEL = "google/gemini-2.0-flash"

# Per-effort model overrides.
# The EXECUTOR runs every example → its quality directly affects optimization signal.
# The OPTIMIZER + SCORER stay cheap (meta-operations, not critical for quality).
_LLM_EFFORT_EXECUTOR: dict[str, str] = {
    "low": "google/gemini-2.0-flash",  # $0.10/1M — fast & cheap
    "medium": "anthropic/claude-3.5-haiku",  # $0.80/1M — default
    "high": "openai/gpt-4o",  # $2.50/1M — best answer quality
}

# ── Budget tiers ──────────────────────────────────────────────────────────────
TIERS: dict[str, dict[str, int]] = {
    "low": {"epochs": 2, "rollout_batch": 10, "reflect_minibatch": 4, "lr_budget": 3},
    "medium": {"epochs": 3, "rollout_batch": 20, "reflect_minibatch": 4, "lr_budget": 4},
    "high": {"epochs": 4, "rollout_batch": 30, "reflect_minibatch": 6, "lr_budget": 5},
}


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class Example:
    input: str
    expected: str


@dataclass
class Trace:
    example: Example
    output: str
    score: float
    feedback: str


@dataclass
class Edit:
    op: str  # ADD | DELETE | REPLACE
    target: str | None
    content: str | None
    rationale: str
    frequency: int = 1  # how many minibatches proposed this edit
    source: str = "failure"  # "failure" | "success"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _cosine_lr(base: int, epoch: int, total: int) -> int:
    """Cosine decay: lr_budget decreases from base to ceil(base/2) across epochs."""
    if total <= 1:
        return base
    factor = 0.5 * (1 + math.cos(math.pi * epoch / (total - 1)))
    return max(2, round(base * (0.5 + 0.5 * factor)))


def _chunked(lst: list[Any], size: int) -> list[list[Any]]:
    return [lst[i : i + size] for i in range(0, len(lst), size)]


def _score_cache_key(skill: str, d_sel: list[Example]) -> str:
    sel_repr = "|".join(f"{e.input}:{e.expected}" for e in d_sel)
    return hashlib.sha256((skill + "\x00" + sel_repr).encode()).hexdigest()[:16]


async def _score_on_selection_cached(
    skill: str,
    d_sel: list[Example],
    cache: dict[str, float],
    api_key: str,
    token_counter: list[int] | None = None,
    executor_model: str = _EXECUTOR_MODEL,
) -> float:
    key = _score_cache_key(skill, d_sel)
    if key in cache:
        _log.debug("score_cache_hit", key=key)
        return cache[key]
    score = await _score_on_selection(skill, d_sel, api_key, token_counter, executor_model)
    cache[key] = score
    return score


_META_START = "<!-- META:START -->"
_META_END = "<!-- META:END -->"


def _extract_protected(skill: str) -> tuple[str, str]:
    """Return (editable_part, protected_block). Protected block starts at the --- separator
    before META:START, or at META:START itself if no separator is found."""
    idx = skill.find(_META_START)
    if idx == -1:
        return skill, ""
    pre = skill[:idx]
    sep_idx = pre.rfind("\n---\n")
    cut = (sep_idx + 1) if sep_idx != -1 else idx
    return skill[:cut].rstrip(), skill[cut:]


def _restore_protected(editable: str, protected: str) -> str:
    if not protected:
        return editable
    return editable.rstrip() + "\n\n" + protected.lstrip()


def _split_examples(
    raw: list[dict[str, str]], seed: int = 42
) -> tuple[list[Example], list[Example], list[Example]]:
    """Shuffle and 3-way split into (d_train, d_sel, d_test). Minimum 10 examples required."""
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


def _format_traces(traces: list[Trace], max_per: int = 3) -> str:
    out = []
    for i, t in enumerate(traces[:max_per]):
        out.append(
            f"[{i + 1}] INPUT: {t.example.input[:300]}\n"
            f"    OUTPUT: {t.output[:400]}\n"
            f"    SCORE: {t.score:.2f}  FEEDBACK: {t.feedback}"
        )
    return "\n\n".join(out) if out else "(none)"


def _json_safe(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    start, end = text.find("{"), text.rfind("}") + 1
    if start != -1 and end > start:
        text = text[start:end]
    result: dict[str, Any] = json.loads(text)
    return result


# ── Core LLM calls ────────────────────────────────────────────────────────────


async def _generate_seed_skill(
    task_description: str,
    examples: list[Example],
    api_key: str,
) -> str:
    llm = _build(_SEED_MODEL, temperature=0.7, max_tokens=600, api_key=api_key)
    sample = "\n".join(f"- {e.input[:120]}" for e in examples[:5])
    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": SEED_SYSTEM},
                {
                    "role": "user",
                    "content": SEED_USER.format(
                        task_description=task_description, sample_inputs=sample
                    ),
                },
            ]
        )
        content = str(resp.content).strip()
        if _META_START not in content or _META_END not in content:
            content = content.split(_META_START)[0].rstrip()
            content += f"\n\n---\n## Consolidated Lessons\n{_META_START}\n{_META_END}"
        return content
    except Exception as exc:
        _log.warning("seed_generation_failed", error=str(exc))
        return (
            f"# Skill Guide: {task_description[:60]}\n\n"
            "Follow the task instructions carefully.\n"
            "Think step by step before answering.\n"
            "Be concise and accurate.\n\n"
            f"---\n## Consolidated Lessons\n{_META_START}\n{_META_END}"
        )


async def _run_executor(
    skill: str,
    example: Example,
    api_key: str,
    token_counter: list[int] | None = None,
    executor_model: str = _EXECUTOR_MODEL,
) -> str:
    llm = _build(executor_model, temperature=0.3, max_tokens=512, api_key=api_key)
    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": EXECUTOR_SYSTEM.format(skill_document=skill)},
                {"role": "user", "content": EXECUTOR_USER.format(task_input=example.input)},
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        return str(resp.content).strip()
    except Exception as exc:
        _log.warning("executor_failed", error=str(exc))
        return ""


async def _score_answer(
    example: Example,
    output: str,
    api_key: str,
    token_counter: list[int] | None = None,
) -> tuple[float, str]:
    llm = _build(_SCORER_MODEL, temperature=0.0, max_tokens=120, api_key=api_key)
    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": SCORER_SYSTEM},
                {
                    "role": "user",
                    "content": SCORER_USER.format(
                        task_input=example.input,
                        expected_output=example.expected,
                        model_output=output or "(empty)",
                    ),
                },
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        obj = _json_safe(str(resp.content))
        return max(0.0, min(1.0, float(obj.get("score", 0.3)))), str(obj.get("feedback", ""))
    except Exception as exc:
        _log.warning("scorer_failed", error=str(exc))
        return 0.3, "Scoring failed."


async def _run_and_score(
    skill: str,
    example: Example,
    api_key: str,
    token_counter: list[int] | None = None,
    executor_model: str = _EXECUTOR_MODEL,
) -> Trace:
    output = await _run_executor(skill, example, api_key, token_counter, executor_model)
    score, feedback = await _score_answer(example, output, api_key, token_counter)
    return Trace(example=example, output=output, score=score, feedback=feedback)


async def _rollout_batch(
    skill: str,
    batch: list[Example],
    api_key: str,
    token_counter: list[int] | None = None,
    executor_model: str = _EXECUTOR_MODEL,
) -> list[Trace]:
    tasks = [_run_and_score(skill, ex, api_key, token_counter, executor_model) for ex in batch]
    return list(await asyncio.gather(*tasks))


async def _score_on_selection(
    skill: str,
    d_sel: list[Example],
    api_key: str,
    token_counter: list[int] | None = None,
    executor_model: str = _EXECUTOR_MODEL,
) -> float:
    if not d_sel:
        return 0.0
    traces = list(
        await asyncio.gather(
            *[_run_and_score(skill, ex, api_key, token_counter, executor_model) for ex in d_sel]
        )
    )
    return sum(t.score for t in traces) / len(traces)


async def _reflect_and_propose(
    current_skill: str,
    successes: list[Trace],
    failures: list[Trace],
    rejected_edits: list[Edit],
    meta_notes: list[str],
    lr_budget: int,
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[Edit]:
    llm = _build(_OPTIMIZER_MODEL, temperature=0.5, max_tokens=800, api_key=api_key)

    rejected_block = ""
    if rejected_edits:
        lines = "\n".join(
            f"- [{e.op}] {e.content or e.target or '(no text)'}: {e.rationale}"
            for e in rejected_edits[-8:]  # last 8 to stay within context
        )
        rejected_block = REJECTED_EDITS_BLOCK.format(rejected_list=lines)

    meta_block = ""
    if meta_notes:
        meta_block = "\nMETA-SKILL LESSONS FROM PREVIOUS EPOCHS:\n" + "\n".join(
            f"- {n}" for n in meta_notes[-5:]
        )

    system = OPTIMIZER_SYSTEM.format(
        lr_budget=lr_budget,
        rejected_edits_block=rejected_block + meta_block,
    )
    user = OPTIMIZER_USER.format(
        current_skill=current_skill[:2000],
        n_success=len(successes),
        success_traces=_format_traces(successes),
        n_failure=len(failures),
        failure_traces=_format_traces(failures),
        lr_budget=lr_budget,
    )

    try:
        resp = await llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        if token_counter is not None:
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                token_counter[0] += meta.get("total_tokens", 0) or 0
        obj = _json_safe(str(resp.content))
        edits = []
        for e in obj.get("edits", [])[:lr_budget]:
            if not isinstance(e, dict):
                continue
            op = str(e.get("op", "ADD")).upper()
            if op not in ("ADD", "DELETE", "REPLACE"):
                continue
            edits.append(
                Edit(
                    op=op,
                    target=e.get("target") or None,
                    content=e.get("content") or None,
                    rationale=str(e.get("rationale", ""))[:200],
                )
            )
        return edits
    except Exception as exc:
        _log.warning("optimizer_failed", error=str(exc))
        return []


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
        updated_protected: str = str(obj.get("updated_protected") or protected)
        if _META_START not in updated_protected or _META_END not in updated_protected:
            updated_protected = protected
        return notes, updated_protected
    except Exception as exc:
        _log.warning("meta_update_failed", error=str(exc))
        return [], protected


async def _rewrite_skill(
    current_skill: str,
    all_traces: list[Trace],
    meta_notes: list[str],
    api_key: str,
    token_counter: list[int] | None = None,
) -> str:
    """Full skill document rewrite for when patch-mode stalls (2+ consecutive rejections)."""
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
        if _META_START not in content or _META_END not in content:
            content = content.split(_META_START)[0].rstrip()
            content += f"\n\n---\n## Consolidated Lessons\n{_META_START}\n{_META_END}"
        return content
    except Exception as exc:
        _log.warning("rewrite_skill_failed", error=str(exc))
        return current_skill


def _format_edit_batch(edits: list[Edit]) -> str:
    if not edits:
        return "(none)"
    return "\n".join(
        f"[{e.op}] target={e.target!r} content={(e.content or '')[:120]!r}" for e in edits
    )


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

    meta_block = (
        "\nMETA LESSONS:\n" + "\n".join(f"- {n}" for n in meta_notes[-5:]) if meta_notes else ""
    )

    try:
        resp = await llm.ainvoke(
            [
                {
                    "role": "system",
                    "content": ANALYST_SUCCESS_SYSTEM.format(lr_budget=lr_budget) + meta_block,
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


async def _merge_proposals(
    failure_batches: list[list[Edit]],
    success_batches: list[list[Edit]],
    current_skill: str,
    lr_budget: int,
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[Edit]:
    """Hierarchical merge: failure sets → success sets → combine failure-prioritized."""

    async def _merge_set(
        batches: list[list[Edit]],
        source: str,
        system_tpl: str,
        user_tpl: str,
    ) -> list[Edit]:
        batches = [b for b in batches if b]
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
                    {"role": "system", "content": system_tpl.format(lr_budget=lr_budget)},
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
                usage = getattr(resp, "usage_metadata", None)
                if usage:
                    token_counter[0] += usage.get("total_tokens", 0) or 0
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
                and str(e.get("op", "")).upper() in ("ADD", "DELETE", "REPLACE")
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
            usage = getattr(resp, "usage_metadata", None)
            if usage:
                token_counter[0] += usage.get("total_tokens", 0) or 0
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


# ── Main entry point ──────────────────────────────────────────────────────────


async def optimize_skill(
    *,
    task_description: str,
    examples: list[dict[str, str]],
    api_key: str,
    budget_tier: str = "medium",
    llm_effort: str | None = None,
    project_id: str | None = None,
    cancel_check: Callable[[], Awaitable[bool]] | None = None,
    emit_state: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """
    Run SkillOpt and return the best skill document.

    Args:
        budget_tier: Controls epochs/rollout count (low/medium/high).
        llm_effort:  Controls which executor model is used (low/medium/high).
                     Low = cheap/fast, Medium = default, High = frontier quality.

    Returns:
        best_skill, seed_skill, score_before, score_after,
        epochs_run, edits_accepted, edits_rejected, example_count,
        epoch_results, total_tokens, executor_model
    """
    tier = TIERS.get(budget_tier, TIERS["medium"])

    # Resolve executor model from llm_effort (falls back to default medium)
    executor_model = _LLM_EFFORT_EXECUTOR.get(llm_effort or "medium", _EXECUTOR_MODEL)
    _log.info("skillopt_models", executor=executor_model, optimizer=_OPTIMIZER_MODEL)
    n_epochs = tier["epochs"]
    rollout_batch = tier["rollout_batch"]
    reflect_mini = tier["reflect_minibatch"]
    lr_base = tier["lr_budget"]

    d_train, d_sel, d_test = _split_examples(examples, seed=42)
    _score_cache: dict[str, float] = {}
    rng = random.Random(42)  # noqa: S311

    token_counter: list[int] = [0]

    # ── Phase 0: Generate seed skill ─────────────────────────────────────────
    if emit_state:
        await emit_state(
            {
                "phase": "seed",
                "epoch": 0,
                "total_epochs": n_epochs,
                "epoch_pct": 0.0,
                "rollout_done": 0,
                "rollout_total": rollout_batch,
                "edits_accepted": 0,
                "edits_rejected": 0,
                "current_score": None,
                "best_score": None,
                "recent_edits": [],
                "current_skill_preview": "",
            }
        )

    current_skill = await _generate_seed_skill(task_description, d_train[:5], api_key)
    seed_skill = current_skill

    _log.info("skillopt_seed_generated", chars=len(current_skill))

    # Baseline score on D_sel
    current_score = await _score_on_selection_cached(
        current_skill, d_sel, _score_cache, api_key, token_counter, executor_model
    )
    best_score = current_score
    best_skill = current_skill

    _log.info("skillopt_baseline", score=round(current_score, 3))

    # ── Optimization loop ─────────────────────────────────────────────────────
    rejected_edit_buffer: list[Edit] = []
    meta_notes: list[str] = []
    epoch_results: list[dict[str, Any]] = []
    total_accepted = 0
    total_rejected = 0
    consecutive_rejections: int = 0
    all_epoch_traces: list[Trace] = []

    for epoch in range(n_epochs):
        lr = _cosine_lr(lr_base, epoch, n_epochs)
        epoch_score_before = current_score
        epoch_accepted_edits: list[Edit] = []
        epoch_proposed_edits: list[Edit] = []

        _log.info("skillopt_epoch_start", epoch=epoch + 1, lr=lr)

        if cancel_check and await cancel_check():
            raise InterruptedError("Cancelled by user.")

        # ── Rollout ───────────────────────────────────────────────────────────
        batch = rng.sample(d_train, min(rollout_batch, len(d_train)))

        if emit_state:
            await emit_state(
                {
                    "phase": "rollout",
                    "epoch": epoch + 1,
                    "total_epochs": n_epochs,
                    "epoch_pct": 0.0,
                    "rollout_done": 0,
                    "rollout_total": len(batch),
                    "edits_accepted": total_accepted,
                    "edits_rejected": total_rejected,
                    "current_score": round(current_score, 3),
                    "best_score": round(best_score, 3),
                    "recent_edits": [],
                    "current_skill_preview": current_skill[:300],
                }
            )

        traces = await _rollout_batch(current_skill, batch, api_key, token_counter, executor_model)

        if cancel_check and await cancel_check():
            raise InterruptedError("Cancelled by user.")

        successes = [t for t in traces if t.score >= 0.5]
        failures = [t for t in traces if t.score < 0.5]

        _log.info(
            "skillopt_rollout_done",
            epoch=epoch + 1,
            n=len(traces),
            success=len(successes),
            failure=len(failures),
            avg_score=round(sum(t.score for t in traces) / len(traces), 3),
        )

        # ── Reflection (per minibatch) ────────────────────────────────────────
        if emit_state:
            await emit_state(
                {
                    "phase": "reflect",
                    "epoch": epoch + 1,
                    "total_epochs": n_epochs,
                    "epoch_pct": 0.4,
                    "rollout_done": len(batch),
                    "rollout_total": len(batch),
                    "edits_accepted": total_accepted,
                    "edits_rejected": total_rejected,
                    "current_score": round(current_score, 3),
                    "best_score": round(best_score, 3),
                    "recent_edits": [],
                    "current_skill_preview": current_skill[:300],
                }
            )

        all_epoch_traces.extend(traces)

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
        epoch_proposed_edits = ranked

        # ── Gate: build candidate and validate ────────────────────────────────
        candidate_skill = _apply_edits(current_skill, ranked)

        if emit_state:
            await emit_state(
                {
                    "phase": "gate",
                    "epoch": epoch + 1,
                    "total_epochs": n_epochs,
                    "epoch_pct": 0.8,
                    "rollout_done": len(batch),
                    "rollout_total": len(batch),
                    "edits_accepted": total_accepted,
                    "edits_rejected": total_rejected,
                    "current_score": round(current_score, 3),
                    "best_score": round(best_score, 3),
                    "recent_edits": [
                        {"op": e.op, "text": (e.content or e.target or "")[:80], "accepted": False}
                        for e in ranked
                    ],
                    "current_skill_preview": candidate_skill[:300],
                }
            )

        if ranked:
            candidate_score = await _score_on_selection_cached(
                candidate_skill, d_sel, _score_cache, api_key, token_counter, executor_model
            )

            if candidate_score > current_score:  # hard gate — strictly improving
                _log.info(
                    "skillopt_edit_accepted",
                    epoch=epoch + 1,
                    score=round(candidate_score, 3),
                    delta=round(candidate_score - current_score, 3),
                )
                current_skill = candidate_skill
                current_score = candidate_score
                epoch_accepted_edits = ranked
                total_accepted += len(ranked)
                consecutive_rejections = 0
                if candidate_score > best_score:
                    best_skill = candidate_skill
                    best_score = candidate_score
            else:
                _log.info(
                    "skillopt_edit_rejected",
                    epoch=epoch + 1,
                    candidate=round(candidate_score, 3),
                    current=round(current_score, 3),
                )
                rejected_edit_buffer.extend(ranked)
                total_rejected += len(ranked)
                rejected_edit_buffer = rejected_edit_buffer[-20:]
                consecutive_rejections += 1
                if consecutive_rejections >= 2:
                    _log.info("skillopt_rewrite_triggered", epoch=epoch + 1)
                    rewrite_candidate = await _rewrite_skill(
                        current_skill, all_epoch_traces, meta_notes, api_key, token_counter
                    )
                    rewrite_score = await _score_on_selection_cached(
                        rewrite_candidate,
                        d_sel,
                        _score_cache,
                        api_key,
                        token_counter,
                        executor_model,
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

        # ── Slow/meta update at epoch boundary ───────────────────────────────
        if emit_state:
            await emit_state(
                {
                    "phase": "slow_update",
                    "epoch": epoch + 1,
                    "total_epochs": n_epochs,
                    "epoch_pct": 0.95,
                    "rollout_done": len(batch),
                    "rollout_total": len(batch),
                    "edits_accepted": total_accepted,
                    "edits_rejected": total_rejected,
                    "current_score": round(current_score, 3),
                    "best_score": round(best_score, 3),
                    "recent_edits": [
                        {
                            "op": e.op,
                            "text": (e.content or e.target or "")[:80],
                            "accepted": e in epoch_accepted_edits,
                        }
                        for e in epoch_proposed_edits
                    ],
                    "current_skill_preview": current_skill[:300],
                }
            )

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

        # Apply updated protected block to current_skill
        if updated_protected:
            editable, _ = _extract_protected(current_skill)
            current_skill = _restore_protected(editable, updated_protected)
            if current_score >= best_score:
                best_skill = current_skill

        epoch_results.append(
            {
                "epoch": epoch + 1,
                "score_before": round(epoch_score_before, 4),
                "score_after": round(current_score, 4),
                "edits_proposed": len(epoch_proposed_edits),
                "edits_accepted": len(epoch_accepted_edits),
                "edits_rejected": len(epoch_proposed_edits) - len(epoch_accepted_edits),
                "rollout_count": len(traces),
            }
        )

    # ── Completed ─────────────────────────────────────────────────────────────
    if emit_state:
        await emit_state(
            {
                "phase": "completed",
                "epoch": n_epochs,
                "total_epochs": n_epochs,
                "epoch_pct": 1.0,
                "rollout_done": 0,
                "rollout_total": 0,
                "edits_accepted": total_accepted,
                "edits_rejected": total_rejected,
                "current_score": round(current_score, 3),
                "best_score": round(best_score, 3),
                "recent_edits": [],
                "current_skill_preview": best_skill[:300],
            }
        )

    score_test = await _score_on_selection_cached(
        best_skill, d_test, _score_cache, api_key, token_counter, executor_model
    )

    _log.info(
        "skillopt_complete",
        score_before=round(float(epoch_results[0]["score_before"]), 3) if epoch_results else 0,
        score_after=round(best_score, 3),
        score_test=round(score_test, 3),
        total_accepted=total_accepted,
        total_rejected=total_rejected,
        total_tokens=token_counter[0],
    )

    total_examples = len(d_train) + len(d_sel) + len(d_test)
    return {
        "best_skill": best_skill,
        "seed_skill": seed_skill,
        "score_before": round(float(epoch_results[0]["score_before"]), 4) if epoch_results else 0.0,
        "score_after": round(best_score, 4),
        "score_test": round(score_test, 4),
        "epochs_run": n_epochs,
        "edits_accepted": total_accepted,
        "edits_rejected": total_rejected,
        "example_count": total_examples,
        "epoch_results": epoch_results,
        "total_tokens": token_counter[0],
        "executor_model": executor_model,
    }
