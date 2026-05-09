"""
Domain prompt optimizer — Prompt Duel Optimizer (PDO).

Implements the Double Thompson Sampling algorithm from arXiv:2510.13907
("Dueling Optimization with a Monotone Adversary") as applied in
meta-llama/prompt-ops.

Pipeline:
  1. Generate K candidate prompt variants from the base prompt.
  2. Run T tournament rounds using Double Thompson Sampling (D-TS):
       - Sample theta_ij ~ Beta(W[i,j]+1, W[j,i]+1) for each candidate pair.
       - Select the pair (i*, j*) with the highest sampled win probability.
       - Duel: run both prompts on a randomly drawn Q&A pair; LLM judge picks winner.
       - Update W and N matrices.
  3. After every M rounds, generate a new mutation of the current best candidate
     and add it to the pool (top-performer guided mutation).
  4. Rank candidates using 5 systems:
       Copeland, Borda, Average Win Rate, Elo, TrueSkill
  5. Fuse rankings via Dirichlet-weighted ensemble (w ~ Dir(1^5)).
  6. Return the fused winner.

Constants are tuned for interactive web use (fewer rounds than the full paper):
  - K=5 initial candidates
  - T=40 tournament rounds
  - M=10 mutation interval
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import textwrap
from dataclasses import dataclass, field
from typing import Any

from langchain_openai import ChatOpenAI

_log = logging.getLogger(__name__)

# ── Tuning constants ──────────────────────────────────────────────────────────
_NUM_CANDIDATES = 5  # initial prompt variants
_TOURNAMENT_ROUNDS = 40  # D-TS duel iterations (paper uses 100+; 40 balances speed/quality)
_MUTATION_INTERVAL = 10  # regenerate a new mutation every N rounds
_UCB_ALPHA = 0.5  # confidence-bound exploration weight (paper §4.1)
_ELO_K = 32.0  # Elo K-factor
_MAX_VAL_EXAMPLES = 20  # cap validation set used for final scoring
_MAX_SCORE_EXAMPLES = 15  # cap per-prompt eval examples during tournament

# Token budgets — variants need room for 5 full rewrites; scoring/judging only needs short JSON
_VARIANT_MAX_TOKENS = 4096
_MUTATION_MAX_TOKENS = 2048
_JUDGE_MAX_TOKENS = 128  # {"winner": "A"} or {"winner": "B"} + reasoning
_SCORE_MAX_TOKENS = 64  # {"score": 0.87}

# ── LLM system prompts ────────────────────────────────────────────────────────

# Receives: {n}, {domain_summary}, {sample_questions}
_VARIANT_SYSTEM = textwrap.dedent("""
    You are a world-class prompt engineer. Your job is to take a short, vague base prompt and
    transform it into {n} richly detailed, high-performance system prompt variants that will
    dramatically improve an AI assistant's answers on a specific domain.

    Domain context (inferred from the knowledge base):
    {domain_summary}

    Sample questions this assistant must answer well:
    {sample_questions}

    Each variant MUST:
    - Be substantially longer and more detailed than the base prompt (aim for 150–400 words)
    - Embed concrete domain knowledge, terminology, and best practices drawn from the
      sample questions
    - Give the model clear behavioural rules it can follow when answering those specific questions
    - Be a complete, production-ready system prompt that stands alone

    Use a different enhancement strategy per variant — do NOT just rephrase:
      * Variant 1 — Expert persona + knowledge depth: Assign a highly specific expert identity
        (e.g. "You are a senior financial advisor with 20 years of experience…"). Add domain
        knowledge the model should draw on, and specify how to reason through complex questions.
      * Variant 2 — Structured reasoning protocol: Define an explicit step-by-step process the
        model must follow for every answer (e.g. clarify → analyse → recommend → caveat).
        Include decision rules for edge cases specific to the domain.
      * Variant 3 — Output format + evidence standards: Specify exactly how answers should be
        structured (sections, bullet points, tables where useful). Require the model to cite
        reasoning, quantify where possible, and flag uncertainty explicitly.
      * Variant 4 — Safety + scope boundaries: Define what the assistant will and won't do,
        common misconceptions to correct, when to recommend professional consultation, and how
        to handle questions outside its competence — grounded in the domain context.
      * Variant 5 — Comprehensive enhancement: Combine the best elements of the above — strong
        persona, domain-specific knowledge rules, structured output, and safety guardrails —
        into a single highly polished prompt.

    Output ONLY a valid JSON array of exactly {n} strings.
    No markdown fences, no preamble, no explanation — just the raw JSON array.
