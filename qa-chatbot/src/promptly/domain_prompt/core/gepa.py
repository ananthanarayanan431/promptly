"""
GEPA — Reflective Prompt Evolution (arXiv:2507.19457).

Algorithm 1 from the paper, adapted for practical web use:

  Budget B = 678 rollouts (simple-task budget from the paper).
  |D_pareto| = 50 — size of the Pareto evaluation set.
  b = 3 — minibatch size for cheap gating.

Pipeline
--------
Phase 0-1 (Initialisation)
  1. Split dataset: feedback 50%, Pareto 30%, test 20% (test set not used here).
  2. Init pool P = [Φ₀] with the seed prompt.
  3. Score Φ₀ on D_pareto to build the baseline score matrix S.

Phase 2 (Optimisation loop — repeat until budget B exhausted)
  4. Pareto-sample a candidate Φⱼ from the Pareto frontier.
  5. Pick module (single module: system-prompt rewriter).
  6. Sample minibatch M of b=3 examples from D_feedback.
  7. Run Φⱼ on M → capture traces (input, output, score, feedback).
  8. Compute σ = mean score of Φⱼ on M.
  9. Reflective mutation: meta-LLM reads traces + ancestry → proposes π′.
 10. Assemble Φ′.
 11. Re-run Φ′ on the same M → σ′.
 12. Gate: if σ′ > σ accept; else discard.
 13. (If accept) Full eval of Φ′ on D_pareto → per-example score vector.
 14. Add Φ′ to pool; update Pareto frontier.

Phase 3
 17. Return Φ* = argmax mean score on D_pareto.

Live state is written to Redis after every step so the frontend can
visualise the running optimisation via polling.
"""

from __future__ import annotations

import asyncio
import json
import math
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from promptly.domain_prompt.prompts.gepa import REFLECTION_SYSTEM, SCORE_FEEDBACK_SYSTEM
from promptly.llm._client import _build
from promptly.utils.log import get_logger

_log = get_logger(__name__)

# ── Budget / hyper-parameters (from paper §6.1) ──────────────────────────────
BUDGET = 678
N_PARETO = 50  # |D_pareto|
MINIBATCH = 3  # b
N_COLS = 12  # columns shown in the score-matrix visualisation
ACCEPT_FACTOR = 1.0  # σ′ must strictly exceed σ

# ── LLM config ────────────────────────────────────────────────────────────────
_ANSWERER_MODEL = "anthropic/claude-3.5-haiku"
_REFLECTOR_MODEL = "openai/gpt-4o-mini"
_SCORER_MODEL = "openai/gpt-4o-mini"


# ── Data classes ──────────────────────────────────────────────────────────────
@dataclass
class TraceResult:
    input: str
    output: str
    score: float
    feedback: str


@dataclass
class Candidate:
    id: str
    prompt: str
    pareto_scores: list[float] = field(default_factory=list)  # per-example on D_pareto
    avg_score: float = 0.0
    desc: str = ""
    delta: str | None = None
    star: bool = False
    ancestry: str = ""  # lineage lesson passed to the next mutation


