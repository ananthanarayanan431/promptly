"""
MAP-RPE: Model-Adaptive Reflective Prompt Evolution (arXiv:2512.01420 §3.1).

Calibration engine that generates task- and model-specific optimal prompts via:
  1. Synthetic alignment task generation from source prompt
  2. Island-based evolutionary search with K=3 populations
  3. Reflective refinement: each iteration analyzes failures and proposes fixes
  4. Migration between islands to prevent premature convergence
  5. Combined objective: λ·Performance + (1-λ)·Behavioral score

Returns a list of (source_prompt_variant, target_prompt_variant) calibrated pairs.
"""

from __future__ import annotations

import json
import logging
import random
from dataclasses import dataclass, field

from app.llm import LLMClient
from app.prompt_bridge.constants.map_rpe import (
    ARCHIVE_SIZE,
    CALIBRATION_TASKS,
    ELITE_RATIO,
    EXPLOITATION_RATIO,
    EXPLORATION_RATIO,
    GLOBAL_ITERATIONS,
    ISLANDS,
    LAMBDA_BEHAVIORAL,
    LAMBDA_PERFORMANCE,
    LOCAL_STEPS,
    MIGRATION_INTERVAL,
    MIGRATION_RATE,
)
from app.prompt_bridge.prompts.map_rpe import (
    ALIGNMENT_TASK_SYSTEM,
    EVALUATION_SYSTEM,
    REFLECTION_SYSTEM,
)

_log = logging.getLogger(__name__)


# ── Data structures ───────────────────────────────────────────────────────────


@dataclass
class PromptCandidate:
    text: str
    perf_score: float = 0.0
    behavioral_score: float = 0.0
    eval_count: int = 0

    @property
    def combined_score(self) -> float:
        return LAMBDA_PERFORMANCE * self.perf_score + LAMBDA_BEHAVIORAL * self.behavioral_score


@dataclass
class Island:
    """One evolutionary island — maintains a diverse archive of prompt candidates."""

    candidates: list[PromptCandidate] = field(default_factory=list)
    best: PromptCandidate | None = None

    def add(self, candidate: PromptCandidate) -> None:
        self.candidates.append(candidate)
        if len(self.candidates) > ARCHIVE_SIZE:
            self.candidates.sort(key=lambda c: c.combined_score, reverse=True)
            self.candidates = self.candidates[:ARCHIVE_SIZE]
        if self.best is None or candidate.combined_score > self.best.combined_score:
            self.best = candidate

    def select_parent(self) -> PromptCandidate:
        """ε-greedy selection: exploit top candidates or explore random ones."""
        if not self.candidates:
            raise RuntimeError("Island is empty — cannot select parent")
        r = random.random()  # noqa: S311
        sorted_cands = sorted(self.candidates, key=lambda c: c.combined_score, reverse=True)
        if r < EXPLOITATION_RATIO:
            # exploit: pick from top tier
            n_elite = max(1, int(len(sorted_cands) * ELITE_RATIO))
            return random.choice(sorted_cands[:n_elite])  # noqa: S311
        elif r < EXPLOITATION_RATIO + EXPLORATION_RATIO:
            # explore: random pick
            return random.choice(self.candidates)  # noqa: S311
        else:
            # elite: always the best
            return sorted_cands[0]

    def top_prompts(self, k: int = 3) -> list[PromptCandidate]:
        return sorted(self.candidates, key=lambda c: c.combined_score, reverse=True)[:k]

    def migrate_out(self) -> list[PromptCandidate]:
        """Return top MIGRATION_RATE fraction for migration to other islands."""
        n = max(1, int(len(self.candidates) * MIGRATION_RATE))
        return sorted(self.candidates, key=lambda c: c.combined_score, reverse=True)[:n]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_json_safe(text: str) -> dict[str, object]:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1].removeprefix("json").strip() if len(parts) > 1 else text
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except (json.JSONDecodeError, ValueError):
        pass
    return {}