""").strip()

# Receives: {tip}, {domain_summary}
_MUTATION_SYSTEM = textwrap.dedent("""
    You are a world-class prompt engineer. You are given the current best-performing system
    prompt for an AI assistant operating in a specific domain. Your task is to produce ONE
    meaningfully improved mutation that makes the assistant smarter and more useful.

    Domain context: {domain_summary}

    Improvement strategy to apply: {tip}

    Rules:
    - The mutation must be LONGER and MORE DETAILED than the original — add depth, not remove it
    - Inject domain-specific knowledge, terminology, and reasoning guidelines the original lacks
    - The result must still serve the same core purpose but perform better on domain questions
    - Do not summarise or compress the original — expand and enhance it
    - The result must be a complete, production-ready system prompt

    Output ONLY the mutated prompt text. No preamble, no explanation, no quotes.
""").strip()

_MUTATION_TIPS = [
    (
        "Add a detailed step-by-step reasoning protocol the model must follow before answering: "
        "e.g. (1) identify what is being asked, (2) recall relevant domain principles, "
        "(3) apply them to the specific case, (4) state the answer with supporting reasoning, "
        "(5) add any important caveats or limitations."
    ),
    (
        "Deepen the expert persona: give the assistant a highly specific professional identity "
        "with years of experience, named areas of expertise drawn from the domain context, "
        "and explicit guidance on how that expertise shapes the answers it gives."
    ),
    (
        "Add a comprehensive output format specification: define when to use bullet points, "
        "numbered steps, tables, or prose; require quantification where possible; "
        "specify answer length norms; and mandate explicit uncertainty flags when confidence is low."  # noqa: E501
    ),
    (
        "Add domain-specific safety and scope rules: define the exact boundaries of what the "
        "assistant will and won't answer, common misconceptions it must proactively correct, "
        "and clear triggers for recommending professional consultation."
    ),
    (
        "Inject domain knowledge directly into the prompt: add 3–5 key principles, frameworks, "
        "or rules-of-thumb from the domain that the model should always apply when reasoning, "
        "so it behaves like a knowledgeable practitioner rather than a generic assistant."
    ),
]

_DUEL_SYSTEM = textwrap.dedent("""
    You are an impartial evaluation judge.
    Two AI assistants used different system prompts to answer the same question.
    Your job: decide which response better answers the question given the gold-standard answer.

    Criteria (in order of importance):
    1. Accuracy — does the response align with the gold answer?
    2. Completeness — does it cover the key points?
    3. Clarity — is it well-structured and easy to understand?

    Output ONLY valid JSON: {"winner": "A"} or {"winner": "B"}
    No explanation. No other keys. No markdown.
""").strip()

_SCORE_SYSTEM = textwrap.dedent("""
    You are an evaluation judge.
    Rate how well a model's answer matches the gold-standard answer.

    Scale:
    0.0 = completely wrong or irrelevant
    0.5 = partially correct — captures some key points but misses others
    1.0 = fully correct and equivalent to the gold answer

    Output ONLY valid JSON: {"score": <float between 0.0 and 1.0>}
    No explanation. No other keys. No markdown.