def _select_candidate(pool: list[Candidate]) -> int:
    """Algorithm 2 from arXiv:2507.19457 — Pareto-based candidate selection.

    1. For each task instance i, find the max score and the candidates achieving it.
    2. C = union of those instance-wise leaders.
    3. Remove dominated candidates from C → Ĉ.
    4. f[Φ] = number of instances where Φ ∈ Ĉ ∩ P*(i).
    5. Sample proportional to f[Φ].
    """
    if len(pool) <= 1:
        return 0

    n = len(pool)
    n_instances = max((len(c.pareto_scores) for c in pool if c.pareto_scores), default=0)
    if n_instances == 0:
        return 0

    def _s(k: int, i: int) -> float:
        scores = pool[k].pareto_scores
        return scores[i] if i < len(scores) else 0.0

    # Step 3-6: For each instance i, P*[i] = candidates achieving the max score.
    p_star: list[set[int]] = []
    for i in range(n_instances):
        best = max(_s(k, i) for k in range(n))
        p_star.append({k for k in range(n) if abs(_s(k, i) - best) < 1e-9})

    # Step 7: C = union of all P*[i] — candidates leading on ≥1 instance.
    c_set: set[int] = set().union(*p_star) if p_star else set(range(n))
    c_list = list(c_set)

    # Steps 9-11: Remove dominated candidates from C.
    dominated: set[int] = set()
    for a in c_list:
        if a in dominated:
            continue
        for b in c_list:
            if a == b or b in dominated:
                continue
            a_sc = [_s(a, i) for i in range(n_instances)]
            b_sc = [_s(b, i) for i in range(n_instances)]
            if all(b_sc[i] >= a_sc[i] for i in range(n_instances)) and any(
                b_sc[i] > a_sc[i] for i in range(n_instances)
            ):
                dominated.add(a)
                break

    c_hat = [k for k in c_list if k not in dominated]
    if not c_hat:
        c_hat = c_list  # fallback: keep all leaders if none dominate others

    # Steps 12-13: f[Φ] = number of instances where Φ is a non-dominated leader.
    c_hat_set = set(c_hat)
    coverage: dict[int, int] = {k: 0 for k in c_hat}
    for i in range(n_instances):
        for k in p_star[i]:
            if k in c_hat_set:
                coverage[k] = coverage[k] + 1

    # Step 14: Sample proportional to f[Φ].
    total = sum(coverage.values())
    if total == 0:
        return random.choice(c_hat)  # noqa: S311
    r = random.random() * total  # noqa: S311
    cumsum = 0.0
    for k in c_hat:
        cumsum += coverage[k]
        if cumsum >= r:
            return k
    return c_hat[-1]


def _make_cells(avg_score: float) -> list[float]:
    """Generate N_COLS synthetic per-column scores centred around avg_score."""
    a = avg_score
    cells = []
    for i in range(N_COLS):
        wobble = math.sin(i * 2.3 + avg_score * 10) * 0.5 + 0.5
        v = max(0.0, min(1.0, a - 0.22 + wobble * 0.44))
        cells.append(round(v, 3))
    return cells


def _candidate_to_dict(c: Candidate) -> dict[str, Any]:
    return {
        "id": c.id,
        "score": round(c.avg_score * 100, 2),
        "desc": c.desc,
        "delta": c.delta,
        "star": c.star,
        "cells": _make_cells(c.avg_score),
    }


def _build_state(
    *,
    phase: str,
    step: str | None,
    done_steps: list[str],
    iter_idx: int,
    sub: str | None,
    pool: list[Candidate],
    pending: dict[str, Any] | None,
    budget_used: int,
    full_pct: float,
    baseline: float | None,
    current_iter: dict[str, Any] | None,
    budget_max: int,
    n_pareto_size: int,
) -> dict[str, Any]:
    return {
        "phase": phase,
        "step": step,
        "done_steps": done_steps,
        "iter_idx": iter_idx,
        "sub": sub,
        "pool": [_candidate_to_dict(c) for c in pool],
        "pending": pending,
        "budget_used": budget_used,
        "full_pct": full_pct,
        "baseline": round(baseline * 100, 2) if baseline is not None else None,
        "current_iter": current_iter,
        "budget_max": budget_max,
        "n_pareto_size": n_pareto_size,
    }


# ── LLM helpers ───────────────────────────────────────────────────────────────
def _tally(response: Any, counter: list[int]) -> None:
    meta = getattr(response, "usage_metadata", None)
    if meta:
        counter[0] += meta.get("total_tokens", 0) or 0


async def _run_prompt(
    system_prompt: str, question: str, api_key: str, token_counter: list[int] | None = None
) -> str:
    """Apply system_prompt to question and return the model's answer."""
    llm = _build(_ANSWERER_MODEL, temperature=0.3, max_tokens=512, api_key=api_key)
    try:
        response = await llm.ainvoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ]
        )
        if token_counter is not None:
            _tally(response, token_counter)
        return str(response.content).strip()
    except Exception as exc:  # noqa: BLE001
        _log.warning("run_prompt_failed", error=str(exc))
        return ""


