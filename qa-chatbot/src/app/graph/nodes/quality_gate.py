"""
Quality Gate node — post-synthesis evaluation.

Scores the current synthesis on the 8 prompt-quality dimensions.
Decides whether to loop back to council_vote for another refinement pass
or to exit the pipeline.

Exit conditions (any one sufficient):
  1. All 8 dimensions score "strong"
  2. iteration_count has reached max_iterations - 1 (ceiling)
  3. synthesis is not meaningfully different from previous_synthesis (convergence)

Loop condition: one or more dimensions still "weak" or "missing" AND iterations remain.
"""

import json
import logging
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

_QUALITY_GATE_SYSTEM = """\
You are a prompt quality auditor. Score the prompt below on 8 dimensions.
Return ONLY a valid JSON object. First character must be "{". No preamble, no markdown fences.

SCORING SCALE
"strong"  — dimension is fully addressed; removing it would make the prompt materially worse
"weak"    — dimension is present but incomplete, vague, or partially addressed
"missing" — dimension is absent AND its absence would cause a worse LLM output

IMPORTANT: "missing" is only correct when the absent dimension would genuinely hurt output
quality for this specific prompt. Not every prompt needs a persona or exemplars.
Apply each dimension relative to what this prompt actually requires.

DIMENSION PASS CONDITIONS

role_persona: "strong" if there is a specific, task-relevant expert persona
              (not "helpful assistant"). "missing" only if persona would materially
              improve output and is absent.

goal_clarity: "strong" if the core task has exactly one valid interpretation.
              "weak" if a competent model could plausibly misread it.
              "missing" if the task is undefined or deeply ambiguous.

context_grounding: "strong" if background/domain/audience is stated AND factual tasks include
                   a no-fabrication directive. "missing" if the model must guess critical context.

output_format: "strong" if structure is defined for any case the model cannot infer correctly.
               "missing" only if format is genuinely undefined and the model would guess wrong.
               Do NOT mark "missing" if the format is inferrable from context.

examples_exemplars: "strong" if an example anchors tone/style when instruction alone
                    is insufficient. "missing" only if complex style/format requirement
                    has no anchor example. Simple unambiguous tasks: "strong" with no
                    example is valid.

constraints_guardrails: "strong" if the most likely failure mode has a specific, targeted guardrail.
                        "weak" if only vague hedges ("if applicable", "as needed") exist.
                        "missing" if no guardrails and the task has clear failure modes.

tone_audience: "strong" if audience is stated when register/depth would differ by reader.
               "missing" only if unstated audience would produce a wrong register.
               Self-contained tasks where audience is irrelevant: "strong" is valid.

conciseness: "strong" if every sentence is load-bearing — no padding, no defaults restated.
             "weak" if some filler exists but the signal is intact.
             "missing" is not used for this dimension — use "weak" for padded prompts.

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
  "weak_dimensions": ["<only dimensions scored weak or missing>"],
  "overall": "pass | fail",
  "rationale": "<one sentence stating the deciding factor>"
}

PASS CONDITION: "overall" is "pass" if ALL of the following are true:
  - Zero dimensions scored "missing"
  - At most 2 dimensions scored "weak"
  - goal_clarity is "strong" (non-negotiable — an unclear goal cannot be rescued by other strengths)
Otherwise "fail".
"""

_loop_id: int | None = None
_gate_model: ChatOpenAI | None = None


def _get_gate_model() -> ChatOpenAI:
    import asyncio

    global _loop_id, _gate_model
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _gate_model is None:
        llm_settings = get_llm_settings()
        _loop_id = lid
        _gate_model = ChatOpenAI(
            model="openai/gpt-4o-mini",  # fast, cheap — only scoring dimensions
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
    result: dict[str, Any] = json.loads(text)
    return result


def _is_converged(current: str, previous: str | None) -> bool:
    """Detect near-identical synthesis — no point in looping if nothing changed."""
    if previous is None:
        return False
    # Normalise whitespace for comparison
    a = " ".join(current.split())
    b = " ".join(previous.split())
    if a == b:
        return True
    # Jaccard similarity on word sets — convergence if > 95% overlap
    words_a = set(a.split())
    words_b = set(b.split())
    if not words_a or not words_b:
        return False
    intersection = len(words_a & words_b)
    union = len(words_a | words_b)
    return (intersection / union) > 0.95


async def quality_gate_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Quality Gate.

    Scores the current synthesis and decides:
      - "loop"  → increment iteration_count, return to council_vote
      - "exit"  → pipeline complete

    Always returns updated iteration_count and previous_synthesis.
    """
    synthesis = state["final_response"]
    iteration = state.get("iteration_count", 0)
    max_iter = state.get("max_iterations", 3)
    previous = state.get("previous_synthesis")
    job_id = state.get("job_id")

    # Hard ceiling — never exceed max_iterations
    if iteration >= max_iter - 1:
        if job_id:
            await push_job_progress(
                job_id, {"step": "quality_gate", "decision": "exit_max", "ts": time.time()}
            )
        return {
            "iteration_count": iteration + 1,
            "previous_synthesis": synthesis,
        }

    # Convergence check — exit if synthesis hasn't changed meaningfully
    if _is_converged(synthesis, previous):
        if job_id:
            await push_job_progress(
                job_id, {"step": "quality_gate", "decision": "exit_converged", "ts": time.time()}
            )
        return {
            "iteration_count": iteration + 1,
            "previous_synthesis": synthesis,
        }

    # Score the synthesis
    try:
        response = await _get_gate_model().ainvoke(
            [
                {"role": "system", "content": _QUALITY_GATE_SYSTEM},
                {"role": "user", "content": f"Prompt to evaluate:\n{synthesis}"},
            ]
        )
        gate = _parse_gate_response(str(response.content))
        overall = gate.get("overall", "fail")
        weak_dimensions: list[str] = gate.get("weak_dimensions", [])
    except Exception:
        logger.exception("quality_gate scoring failed — defaulting to exit")
        return {
            "iteration_count": iteration + 1,
            "previous_synthesis": synthesis,
        }

    decision = "exit" if overall == "pass" else "loop"

    if job_id:
        await push_job_progress(
            job_id,
            {
                "step": "quality_gate",
                "iteration": iteration,
                "decision": decision,
                "overall": overall,
                "weak_dimensions": weak_dimensions,
                "ts": time.time(),
            },
        )

    return {
        "iteration_count": iteration + 1,
        "previous_synthesis": synthesis,
        # Pass quality gaps back into state so council_vote can address them next iteration
        "critic_responses": state.get("critic_responses", [])
        + [{"_quality_gate": True, "weak_dimensions": weak_dimensions}],
    }
