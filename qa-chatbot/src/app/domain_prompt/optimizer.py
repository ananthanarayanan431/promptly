"""
Domain prompt optimizer.

Generates N candidate prompt variants from the base_prompt, evaluates each
against a validation split of the Q&A dataset using an LLM judge,
and returns the best-scoring candidate.
"""

from __future__ import annotations

import json
import logging
import random
import textwrap

from langchain_openai import ChatOpenAI

_log = logging.getLogger(__name__)

_VARIANT_SYSTEM = textwrap.dedent("""
    You are a prompt engineering expert.
    Given a base system prompt for a specific domain, generate {n} improved variants.
    Each variant should:
    - Preserve the original intent and domain focus
    - Be clearer, more specific, and better structured
    - Include explicit output format instructions if appropriate
    - Be suitable as a system prompt for an AI assistant

    Output ONLY a JSON array of strings, where each string is one variant.
    No preamble, no explanation.
""").strip()

_SCORE_SYSTEM = textwrap.dedent("""
    You are an evaluation judge.
    Given a question, a gold answer, and a model's answer, rate how well
    the model's answer matches the gold answer on a scale from 0.0 to 1.0.

    0.0 = completely wrong or irrelevant
    0.5 = partially correct
    1.0 = fully correct and equivalent to gold answer

    Output ONLY a JSON object: {"score": <float>}
    No explanation.
""").strip()


def _split_dataset(
    pairs: list[dict[str, str]], seed: int = 42
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict[str, str]]]:
    data = list(pairs)
    rng = random.Random(seed)  # noqa: S311
    rng.shuffle(data)
    n = len(data)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)
    return data[:train_end], data[train_end:val_end], data[val_end:]


async def _generate_variants(base_prompt: str, n: int, llm: ChatOpenAI) -> list[str]:
    system = _VARIANT_SYSTEM.format(n=n)
    try:
        response = await llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": f"Base prompt:\n\n{base_prompt}"},
            ]
        )
        raw = str(response.content).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        variants = json.loads(raw)
        if isinstance(variants, list) and all(isinstance(v, str) for v in variants):
            return variants[:n]
    except Exception as _exc:  # noqa: BLE001, S110
        _log.warning("Variant generation failed: %s", _exc)
    return [base_prompt]


async def _score_answer(question: str, gold: str, predicted: str, judge_llm: ChatOpenAI) -> float:
    try:
        response = await judge_llm.ainvoke(
            [
                {"role": "system", "content": _SCORE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Question: {question}\nGold answer: {gold}\nModel answer: {predicted}"
                    ),
                },
            ]
        )
        raw = str(response.content).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        score = float(result.get("score", 0.0))
        return max(0.0, min(1.0, score))
    except Exception as _exc:  # noqa: BLE001
        _log.warning("Answer scoring failed: %s", _exc)
        return 0.0


async def _evaluate_prompt(
    prompt: str,
    val_split: list[dict[str, str]],
    eval_llm: ChatOpenAI,
    judge_llm: ChatOpenAI,
    max_examples: int = 15,
) -> float:
    examples = val_split[:max_examples]
    if not examples:
        return 0.0

    scores: list[float] = []
    for ex in examples:
        question = ex["question"]
        gold = ex["answer"]
        try:
            response = await eval_llm.ainvoke(
                [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": question},
                ]
            )
            predicted = str(response.content).strip()
        except Exception as _exc:  # noqa: BLE001
            _log.warning("Prompt evaluation inference failed: %s", _exc)
            predicted = ""
        score = await _score_answer(question, gold, predicted, judge_llm)
        scores.append(score)

    return sum(scores) / len(scores) if scores else 0.0


async def optimize_domain_prompt(
    base_prompt: str,
    dataset_jsonl: str,
    api_key: str,
    num_candidates: int = 5,
) -> dict[str, object]:
    """
    Returns dict with keys: optimized_prompt (str), score_before (float), score_after (float).
    """
    pairs: list[dict[str, str]] = []
    for line in dataset_jsonl.strip().splitlines():
        try:
            pairs.append(json.loads(line))
        except Exception as _exc:  # noqa: BLE001, S112
            _log.warning("JSONL parse failed for line: %s", _exc)
            continue

    if not pairs:
        return {
            "optimized_prompt": base_prompt,
            "score_before": 0.0,
            "score_after": 0.0,
        }

    _, val_split, _ = _split_dataset(pairs)
    if not val_split:
        val_split = pairs[:5]

    fast_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.7,
        max_tokens=512,
    )
    judge_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=64,
    )

    score_before = await _evaluate_prompt(base_prompt, val_split, fast_llm, judge_llm)
    variants = await _generate_variants(base_prompt, num_candidates, fast_llm)

    best_prompt = base_prompt
    best_score = score_before

    for variant in variants:
        score = await _evaluate_prompt(variant, val_split, fast_llm, judge_llm)
        if score > best_score:
            best_score = score
            best_prompt = variant

    return {
        "optimized_prompt": best_prompt,
        "score_before": round(score_before, 4),
        "score_after": round(best_score, 4),
    }