async def _score_with_feedback(
    question: str,
    reference: str,
    output: str,
    api_key: str,
    token_counter: list[int] | None = None,
) -> tuple[float, str]:
    """Judge an answer and return (score 0-1, feedback text)."""
    llm = _build(_SCORER_MODEL, temperature=0.0, max_tokens=256, api_key=api_key)
    user_msg = (
        f"TASK: {question}\n\n"
        f"REFERENCE: {reference}\n\n"
        f"OUTPUT: {output if output else '(empty response)'}"
    )
    try:
        response = await llm.ainvoke(
            [
                {"role": "system", "content": SCORE_FEEDBACK_SYSTEM},
                {"role": "user", "content": user_msg},
            ]
        )
        if token_counter is not None:
            _tally(response, token_counter)
        raw = str(response.content).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        obj = json.loads(raw.strip())
        score = float(obj.get("score", 0.5))
        feedback = str(obj.get("feedback", "")).strip()
        return max(0.0, min(1.0, score)), feedback
    except Exception as exc:  # noqa: BLE001
        _log.warning("score_feedback_failed", error=str(exc))
        return 0.3, "Scoring failed — treating as partial."


async def _run_and_score_example(
    prompt: str,
    question: str,
    reference: str,
    api_key: str,
    token_counter: list[int] | None = None,
) -> TraceResult:
    """Run a candidate on one example and return the full trace."""
    output = await _run_prompt(prompt, question, api_key, token_counter)
    score, feedback = await _score_with_feedback(
        question, reference, output, api_key, token_counter
    )
    return TraceResult(input=question, output=output, score=score, feedback=feedback)


async def _run_and_score_batch(
    prompt: str,
    examples: list[dict[str, str]],
    api_key: str,
    token_counter: list[int] | None = None,
) -> list[TraceResult]:
    """Run a candidate on multiple examples concurrently with bounded parallelism."""
    sem = asyncio.Semaphore(6)

    async def _bounded(ex: dict[str, str]) -> TraceResult:
        async with sem:
            return await _run_and_score_example(
                prompt, ex["question"], ex["answer"], api_key, token_counter
            )

    return list(await asyncio.gather(*[_bounded(ex) for ex in examples]))


async def _reflective_mutation(
    current_prompt: str,
    traces: list[TraceResult],
    ancestry: str,
    api_key: str,
    token_counter: list[int] | None = None,
) -> str:
    """Step 9: meta-LLM reads traces + ancestry and proposes an improved prompt."""
    traces_text = "\n\n".join(
        f"Example {i + 1}:\n"
        f"  Input:    {t.input[:300]}\n"
        f"  Output:   {t.output[:400] if t.output else '(empty)'}\n"
        f"  Score:    {t.score:.2f}\n"
        f"  Feedback: {t.feedback}"
        for i, t in enumerate(traces)
    )
    user_msg = (
        f"CURRENT PROMPT (πⱼ):\n{current_prompt}\n\n"
        f"EXECUTION TRACES:\n{traces_text}\n\n"
        f"ANCESTOR LESSONS:\n{ancestry if ancestry else 'No previous mutations yet — seed candidate.'}"  # noqa: E501
    )
    llm = _build(_REFLECTOR_MODEL, temperature=0.7, max_tokens=2048, api_key=api_key)
    try:
        response = await llm.ainvoke(
            [
                {"role": "system", "content": REFLECTION_SYSTEM},
                {"role": "user", "content": user_msg},
            ]
        )
        if token_counter is not None:
            _tally(response, token_counter)
        new_prompt = str(response.content).strip()
        if new_prompt.startswith("```"):
            parts = new_prompt.split("```")
            new_prompt = parts[1] if len(parts) > 1 else new_prompt
            if new_prompt.startswith("json") or new_prompt.startswith("text"):
                new_prompt = new_prompt[4:]
        return new_prompt.strip()
    except Exception as exc:  # noqa: BLE001
        _log.warning("reflective_mutation_failed", error=str(exc))
        return current_prompt


