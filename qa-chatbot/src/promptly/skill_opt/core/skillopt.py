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
import json
import math
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from promptly.llm._client import _build
from promptly.skill_opt.prompts.system import (
    EXECUTOR_SYSTEM,
    EXECUTOR_USER,
    META_SYSTEM,
    META_USER,
    OPTIMIZER_SYSTEM,
    OPTIMIZER_USER,
    REJECTED_EDITS_BLOCK,
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


# ── Helpers ───────────────────────────────────────────────────────────────────


def _cosine_lr(base: int, epoch: int, total: int) -> int:
    """Cosine decay: lr_budget decreases from base to ceil(base/2) across epochs."""
    if total <= 1:
        return base
    factor = 0.5 * (1 + math.cos(math.pi * epoch / (total - 1)))
    return max(1, round(base * (0.5 + 0.5 * factor)))


def _chunked(lst: list[Any], size: int) -> list[list[Any]]:
    return [lst[i : i + size] for i in range(0, len(lst), size)]


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
        return str(resp.content).strip()
    except Exception as exc:
        _log.warning("seed_generation_failed", error=str(exc))
        return (
            f"# Skill Guide: {task_description[:60]}\n\n"
            "Follow the task instructions carefully.\n"
            "Think step by step before answering.\n"
            "Be concise and accurate."
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
    """Apply ranked edits to the skill document."""
    result = skill
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
    return result.strip()


def _rank_edits(all_edits: list[Edit], budget: int) -> list[Edit]:
    """Deduplicate and rank by frequency; return top-budget edits."""
    seen: dict[str, Edit] = {}
    for e in all_edits:
        key = f"{e.op}::{(e.target or '')[:80]}::{(e.content or '')[:80]}"
        if key in seen:
            seen[key].frequency += 1
        else:
            seen[key] = e
    ranked = sorted(seen.values(), key=lambda x: -x.frequency)
    return ranked[:budget]


async def _meta_update(
    current_skill: str,
    score_before: float,
    score_after: float,
    accepted_edits: list[Edit],
    rejected_edits: list[Edit],
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[str]:
    llm = _build(_OPTIMIZER_MODEL, temperature=0.3, max_tokens=400, api_key=api_key)

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
        notes = []
        for lesson in obj.get("lessons", [])[:5]:
            if isinstance(lesson, dict):
                text = lesson.get("keep") or lesson.get("avoid") or ""
                if text:
                    notes.append(str(text)[:200])
        return notes
    except Exception as exc:
        _log.warning("meta_update_failed", error=str(exc))
        return []


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

    parsed = [Example(input=e["input"], expected=e["expected"]) for e in examples]
    if len(parsed) < 6:
        raise ValueError(f"SkillOpt needs at least 6 examples; got {len(parsed)}.")

    rng = random.Random(42)  # noqa: S311
    rng.shuffle(parsed)
    n_sel = max(3, len(parsed) // 3)
    d_sel = parsed[-n_sel:]
    d_train = parsed[:-n_sel] or parsed

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

    current_skill = await _generate_seed_skill(task_description, parsed[:5], api_key)
    seed_skill = current_skill

    _log.info("skillopt_seed_generated", chars=len(current_skill))

    # Baseline score on D_sel
    current_score = await _score_on_selection(
        current_skill, d_sel, api_key, token_counter, executor_model
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

        candidate_score = await _score_on_selection(candidate_skill, d_sel, api_key, token_counter)

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
            # Keep buffer bounded
            rejected_edit_buffer = rejected_edit_buffer[-20:]

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

        new_meta = await _meta_update(
            current_skill=current_skill,
            score_before=epoch_score_before,
            score_after=current_score,
            accepted_edits=epoch_accepted_edits,
            rejected_edits=list(rejected_edit_buffer),
            api_key=api_key,
            token_counter=token_counter,
        )
        meta_notes = (meta_notes + new_meta)[-10:]  # keep last 10 lessons

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

    _log.info(
        "skillopt_complete",
        score_before=round(float(epoch_results[0]["score_before"]), 3) if epoch_results else 0,
        score_after=round(best_score, 3),
        total_accepted=total_accepted,
        total_rejected=total_rejected,
        total_tokens=token_counter[0],
    )

    return {
        "best_skill": best_skill,
        "seed_skill": seed_skill,
        "score_before": round(float(epoch_results[0]["score_before"]), 4) if epoch_results else 0.0,
        "score_after": round(best_score, 4),
        "epochs_run": n_epochs,
        "edits_accepted": total_accepted,
        "edits_rejected": total_rejected,
        "example_count": len(parsed),
        "epoch_results": epoch_results,
        "total_tokens": token_counter[0],
        "executor_model": executor_model,
    }