def _parse_list_safe(text: str) -> list[str]:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1].removeprefix("json").strip() if len(parts) > 1 else text
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return [str(x) for x in result]
    except (json.JSONDecodeError, ValueError):
        pass
    return []


# ── Core MAP-RPE functions ────────────────────────────────────────────────────


async def generate_alignment_tasks(
    source_prompt: str,
    n: int,
    task_llm: LLMClient,
) -> list[str]:
    """
    Generate n synthetic test inputs from the source prompt (alignment tasks).
    These become the calibration questions used during evolution.
    """
    system = ALIGNMENT_TASK_SYSTEM.format(n=n)
    response = await task_llm.ainvoke(
        [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": f"System prompt to generate test inputs for:\n\n{source_prompt}",
            },  # noqa: E501
        ]
    )
    tasks = _parse_list_safe(str(response.content))
    if not tasks:
        # fallback: split the prompt into implied subtasks
        _log.warning("Alignment task generation returned empty — using fallback tasks")
        tasks = [f"Test case {i + 1}: evaluate the prompt on a typical use case" for i in range(n)]
    return tasks[:n]


async def evaluate_response(
    system_prompt: str,
    test_input: str,
    model_response: str,
    eval_llm: LLMClient,
) -> tuple[float, str]:
    """
    Score a model response given the system prompt and test input.
    Returns (score 0.0–1.0, feedback string).
    """
    system = EVALUATION_SYSTEM.format(
        system_prompt=system_prompt,
        test_input=test_input,
        model_response=model_response,
    )
    try:
        response = await eval_llm.ainvoke([{"role": "user", "content": system}])
        parsed = _parse_json_safe(str(response.content))
        score = float(str(parsed.get("score", 0.5)))
        feedback = str(parsed.get("feedback", "No feedback provided"))
        return max(0.0, min(1.0, score)), feedback
    except Exception:  # noqa: BLE001
        _log.exception("Evaluation failed — defaulting to score 0.5")
        return 0.5, "Evaluation error"


async def reflect_and_generate(
    current_prompt: str,
    target_model: str,
    test_input: str,
    model_response: str,
    feedback: str,
    best_score: float,
    top_prompts: list[PromptCandidate],
    reflection_llm: LLMClient,
) -> str:
    """
    Reflective step: analyze failure and generate an improved prompt candidate.
    """
    top_block = "\n\n".join(
        f"[Rank {i+1} | score={c.combined_score:.3f}]\n{c.text}" for i, c in enumerate(top_prompts)
    )
    system = REFLECTION_SYSTEM.format(
        target_model=target_model,
        current_prompt=current_prompt,
        test_input=test_input,
        model_response=model_response,
        feedback=feedback,
        best_score=best_score,
        top_prompts=top_block,
    )
    response = await reflection_llm.ainvoke([{"role": "user", "content": system}])
    return str(response.content).strip()


async def _migrate_between_islands(islands: list[Island]) -> None:
    """Migrate top performers between islands to share diversity."""
    if len(islands) < 2:
        return
    migrants: list[PromptCandidate] = []
    for island in islands:
        migrants.extend(island.migrate_out())
    # distribute migrants round-robin to other islands
    for i, migrant in enumerate(migrants):
        target_island = islands[(i + 1) % len(islands)]
        target_island.add(migrant)


# ── Main calibration entry point ──────────────────────────────────────────────