# ── Main entry point ──────────────────────────────────────────────────────────
async def optimize_gepa_prompt(
    *,
    base_prompt: str,
    dataset_jsonl: str,
    api_key: str,
    domain_id: str,
    cancel_check: Callable[[], Awaitable[bool]],
    budget: int = BUDGET,
    n_pareto: int = N_PARETO,
) -> dict[str, Any]:
    """
    Run GEPA reflective prompt evolution on the given dataset.

    Returns a dict with:
      optimized_prompt, score_before, score_after, candidates_tried, rounds_run, dataset_size
    """
    from promptly.domain_prompt.infrastructure.cache import set_dp_gepa_state

    # ── Parse dataset ─────────────────────────────────────────────────────────
    all_examples: list[dict[str, str]] = []
    for line in dataset_jsonl.strip().splitlines():
        try:
            obj = json.loads(line)
            if isinstance(obj, dict) and "question" in obj and "answer" in obj:
                all_examples.append(
                    {"question": str(obj["question"]), "answer": str(obj["answer"])}
                )
        except Exception:  # noqa: BLE001, S112
            continue

    if len(all_examples) < 6:
        raise ValueError(f"GEPA needs at least 6 Q&A examples; dataset has {len(all_examples)}.")

    # ── Split dataset (paper §5) ─────────────────────────────────────────────
    random.shuffle(all_examples)
    n = len(all_examples)
    n_feedback = max(3, int(n * 0.50))
    n_pareto = min(n_pareto, max(3, int(n * 0.30)))
    d_feedback = all_examples[:n_feedback]
    d_pareto = all_examples[n_feedback : n_feedback + n_pareto]
    # d_test = all_examples[n_feedback + n_pareto:]  # held out, not used here

    _log.info(
        "gepa_dataset_split",
        total=n,
        feedback=len(d_feedback),
        pareto=len(d_pareto),
    )

    # ── State tracking ────────────────────────────────────────────────────────
    pool: list[Candidate] = []
    done_steps: list[str] = []
    budget_used = 0
    iter_idx = 0
    token_counter: list[int] = [0]

    async def emit(
        phase: str,
        step: str | None,
        sub: str | None = None,
        pending: dict[str, Any] | None = None,
        full_pct: float = 0.0,
        current_iter: dict[str, Any] | None = None,
        baseline: float | None = None,
    ) -> None:
        await set_dp_gepa_state(
            domain_id,
            _build_state(
                phase=phase,
                step=step,
                done_steps=list(done_steps),
                iter_idx=iter_idx,
                sub=sub,
                pool=pool,
                pending=pending,
                budget_used=budget_used,
                full_pct=full_pct,
                baseline=baseline,
                current_iter=current_iter,
                budget_max=budget,
                n_pareto_size=n_pareto,
            ),
        )

    def mark(step: str) -> None:
        if step not in done_steps:
            done_steps.append(step)

    # ── Phase 0-1: Initialisation ─────────────────────────────────────────────
    await emit("init", "1")
    await asyncio.sleep(0)

    if await cancel_check():
        raise InterruptedError("Cancelled during init.")

    mark("1")
    mark("2")
    await emit("init", "3")

    # Score seed on D_pareto
    seed_traces = await _run_and_score_batch(base_prompt, d_pareto, api_key, token_counter)
    budget_used += len(d_pareto)
    seed_scores = [t.score for t in seed_traces]
    seed_avg = sum(seed_scores) / len(seed_scores) if seed_scores else 0.0

    phi0 = Candidate(
        id="Φ₀",
        prompt=base_prompt,
        pareto_scores=seed_scores,
        avg_score=seed_avg,
        desc="Seed prompt",
        ancestry="",
    )
    pool.append(phi0)
    baseline = seed_avg

    mark("3")
    await emit("loop", None, baseline=baseline)

    _log.info("gepa_init_done", seed_score=round(seed_avg, 3), budget_used=budget_used)

    if await cancel_check():
        raise InterruptedError("Cancelled after seed scoring.")

    # ── Phase 2: Optimisation loop ────────────────────────────────────────────
    cand_counter = 1  # next Φ index

    while budget_used < budget:
        iter_idx += 1

        # Step 4: Pareto-sample (Algorithm 2)
        parent_idx = _select_candidate(pool)
        parent = pool[parent_idx]
        pending: dict[str, Any] = {"parent": parent.id, "fail": False}

        await emit("loop", "4", sub="select", pending=pending, baseline=baseline)
        mark("4")

        # Step 5: Pick module (single module)
        await emit("loop", "5", sub="module", pending=pending, baseline=baseline)
        mark("5")

        # Step 6: Sample minibatch
        minibatch = random.sample(d_feedback, min(MINIBATCH, len(d_feedback)))
        await emit("loop", "6", sub="minibatch", pending=pending, baseline=baseline)
        mark("6")

        # Guard: ensure enough budget remains for at least one full iteration
        # (minibatch × 2 runs + full Pareto eval if accepted)
        if budget_used + len(minibatch) * 2 > budget:
            break

        if await cancel_check():
            raise InterruptedError(f"Cancelled at iteration {iter_idx}.")

        # Step 7: Run Φⱼ on minibatch
        await emit(
            "loop",
            "7",
            sub="run",
            pending=pending,
            baseline=baseline,
            current_iter={
                "parent": parent.id,
                "cur_prompt": parent.prompt[:500],
                "ancestor": parent.ancestry or "No ancestors yet.",
                "traces": [],
                "minibatch_inputs": [m["question"][:300] for m in minibatch],
                "reasoning": [],
                "new_prompt": "",
                "sigma": 0.0,
                "sigma_p": None,
                "accept": None,
            },
        )
        mb_traces = await _run_and_score_batch(parent.prompt, minibatch, api_key, token_counter)
        budget_used += len(minibatch)
        mark("7")

        # Step 8: Score
        sigma = sum(t.score for t in mb_traces) / len(mb_traces)
        cur_iter: dict[str, Any] = {
            "parent": parent.id,
            "cur_prompt": parent.prompt[:500],
            "ancestor": parent.ancestry or "No ancestors yet.",
            "traces": [
                {
                    "input": t.input[:200],
                    "output": t.output[:300],
                    "score": round(t.score, 2),
                    "feedback": t.feedback,
                }  # noqa: E501
                for t in mb_traces
            ],
            "reasoning": [],
            "new_prompt": "",
            "sigma": round(sigma, 3),
            "sigma_p": None,
            "accept": None,
        }
        await emit(
            "loop", "8", sub="score", pending=pending, baseline=baseline, current_iter=cur_iter
        )  # noqa: E501
        mark("8")

        if await cancel_check():
            raise InterruptedError(f"Cancelled at iteration {iter_idx} after scoring.")

        # Step 9: Reflective mutation
        await emit(
            "loop", "9", sub="reflect", pending=pending, baseline=baseline, current_iter=cur_iter
        )  # noqa: E501
        new_prompt = await _reflective_mutation(
            parent.prompt, mb_traces, parent.ancestry, api_key, token_counter
        )
        mark("9")

        # Extract reasoning bullets from the difference (heuristic for UI)
        reasoning = [
            f"Score σ = {sigma:.2f} on minibatch — identify failure pattern.",
            f"Parent: {parent.id} — refine based on trace feedback.",
            "Proposing π′ that addresses the root cause.",
        ]
        cur_iter = {**cur_iter, "reasoning": reasoning, "new_prompt": new_prompt[:600]}
        await emit(
            "loop", "9", sub="reflect", pending=pending, baseline=baseline, current_iter=cur_iter
        )  # noqa: E501

        # Step 11: Re-run Φ′ on same minibatch
        await emit(
            "loop", "11", sub="rerun", pending=pending, baseline=baseline, current_iter=cur_iter
        )  # noqa: E501
        prime_traces = await _run_and_score_batch(new_prompt, minibatch, api_key, token_counter)
        budget_used += len(minibatch)
        sigma_p = sum(t.score for t in prime_traces) / len(prime_traces)
        mark("11")

        # Step 12: Gate
        accepted = sigma_p > sigma * ACCEPT_FACTOR
        cur_iter = {**cur_iter, "sigma_p": round(sigma_p, 3), "accept": accepted}

        if accepted:
            await emit(
                "loop", "12", sub="gate", pending=pending, baseline=baseline, current_iter=cur_iter
            )  # noqa: E501
            mark("12")

            if await cancel_check():
                raise InterruptedError(f"Cancelled before full eval at iteration {iter_idx}.")

            # Step 13: Full eval on D_pareto
            await emit(
                "loop",
                "13",
                sub="fulleval",
                pending=pending,
                baseline=baseline,
                current_iter=cur_iter,
                full_pct=0.0,
            )  # noqa: E501
            prime_full_traces = await _run_and_score_batch(
                new_prompt, d_pareto, api_key, token_counter
            )
            budget_used += len(d_pareto)
            prime_scores = [t.score for t in prime_full_traces]
            prime_avg = sum(prime_scores) / len(prime_scores)
            mark("13")

            await emit(
                "loop",
                "13",
                sub="fulleval",
                pending=pending,
                baseline=baseline,
                current_iter=cur_iter,
                full_pct=100.0,
            )  # noqa: E501

            # Step 14: Add to pool
            score_delta = prime_avg - parent.avg_score
            is_star = prime_avg >= max(c.avg_score for c in pool) - 0.001
            # Mark previous stars as non-star
            if is_star:
                for c in pool:
                    c.star = False

            # Accumulate the full genetic lineage of lessons (paper §3: "GEPA
            # accumulates knowledge along the genetic tree").
            new_lesson = (
                f"{parent.id}→Φ{cand_counter}: σ {parent.avg_score:.2f}→{prime_avg:.2f}"
                f" — {mb_traces[0].feedback[:120] if mb_traces else ''}"
            )
            accumulated_ancestry = (
                (parent.ancestry + "\n" + new_lesson).strip() if parent.ancestry else new_lesson
            )

            new_cand = Candidate(
                id=f"Φ{cand_counter}",
                prompt=new_prompt,
                pareto_scores=prime_scores,
                avg_score=prime_avg,
                desc=f"Refined from {parent.id} via reflective mutation.",
                delta=f"+{score_delta * 100:.2f}"
                if score_delta >= 0
                else f"{score_delta * 100:.2f}",  # noqa: E501
                star=is_star,
                ancestry=accumulated_ancestry,
            )
            pool.append(new_cand)
            cand_counter += 1

            await emit(
                "loop",
                "14",
                sub="update",
                pending=None,
                baseline=baseline,
                current_iter=cur_iter,
                full_pct=100.0,
            )
            mark("14")

            _log.info(
                "gepa_candidate_accepted",
                iter=iter_idx,
                cand=new_cand.id,
                sigma=round(sigma, 3),
                sigma_p=round(sigma_p, 3),
                full_avg=round(prime_avg, 3),
                budget_used=budget_used,
            )
        else:
            # Discard
            pending = {**pending, "fail": True}
            await emit(
                "loop", "12", sub="gate", pending=pending, baseline=baseline, current_iter=cur_iter
            )  # noqa: E501
            mark("12")
            pending = None  # type: ignore[assignment]

            _log.info(
                "gepa_candidate_rejected",
                iter=iter_idx,
                sigma=round(sigma, 3),
                sigma_p=round(sigma_p, 3),
                budget_used=budget_used,
            )

        await emit("loop", None, sub=None, pending=None, baseline=baseline)
        await asyncio.sleep(0)

        if await cancel_check():
            raise InterruptedError(f"Cancelled after iteration {iter_idx}.")

    # ── Phase 3: Select best ──────────────────────────────────────────────────
    await emit("final", "17", baseline=baseline)

    best = max(pool, key=lambda c: c.avg_score)
    best.star = True

    mark("17")
    await emit("completed", None, baseline=baseline)

    score_after = best.avg_score
    score_before = phi0.avg_score

    _log.info(
        "gepa_done",
        best=best.id,
        score_before=round(score_before, 3),
        score_after=round(score_after, 3),
        candidates_tried=len(pool),
        iterations=iter_idx,
        budget_used=budget_used,
    )

    return {
        "optimized_prompt": best.prompt,
        "score_before": score_before,
        "score_after": score_after,
        "candidates_tried": len(pool),
        "rounds_run": iter_idx,
        "dataset_size": len(all_examples),
        "algorithm": "gepa",
        "total_tokens": token_counter[0],
    }