""").strip()


# ── Data structures ───────────────────────────────────────────────────────────
@dataclass
class _Candidate:
    text: str
    elo: float = 1200.0


@dataclass
class _WinMatrix:
    """Pairwise win (W) and comparison-count (N) matrices."""

    size: int
    W: list[list[float]] = field(default_factory=list)
    N: list[list[float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.W = [[0.0] * self.size for _ in range(self.size)]
        self.N = [[0.0] * self.size for _ in range(self.size)]

    def add_candidate(self) -> None:
        n = self.size
        for row in self.W:
            row.append(0.0)
        for row in self.N:
            row.append(0.0)
        self.W.append([0.0] * (n + 1))
        self.N.append([0.0] * (n + 1))
        self.size += 1

    def record_win(self, winner: int, loser: int) -> None:
        self.W[winner][loser] += 1.0
        self.N[winner][loser] += 1.0
        self.N[loser][winner] += 1.0


# ── LLM helpers ───────────────────────────────────────────────────────────────
def _strip_fences(text: str) -> str:
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _build_domain_summary(pairs: list[dict[str, str]], max_samples: int = 5) -> tuple[str, str]:
    """Return (domain_summary_sentence, sample_questions_block) from dataset pairs."""
    sample = pairs[:max_samples]
    questions_block = "\n".join(f"- {p['question']}" for p in sample)
    # Single-sentence domain hint derived from the first few questions
    topics = ", ".join(" ".join(p["question"].split()[:6]) for p in sample[:3])
    domain_summary = f"This domain covers topics such as: {topics}."
    return domain_summary, questions_block


async def _generate_variants(
    base_prompt: str,
    n: int,
    llm: ChatOpenAI,
    domain_summary: str,
    sample_questions: str,
) -> list[str]:
    system = _VARIANT_SYSTEM.format(
        n=n,
        domain_summary=domain_summary,
        sample_questions=sample_questions,
    )
    try:
        # Use a separate client with a higher token budget for variant generation
        gen_llm = llm.model_copy(update={"max_tokens": _VARIANT_MAX_TOKENS})
        response = await gen_llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": f"Base prompt to improve:\n\n{base_prompt}"},
            ]
        )
        raw = _strip_fences(str(response.content).strip())
        # Tolerate truncated JSON by finding the last complete string entry
        variants: Any = json.loads(raw)
        if isinstance(variants, list):
            result = [v for v in variants[:n] if isinstance(v, str) and v.strip()]
            if result:
                _log.info("Generated %d variants", len(result))
                return result
    except Exception as exc:  # noqa: BLE001
        _log.warning("Variant generation failed (%s), retrying with smaller n=3", exc)
        # Retry with fewer variants to reduce token pressure
        if n > 3:
            return await _generate_variants(base_prompt, 3, llm, domain_summary, sample_questions)
    _log.error("Variant generation failed entirely — falling back to base prompt only")
    return [base_prompt]


async def _mutate_prompt(
    prompt: str,
    llm: ChatOpenAI,
    domain_summary: str,
    tip: str,
) -> str:
    system = _MUTATION_SYSTEM.format(domain_summary=domain_summary, tip=tip)
    try:
        mut_llm = llm.model_copy(update={"max_tokens": _MUTATION_MAX_TOKENS})
        response = await mut_llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": f"Current best prompt:\n\n{prompt}"},
            ]
        )
        mutated = str(response.content).strip()
        if mutated and mutated != prompt:
            return mutated
    except Exception as exc:  # noqa: BLE001
        _log.warning("Mutation failed: %s", exc)
    return prompt


async def _get_answer(prompt: str, question: str, llm: ChatOpenAI) -> str:
    try:
        response = await llm.ainvoke(
            [
                {"role": "system", "content": prompt},
                {"role": "user", "content": question},
            ]
        )
        return str(response.content).strip()
    except Exception as exc:  # noqa: BLE001
        _log.warning("Inference failed: %s", exc)
        return ""


async def _duel(
    prompt_a: str,
    prompt_b: str,
    question: str,
    gold: str,
    llm: ChatOpenAI,
    judge_llm: ChatOpenAI,
    rng: random.Random,
) -> int:
    """Return 0 if A wins, 1 if B wins.

    Randomises presentation order (A/B vs B/A) on each call to eliminate
    position bias — the true winner is always mapped back to the original index.
    """
    # Randomise which prompt is shown as "A" to counteract position bias
    flip = rng.random() < 0.5
    first_prompt, second_prompt = (prompt_b, prompt_a) if flip else (prompt_a, prompt_b)

    ans_first, ans_second = await asyncio.gather(
        _get_answer(first_prompt, question, llm),
        _get_answer(second_prompt, question, llm),
    )
    try:
        j_llm = judge_llm.model_copy(update={"max_tokens": _JUDGE_MAX_TOKENS})
        response = await j_llm.ainvoke(
            [
                {"role": "system", "content": _DUEL_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Question: {question}\n"
                        f"Gold answer: {gold}\n\n"
                        f"Response A:\n{ans_first}\n\n"
                        f"Response B:\n{ans_second}"
                    ),
                },
            ]
        )
        raw = _strip_fences(str(response.content).strip())
        result: Any = json.loads(raw)
        winner_label = str(result.get("winner", "")).upper().strip()
        if winner_label not in ("A", "B"):
            raise ValueError(f"Unexpected winner label: {winner_label!r}")
        # Map back: if we flipped, "A" in judge output = prompt_b = index 1
        winner_is_first = winner_label == "A"
        first_is_b = flip
        if winner_is_first:
            return 1 if first_is_b else 0
        return 0 if first_is_b else 1
    except Exception as exc:  # noqa: BLE001
        _log.warning("Duel judge failed: %s — random tiebreak", exc)
        return rng.randint(0, 1)  # random tiebreak, not always A


async def _score_one(
    prompt: str,
    question: str,
    gold: str,
    llm: ChatOpenAI,
    judge_llm: ChatOpenAI,
) -> float:
    predicted = await _get_answer(prompt, question, llm)
    try:
        sc_llm = judge_llm.model_copy(update={"max_tokens": _SCORE_MAX_TOKENS})
        response = await sc_llm.ainvoke(
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
        raw = _strip_fences(str(response.content).strip())
        obj: Any = json.loads(raw)
        s = float(obj.get("score", 0.0))
        return max(0.0, min(1.0, s))
    except Exception as exc:  # noqa: BLE001
        _log.warning("Score judge failed: %s", exc)
        return 0.0


async def _score_prompt(
    prompt: str,
    examples: list[dict[str, str]],
    llm: ChatOpenAI,
    judge_llm: ChatOpenAI,
) -> float:
    if not examples:
        return 0.0
    batch = examples[:_MAX_SCORE_EXAMPLES]
    scores = await asyncio.gather(
        *[_score_one(prompt, ex["question"], ex["answer"], llm, judge_llm) for ex in batch]
    )
    return sum(scores) / len(scores) if scores else 0.0


# ── PDO ranking systems ───────────────────────────────────────────────────────
def _copeland_scores(wm: _WinMatrix) -> list[float]:
    """Net wins: number of opponents candidate i beats majority of duels against."""
    n = wm.size
    scores = [0.0] * n
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            # Optimistic UCB estimate for p_ij
            n_ij = wm.N[i][j]
            if n_ij == 0:
                p_ij = 1.0  # optimistic: assume wins all unseen matchups
            else:
                p_ij = wm.W[i][j] / n_ij + math.sqrt(_UCB_ALPHA * math.log(max(n_ij, 1)) / n_ij)
                p_ij = min(p_ij, 1.0)
            if p_ij > 0.5:
                scores[i] += 1.0
    return scores


def _borda_scores(wm: _WinMatrix) -> list[float]:
    """Average fractional wins against each opponent."""
    n = wm.size
    scores = [0.0] * n
    for i in range(n):
        total = 0.0
        for j in range(n):
            if i == j:
                continue
            n_ij = wm.N[i][j]
            total += (wm.W[i][j] / n_ij) if n_ij > 0 else 0.5
        scores[i] = total / (n - 1) if n > 1 else 0.0
    return scores


def _avg_win_rate_scores(wm: _WinMatrix) -> list[float]:
    n = wm.size
    scores = [0.0] * n
    for i in range(n):
        wins = sum(wm.W[i][j] for j in range(n) if j != i)
        total = sum(wm.N[i][j] for j in range(n) if j != i)
        scores[i] = wins / total if total > 0 else 0.5
    return scores


def _elo_scores(candidates: list[_Candidate]) -> list[float]:
    return [c.elo for c in candidates]


def _trueskill_scores(wm: _WinMatrix) -> list[float]:
    """Simplified TrueSkill: Gaussian mean estimate from win rate with uncertainty."""
    n = wm.size
    scores = [0.0] * n
    for i in range(n):
        total = sum(wm.N[i][j] for j in range(n) if j != i)
        wins = sum(wm.W[i][j] for j in range(n) if j != i)
        mu = wins / total if total > 0 else 0.5
        # Shrink toward prior 0.5 proportional to uncertainty (Bayesian estimate)
        confidence = total / (total + 10)
        scores[i] = confidence * mu + (1 - confidence) * 0.5
    return scores


def _rank_from_scores(scores: list[float]) -> list[int]:
    """Return rank positions (0 = best) for each candidate by descending score."""
    indexed = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    ranks = [0] * len(scores)
    for rank, (idx, _) in enumerate(indexed):
        ranks[idx] = rank
    return ranks


def _dirichlet_sample(n: int, rng: random.Random) -> list[float]:
    """Sample w ~ Dirichlet(1^n) via Gamma(1,1) trick."""
    gammas = [-math.log(rng.random() + 1e-15) for _ in range(n)]
    total = sum(gammas)
    return [g / total for g in gammas]


def _fuse_rankings(
    wm: _WinMatrix,
    candidates: list[_Candidate],
    rng: random.Random,
) -> int:
    """
    Multi-Ranker Fusion with Dirichlet-weighted ensemble (paper §5).

    Five ranking systems contribute rank positions for each candidate.
    Weights w ~ Dir(1^5) are sampled fresh each call so the fusion is
    stochastic and avoids deterministic ties.

    Returns the index of the fused winner.
    """
    rank_systems = [
        _rank_from_scores(_copeland_scores(wm)),
        _rank_from_scores(_borda_scores(wm)),
        _rank_from_scores(_avg_win_rate_scores(wm)),
        _rank_from_scores(_elo_scores(candidates)),
        _rank_from_scores(_trueskill_scores(wm)),
    ]
    weights = _dirichlet_sample(len(rank_systems), rng)
    n = wm.size

    # Weighted rank sum (lower = better)
    fused = [
        sum(weights[k] * rank_systems[k][i] for k in range(len(rank_systems))) for i in range(n)
    ]
    return int(min(range(n), key=lambda i: fused[i]))


# ── D-TS pair selection ───────────────────────────────────────────────────────
def _select_duel_pair(wm: _WinMatrix, rng: random.Random) -> tuple[int, int]:
    """
    Double Thompson Sampling (D-TS) — paper Algorithm 1.

    For each pair (i, j), sample theta_ij ~ Beta(W[i,j]+1, W[j,i]+1).
    Select the pair with the highest theta.
    Returns (champion, challenger).
    """
    n = wm.size
    best_theta = -1.0
    best_i, best_j = 0, min(1, n - 1)

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            alpha = wm.W[i][j] + 1.0
            beta_val = wm.W[j][i] + 1.0
            theta = rng.betavariate(alpha, beta_val)
            if theta > best_theta:
                best_theta = theta
                best_i, best_j = i, j

    return best_i, best_j


def _update_elo(candidates: list[_Candidate], winner: int, loser: int) -> None:
    ea = 1.0 / (1.0 + 10 ** ((candidates[loser].elo - candidates[winner].elo) / 400.0))
    candidates[winner].elo += _ELO_K * (1.0 - ea)
    candidates[loser].elo -= _ELO_K * (1.0 - ea)


# ── Main entry point ──────────────────────────────────────────────────────────
async def optimize_domain_prompt(
    base_prompt: str,
    dataset_jsonl: str,
    api_key: str,
    num_candidates: int = _NUM_CANDIDATES,
) -> dict[str, object]:
    """
    Run the PDO algorithm and return the best domain-specific system prompt.

    Returns dict with keys:
        optimized_prompt (str)
        score_before     (float, 0–1)
        score_after      (float, 0–1)
    """
    # ── Parse dataset ─────────────────────────────────────────────────────────
    pairs: list[dict[str, str]] = []
    for line in dataset_jsonl.strip().splitlines():
        try:
            pairs.append(json.loads(line))
        except Exception as exc:  # noqa: BLE001
            _log.warning("JSONL parse failed: %s", exc)

    if not pairs:
        return {"optimized_prompt": base_prompt, "score_before": 0.0, "score_after": 0.0}

    # 85/15 split — consistent seed so reruns are reproducible
    rng = random.Random(42)  # noqa: S311
    shuffled = list(pairs)
    rng.shuffle(shuffled)
    n_total = len(shuffled)
    n_val = max(1, int(n_total * 0.15))
    val_split = shuffled[-n_val:]
    duel_pool = shuffled[: n_total - n_val]  # used during tournament duels

    if not duel_pool:
        duel_pool = shuffled  # tiny dataset fallback

    # ── LLM clients ───────────────────────────────────────────────────────────
    # Claude Haiku: fast + cheap for answering during duels
    # max_tokens=512 is fine here — answers to individual questions are short
    fast_llm = ChatOpenAI(
        model="anthropic/claude-3.5-haiku",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.7,
        max_tokens=512,
    )
    # GPT-4o: cross-model judge — different architecture avoids self-preference bias
    # Variant generation and mutations use fast_llm with _VARIANT_MAX_TOKENS override
    judge_llm = ChatOpenAI(
        model="openai/gpt-4o",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=_JUDGE_MAX_TOKENS,
    )

    # ── Build domain context for variant/mutation prompts ─────────────────────
    domain_summary, sample_questions = _build_domain_summary(duel_pool)

    # ── Baseline score ────────────────────────────────────────────────────────
    score_before = await _score_prompt(
        base_prompt, val_split[:_MAX_VAL_EXAMPLES], fast_llm, judge_llm
    )

    # ── Generate initial candidates ───────────────────────────────────────────
    variant_texts = await _generate_variants(
        base_prompt, num_candidates, fast_llm, domain_summary, sample_questions
    )
    # Always include the original baseline so it competes in the tournament
    if base_prompt not in variant_texts:
        variant_texts.insert(0, base_prompt)
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_variants: list[str] = []
    for v in variant_texts:
        if v not in seen:
            seen.add(v)
            unique_variants.append(v)
    variant_texts = unique_variants[:num_candidates]

    candidates = [_Candidate(text=t) for t in variant_texts]
    wm = _WinMatrix(size=len(candidates))

    if len(candidates) < 2:
        _log.error(
            "Only 1 candidate after variant generation — returning base prompt unchanged. "
            "Check that the variant LLM call is succeeding."
        )
        score_after = await _score_prompt(
            base_prompt, val_split[:_MAX_VAL_EXAMPLES], fast_llm, judge_llm
        )
        return {
            "optimized_prompt": base_prompt,
            "score_before": round(score_before, 4),
            "score_after": round(score_after, 4),
        }

    _log.info("Starting PDO tournament with %d candidates", len(candidates))

    # ── PDO tournament (Double Thompson Sampling) ─────────────────────────────
    mutation_tip_idx = 0
    for round_idx in range(_TOURNAMENT_ROUNDS):
        i, j = _select_duel_pair(wm, rng)
        ex = rng.choice(duel_pool)
        question, gold = ex["question"], ex["answer"]

        # _duel returns 0 (i wins) or 1 (j wins)
        duel_result = await _duel(
            candidates[i].text, candidates[j].text, question, gold, fast_llm, judge_llm, rng
        )
        winner_idx, loser_idx = (i, j) if duel_result == 0 else (j, i)
        wm.record_win(winner_idx, loser_idx)
        _update_elo(candidates, winner_idx, loser_idx)

        # Top-performer guided mutation every M rounds
        if (round_idx + 1) % _MUTATION_INTERVAL == 0:
            best_now = _fuse_rankings(wm, candidates, rng)
            tip = _MUTATION_TIPS[mutation_tip_idx % len(_MUTATION_TIPS)]
            mutation_tip_idx += 1
            mutated_text = await _mutate_prompt(
                candidates[best_now].text, fast_llm, domain_summary, tip
            )
            if mutated_text not in {c.text for c in candidates}:
                candidates.append(_Candidate(text=mutated_text, elo=candidates[best_now].elo))
                wm.add_candidate()
                _log.info("Round %d: added mutation (pool size=%d)", round_idx + 1, wm.size)

    # ── Multi-Ranker Fusion to find overall winner ────────────────────────────
    winner_idx = _fuse_rankings(wm, candidates, rng)
    best_prompt = candidates[winner_idx].text

    # ── Final score on held-out val split ─────────────────────────────────────
    score_after = await _score_prompt(
        best_prompt, val_split[:_MAX_VAL_EXAMPLES], fast_llm, judge_llm
    )

    # ── Tournament stats for UI display ──────────────────────────────────────
    winner_wins = int(sum(wm.W[winner_idx][j] for j in range(wm.size) if j != winner_idx))
    winner_total = int(sum(wm.N[winner_idx][j] for j in range(wm.size) if j != winner_idx))
    win_rate = round(winner_wins / winner_total, 4) if winner_total > 0 else 0.0
    candidates_tried = len(candidates)
    rounds_run = _TOURNAMENT_ROUNDS

    _log.info(
        "PDO complete: %d candidates, %d rounds, win_rate=%.2f, score %.3f → %.3f",
        candidates_tried,
        rounds_run,
        win_rate,
        score_before,
        score_after,
    )

    return {
        "optimized_prompt": best_prompt,
        "score_before": round(score_before, 4),
        "score_after": round(score_after, 4),
        "win_rate": win_rate,
        "candidates_tried": candidates_tried,
        "rounds_run": rounds_run,
        "dataset_size": len(pairs),
    }