async def run_map_rpe(
    source_prompt: str,
    target_model: str,
    task_llm: LLMClient,
    target_llm: LLMClient,
    eval_llm: LLMClient,
    reflection_llm: LLMClient,
    progress_cb: object = None,
) -> PromptCandidate:
    """
    Run MAP-RPE to find the best prompt for target_model starting from source_prompt.

    Algorithm (arXiv:2512.01420 §3.1):
      1. Generate n calibration tasks from source_prompt
      2. Initialise K islands, each seeded with source_prompt
      3. For G global iterations:
           For each calibration task x_j:
             For L local steps:
               Select parent from current island
               Generate child via reflection LLM
               Evaluate child on target_model
               Add child to island
             Migrate every MIGRATION_INTERVAL steps
      4. Return global best candidate

    Args:
        source_prompt: Starting prompt (optimized for the source model).
        target_model: Model slug of the target model (display name for prompts).
        task_llm: LLM used to generate alignment tasks.
        target_llm: The actual target model — responses come from here.
        eval_llm: LLM used to score responses.
        reflection_llm: LLM used to generate improved prompt candidates.
        progress_cb: Optional async callable(step, total, best_score) for progress.

    Returns:
        Best PromptCandidate found for target_model.
    """
    # Step 1: generate calibration tasks
    _log.info("MAP-RPE: generating %d alignment tasks", CALIBRATION_TASKS)
    alignment_tasks = await generate_alignment_tasks(source_prompt, CALIBRATION_TASKS, task_llm)

    # Step 2: initialise K islands, each seeded with source_prompt
    islands: list[Island] = []
    for _ in range(ISLANDS):
        island = Island()
        seed = PromptCandidate(text=source_prompt)
        island.add(seed)
        islands.append(island)

    global_best: PromptCandidate = PromptCandidate(text=source_prompt)
    total_steps = GLOBAL_ITERATIONS * len(alignment_tasks) * LOCAL_STEPS
    step_count = 0

    # Step 3: evolution loop
    for g in range(GLOBAL_ITERATIONS):
        for task_idx, test_input in enumerate(alignment_tasks):
            # pick which island is active this task
            island = islands[task_idx % ISLANDS]

            for local_step in range(LOCAL_STEPS):
                step_count += 1

                parent = island.select_parent()

                # evaluate parent on target model first
                target_response = await target_llm.ainvoke(
                    [
                        {"role": "system", "content": parent.text},
                        {"role": "user", "content": test_input},
                    ]
                )
                perf_score, feedback = await evaluate_response(
                    parent.text, test_input, str(target_response.content), eval_llm
                )
                parent.perf_score = (parent.perf_score * parent.eval_count + perf_score) / (
                    parent.eval_count + 1
                )
                parent.eval_count += 1

                if global_best is None or parent.combined_score > global_best.combined_score:
                    global_best = parent

                # skip reflection if already near-perfect
                if perf_score >= 0.95:
                    continue

                # generate child via reflection
                child_text = await reflect_and_generate(
                    current_prompt=parent.text,
                    target_model=target_model,
                    test_input=test_input,
                    model_response=str(target_response.content),
                    feedback=feedback,
                    best_score=global_best.combined_score,
                    top_prompts=island.top_prompts(3),
                    reflection_llm=reflection_llm,
                )

                # evaluate child
                child_response = await target_llm.ainvoke(
                    [
                        {"role": "system", "content": child_text},
                        {"role": "user", "content": test_input},
                    ]
                )
                child_perf, _ = await evaluate_response(
                    child_text, test_input, str(child_response.content), eval_llm
                )
                child = PromptCandidate(
                    text=child_text,
                    perf_score=child_perf,
                    behavioral_score=0.5,  # default; extended scoring future work
                    eval_count=1,
                )
                island.add(child)

                if child.combined_score > global_best.combined_score:
                    global_best = child
                    _log.debug(
                        "MAP-RPE g=%d task=%d step=%d new best=%.3f",
                        g,
                        task_idx,
                        local_step,
                        global_best.combined_score,
                    )

                # migration
                if step_count % MIGRATION_INTERVAL == 0:
                    await _migrate_between_islands(islands)

                # progress callback
                if progress_cb is not None and callable(progress_cb):
                    await progress_cb(step_count, total_steps, global_best.combined_score)

    _log.info("MAP-RPE complete. Best score=%.3f", global_best.combined_score)
    return global_best
