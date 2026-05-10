"""
Domain prompt optimizer — Prompt Duel Optimizer (PDO).

Faithful implementation of arXiv:2510.13907
("LLM Prompt Duel Optimizer: Efficient Label-Free Prompt Optimization")
as released in meta-llama/prompt-ops.

Pipeline (Algorithm 1 in the paper):
  1. Generate K initial candidate prompt variants from the base prompt.
  2. Run T tournament rounds using Double Thompson Sampling (D-TS):
       Step 1 — Select i* via optimistic Copeland scores + Thompson sampling.
       Step 2 — Select j* from uncertain opponents of i* via Thompson sampling.
       Duel: both prompts answer a randomly drawn Q&A; dual LLM judge picks winner.
       Update W[i,j] with weighted preference (γ_answer=0.5, γ_reasoning=0.2).
  3. Every M rounds: prune 10 lowest Copeland-score prompts, then generate
     10 new mutations from the top-3 Copeland leaders (top-performer guided mutation).
  4. Return the Copeland winner (tiebreak: avg win rate).

Constants scaled for interactive web use vs. the paper's BBH/MS-MARCO experiments:
  K=10 initial candidates  (paper: 20–50)
  T=30 tournament rounds   (paper: 30)
  M=10 mutation interval   (paper: rounds 10 and 20)
  1 duel per round         (paper: m=25 per round — cost constraint)
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
from dataclasses import dataclass, field
from typing import Any

from app.domain_prompt.constants.optimizer import (
    GAMMA_ANSWER,
    GAMMA_REASONING,
    JUDGE_MAX_TOKENS,
    MAX_SCORE_EXAMPLES,
    MAX_VAL_EXAMPLES,
    MUTATION_BATCH,
    MUTATION_INTERVAL,
    MUTATION_MAX_TOKENS,
    MUTATION_SOURCES,
    NUM_CANDIDATES,
    PRUNE_COUNT,
    SCORE_MAX_TOKENS,
    TOURNAMENT_ROUNDS,
    UCB_ALPHA,
    VARIANT_MAX_TOKENS,
)
from app.domain_prompt.prompts.optimizer import (
    ANSWER_JUDGE_SYSTEM,
    MUTATION_SYSTEM,
    MUTATION_TIPS,
    REASONING_JUDGE_SYSTEM,
    SCORE_SYSTEM,
    VARIANT_SYSTEM,
    VARIANT_TIPS,
)
from app.llm import LLMClient
from app.llm.optimizer import build_duel_answerer, build_duel_judge, build_variant_generator

_log = logging.getLogger(__name__)


# ── Data structures ───────────────────────────────────────────────────────────
@dataclass
class _Candidate:
    text: str


@dataclass
class _WinMatrix:
    """Pairwise win (W) and comparison-count (N) matrices.

    W[i][j] is the fractional win score of i against j (sums with W[j][i] to 1.0 per duel).
    N[i][j] counts total duels between i and j (symmetric).
    """

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

    def record_win(self, winner: int, loser: int, gamma: float) -> None:
        """Weighted preference update (paper Appendix E.2).

        W_ij + W_ji = 1.0 per duel (conserved).
        gamma=0.5  → winner gets 1.0, loser 0.0  (full confidence, answer-based)
        gamma=0.2  → winner gets 0.7, loser 0.3  (discounted, reasoning-based)
        """
        w_win = 0.5 + gamma
        w_lose = 0.5 - gamma
        self.W[winner][loser] += w_win
        self.W[loser][winner] += w_lose
        self.N[winner][loser] += 1.0
        self.N[loser][winner] += 1.0

    def remove_candidate(self, idx: int) -> None:
        """Remove a candidate by index (for pruning)."""
        self.W.pop(idx)
        self.N.pop(idx)
        for row in self.W:
            row.pop(idx)
        for row in self.N:
            row.pop(idx)
        self.size -= 1

    def ucb(self, i: int, j: int, t: int) -> float:
        """Upper confidence bound for p(i beats j) — paper §4.1."""
        n_ij = self.N[i][j]
        if n_ij == 0:
            return 1.0  # optimistic: unplayed matchup assumed won
        mu = self.W[i][j] / n_ij
        return min(1.0, mu + math.sqrt(UCB_ALPHA * math.log(max(t, 1)) / n_ij))

    def lcb(self, i: int, j: int, t: int) -> float:
        """Lower confidence bound for p(i beats j) — paper §4.1."""
        n_ij = self.N[i][j]
        if n_ij == 0:
            return 0.0
        mu = self.W[i][j] / n_ij
        return max(0.0, mu - math.sqrt(UCB_ALPHA * math.log(max(t, 1)) / n_ij))


# ── LLM helpers ───────────────────────────────────────────────────────────────
_PLACEHOLDER_MARKERS = (
    "[all previous content remains identical]",
    "[same as above]",
    "[unchanged]",
    "[rest of prompt]",
    "[previous content]",
    "[content remains the same]",
    "[existing content]",
    "[original content]",
    "remains identical]",
    "remains unchanged]",
    "rest of the prompt remains",
    "remaining sections remain",
    "remaining content remains",
    "rest remains identical",
    "rest remains the same",
    "rest of the content remains",
    "all other sections remain",
    "preserving all existing",
    "all remaining sections",
    "refer to the original",
    "refer to original prompt",
    "same as the original",
    "identical to the original",
    "[continues as before]",
    "[content continues]",
    "[same structure follows]",
)


def _is_placeholder_variant(text: str, base_prompt: str) -> bool:
    lower = text.lower()
    if any(marker in lower for marker in _PLACEHOLDER_MARKERS):
        return True
    if len(text) < len(base_prompt) * 0.3:
        return True
    return False


def _strip_fences(text: str) -> str:
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _json_loads_tolerant(raw: str) -> Any:
    """Parse JSON that may contain unescaped control characters inside string values."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        result_chars: list[str] = []
        in_string = False
        i = 0
        while i < len(raw):
            ch = raw[i]
            if in_string:
                if ch == "\\":
                    result_chars.append(ch)
                    if i + 1 < len(raw):
                        i += 1
                        result_chars.append(raw[i])
                elif ch == '"':
                    in_string = False
                    result_chars.append(ch)
                elif ch == "\n":
                    result_chars.append("\\n")
                elif ch == "\r":
                    result_chars.append("\\r")
                elif ch == "\t":
                    result_chars.append("\\t")
                else:
                    result_chars.append(ch)
            else:
                if ch == '"':
                    in_string = True
                result_chars.append(ch)
            i += 1
        return json.loads("".join(result_chars))


def _build_domain_summary(pairs: list[dict[str, str]], max_samples: int = 5) -> tuple[str, str]:
    sample = pairs[:max_samples]
    questions_block = "\n".join(f"- {p['question']}" for p in sample)
    topics = ", ".join(" ".join(p["question"].split()[:6]) for p in sample[:3])
    domain_summary = f"This domain covers topics such as: {topics}."
    return domain_summary, questions_block


# ── Candidate generation ──────────────────────────────────────────────────────
async def _generate_one_variant(
    base_prompt: str,
    tip_name: str,
    tip_instructions: str,
    gen_llm: LLMClient,
    domain_summary: str,
    sample_questions: str,
) -> str | None:
    system = VARIANT_SYSTEM.format(
        tip_name=tip_name,
        tip_instructions=tip_instructions,
        domain_summary=domain_summary,
        sample_questions=sample_questions,
    )
    try:
        llm = gen_llm.model_copy(update={"max_tokens": VARIANT_MAX_TOKENS})
        response = await llm.ainvoke(
            [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": (
                        "Apply the generation tip to this prompt. "
                        f"Copy it in full, then apply your targeted improvements:\n\n{base_prompt}"
                    ),
                },
            ]
        )
        variant = _strip_fences(str(response.content).strip())
        if not variant or _is_placeholder_variant(variant, base_prompt):
            _log.warning(
                "Variant tip '%s' produced placeholder or empty output — discarding", tip_name
            )
            return None
        return variant
    except Exception as exc:  # noqa: BLE001
        _log.warning("Variant generation failed for tip '%s': %s", tip_name, exc)
        return None


async def _generate_variants(
    base_prompt: str,
    n: int,
    gen_llm: LLMClient,
    domain_summary: str,
    sample_questions: str,
) -> list[str]:
    tips = VARIANT_TIPS[:n]
    tasks = [
        _generate_one_variant(
            base_prompt, name, instructions, gen_llm, domain_summary, sample_questions
        )
        for name, instructions in tips
    ]
    results = await asyncio.gather(*tasks)
    variants = [v for v in results if v is not None and v != base_prompt]
    if variants:
        _log.info("Generated %d/%d variants successfully", len(variants), len(tips))
        return variants
    _log.error("All variant generation calls failed — falling back to base prompt only")
    return [base_prompt]


# ── Mutation ──────────────────────────────────────────────────────────────────
async def _generate_one_mutation(
    source_prompt: str,
    tip_name: str,
    tip_instructions: str,
    gen_llm: LLMClient,
    domain_summary: str,
) -> str | None:
    system = MUTATION_SYSTEM.format(
        tip_name=tip_name,
        tip_instructions=tip_instructions,
        domain_summary=domain_summary,
    )
    try:
        llm = gen_llm.model_copy(update={"max_tokens": MUTATION_MAX_TOKENS})
        response = await llm.ainvoke(
            [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": (
                        "Apply the mutation to this prompt. "
                        f"Copy it in full, then apply your targeted improvement:\n\n{source_prompt}"
                    ),
                },
            ]
        )
        mutated = _strip_fences(str(response.content).strip())
        not_placeholder = not _is_placeholder_variant(mutated, source_prompt)
        if mutated and mutated != source_prompt and not_placeholder:
            return mutated
        if mutated and _is_placeholder_variant(mutated, source_prompt):
            _log.warning("Mutation tip '%s' produced placeholder text — discarding", tip_name)
    except Exception as exc:  # noqa: BLE001
        _log.warning("Mutation tip '%s' failed: %s", tip_name, exc)
    return None


async def _generate_mutation_batch(
    top_sources: list[str],
    batch_size: int,
    gen_llm: LLMClient,
    domain_summary: str,
    tip_idx_start: int,
) -> list[str]:
    """Generate batch_size mutations by cycling through mutation tips and source prompts."""
    tasks = []
    for k in range(batch_size):
        source = top_sources[k % len(top_sources)]
        tip_name, tip_instructions = MUTATION_TIPS[(tip_idx_start + k) % len(MUTATION_TIPS)]
        tasks.append(
            _generate_one_mutation(source, tip_name, tip_instructions, gen_llm, domain_summary)
        )
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]


# ── Answering ─────────────────────────────────────────────────────────────────
async def _get_answer(prompt: str, question: str, llm: LLMClient) -> str:
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


def _answers_differ(ans_a: str, ans_b: str) -> bool:
    """Heuristic: answers differ if they share fewer than 70% of content words."""
    words_a = set(ans_a.lower().split())
    words_b = set(ans_b.lower().split())
    if not words_a or not words_b:
        return True
    overlap = len(words_a & words_b) / max(len(words_a), len(words_b))
    return overlap < 0.7


# ── Dual judge duel (paper §2 / Appendix E) ──────────────────────────────────
async def _duel(
    prompt_a: str,
    prompt_b: str,
    question: str,
    gold: str,
    llm: LLMClient,
    judge_llm: LLMClient,
    rng: random.Random,
) -> tuple[int, float]:
    """Run one duel. Returns (winner_index, gamma).

    winner_index: 0 = prompt_a wins, 1 = prompt_b wins.
    gamma: _GAMMA_ANSWER if answers differed (high confidence),
           _GAMMA_REASONING if answers matched (lower confidence).

    Position bias is eliminated by randomising which prompt appears as "A".
    """
    flip = rng.random() < 0.5
    first_prompt = prompt_b if flip else prompt_a
    second_prompt = prompt_a if flip else prompt_b

    ans_first, ans_second = await asyncio.gather(
        _get_answer(first_prompt, question, llm),
        _get_answer(second_prompt, question, llm),
    )

    # Select judge type based on whether answers diverge (paper §2)
    answers_differ = _answers_differ(ans_first, ans_second)
    judge_system = ANSWER_JUDGE_SYSTEM if answers_differ else REASONING_JUDGE_SYSTEM
    gamma = GAMMA_ANSWER if answers_differ else GAMMA_REASONING

    try:
        j_llm = judge_llm.model_copy(update={"max_tokens": JUDGE_MAX_TOKENS})
        response = await j_llm.ainvoke(
            [
                {"role": "system", "content": judge_system},
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
        result: Any = _json_loads_tolerant(raw)
        winner_label = str(result.get("winner", "")).upper().strip()
        if winner_label not in ("A", "B"):
            raise ValueError(f"Unexpected winner label: {winner_label!r}")
        winner_is_first = winner_label == "A"
        if flip:
            # first=B, second=A → "A wins" means B (original index 1) wins
            winner_original = 1 if winner_is_first else 0
        else:
            winner_original = 0 if winner_is_first else 1
        return winner_original, gamma
    except Exception as exc:  # noqa: BLE001
        _log.warning("Duel judge failed: %s — random tiebreak", exc)
        return rng.randint(0, 1), GAMMA_REASONING  # noqa: S311


# ── Scoring (held-out evaluation) ─────────────────────────────────────────────
async def _score_one(
    prompt: str,
    question: str,
    gold: str,
    llm: LLMClient,
    judge_llm: LLMClient,
) -> float:
    predicted = await _get_answer(prompt, question, llm)
    try:
        sc_llm = judge_llm.model_copy(update={"max_tokens": SCORE_MAX_TOKENS})
        response = await sc_llm.ainvoke(
            [
                {"role": "system", "content": SCORE_SYSTEM},
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
        return max(0.0, min(1.0, float(obj.get("score", 0.0))))
    except Exception as exc:  # noqa: BLE001
        _log.warning("Score judge failed: %s", exc)
        return 0.0


async def _score_prompt(
    prompt: str,
    examples: list[dict[str, str]],
    llm: LLMClient,
    judge_llm: LLMClient,
) -> float:
    if not examples:
        return 0.0
    batch = examples[:MAX_SCORE_EXAMPLES]
    scores = await asyncio.gather(
        *[_score_one(prompt, ex["question"], ex["answer"], llm, judge_llm) for ex in batch]
    )
    return sum(scores) / len(scores) if scores else 0.0


# ── Copeland scoring (paper §2) ───────────────────────────────────────────────
def _copeland_scores(wm: _WinMatrix, t: int) -> list[float]:
    """Optimistic Copeland score for each candidate using UCB estimates (paper §4.1).

    ζ̂_i(t) = (1/(K-1)) * Σ_{j≠i} 1{ ucb(i,j,t) ≥ 0.5 }
    """
    n = wm.size
    scores = [0.0] * n
    for i in range(n):
        count = sum(1 for j in range(n) if j != i and wm.ucb(i, j, t) >= 0.5)
        scores[i] = count / max(n - 1, 1)
    return scores


def _avg_win_rate(wm: _WinMatrix, idx: int) -> float:
    wins = sum(wm.W[idx][j] for j in range(wm.size) if j != idx)
    total = sum(wm.N[idx][j] for j in range(wm.size) if j != idx)
    return wins / total if total > 0 else 0.5


def _copeland_winner(wm: _WinMatrix, t: int) -> int:
    """Return the Copeland winner index. Tiebreak: average win rate (paper §2)."""
    scores = _copeland_scores(wm, t)
    best_score = max(scores)
    tied = [i for i, s in enumerate(scores) if s == best_score]
    if len(tied) == 1:
        return tied[0]
    return max(tied, key=lambda i: _avg_win_rate(wm, i))


def _copeland_ranking(wm: _WinMatrix, t: int) -> list[int]:
    """Return candidate indices sorted by Copeland score descending (tiebreak: avg win rate)."""
    scores = _copeland_scores(wm, t)
    return sorted(range(wm.size), key=lambda i: (scores[i], _avg_win_rate(wm, i)), reverse=True)


# ── D-TS pair selection (paper Algorithm 1 + §4) ─────────────────────────────
def _select_duel_pair(wm: _WinMatrix, rng: random.Random, t: int) -> tuple[int, int]:
    """Two-stage Double Thompson Sampling — faithful to paper Algorithm 1.

    Step 1: Compute optimistic Copeland scores ζ̂_i(t) for each candidate.
            Among the set of maximizers ζ(t), for each i draw θ^(1)_ij ~ Beta(W_ij+1, W_ji+1)
            for all j≠i and count s_i = #{j: θ^(1)_ij ≥ 0.5}. Pick i* = argmax s_i.

    Step 2: Restrict to "uncertain opponents" of i*:
            S_{i*}(t) = {j ≠ i* : lcb(i*, j, t) ≤ 0.5}
            For each j ∈ S_{i*}(t), draw θ^(2)_{j,i*} ~ Beta(W_ji*+1, W_i*j+1).
            Pick j* = argmax θ^(2)_{j,i*}.
    """
    n = wm.size
    if n < 2:
        return 0, 0

    # Step 1 — select i*
    cop_scores = _copeland_scores(wm, t)
    best_cop = max(cop_scores)
    maximizers = [i for i, s in enumerate(cop_scores) if s == best_cop]

    best_si = -1
    best_i = maximizers[0]
    for i in maximizers:
        si = 0
        for j in range(n):
            if j == i:
                continue
            alpha = wm.W[i][j] + 1.0
            beta_val = wm.W[j][i] + 1.0
            theta = rng.betavariate(alpha, beta_val)
            if theta >= 0.5:
                si += 1
        if si > best_si:
            best_si = si
            best_i = i

    # Step 2 — select j* from uncertain opponents of i*
    uncertain = [j for j in range(n) if j != best_i and wm.lcb(best_i, j, t) <= 0.5]
    if not uncertain:
        # All opponents already confidently dominated — pick a random one
        others = [j for j in range(n) if j != best_i]
        return best_i, rng.choice(others)  # noqa: S311

    best_theta_j = -1.0
    best_j = uncertain[0]
    for j in uncertain:
        # Draw θ^(2)_{j,i*}: sample from j's perspective against i*
        alpha = wm.W[j][best_i] + 1.0
        beta_val = wm.W[best_i][j] + 1.0
        theta = rng.betavariate(alpha, beta_val)
        if theta > best_theta_j:
            best_theta_j = theta
            best_j = j

    return best_i, best_j


# ── Live state emission ───────────────────────────────────────────────────────
async def _emit_tournament_state(
    domain_id: str | None,
    round_idx: int,
    total_rounds: int,
    candidates: list[_Candidate],
    wm: _WinMatrix,
    duel_i: int,
    duel_j: int,
    question_snippet: str,
    t: int,
) -> None:
    if domain_id is None:
        return
    try:
        # local import avoids circular dependency between core and infrastructure
        from app.domain_prompt.infrastructure.cache import set_dp_tournament_state

        cop_scores = _copeland_scores(wm, t)
        state: dict[str, object] = {
            "round": round_idx + 1,
            "total_rounds": total_rounds,
            "candidate_count": len(candidates),
            "names": [f"C{k}" for k in range(len(candidates))],
            "copeland_scores": [round(s, 3) for s in cop_scores],
            "avg_win_rates": [round(_avg_win_rate(wm, i), 3) for i in range(wm.size)],
            "W": [[round(wm.W[r][c], 2) for c in range(wm.size)] for r in range(wm.size)],
            "duel_i": duel_i,
            "duel_j": duel_j,
            "question": question_snippet[:120],
        }
        await set_dp_tournament_state(domain_id, state)
    except Exception as exc:  # noqa: BLE001
        _log.warning("Failed to emit tournament state: %s", exc)


# ── Main entry point ──────────────────────────────────────────────────────────
async def optimize_domain_prompt(
    base_prompt: str,
    dataset_jsonl: str,
    api_key: str,
    num_candidates: int = NUM_CANDIDATES,
    domain_id: str | None = None,
) -> dict[str, object]:
    """
    Run the PDO algorithm (arXiv:2510.13907) and return the best domain-specific system prompt.

    Returns dict with keys:
        optimized_prompt  (str)
        score_before      (float, 0–1)
        score_after       (float, 0–1)
        win_rate          (float)
        candidates_tried  (int)
        rounds_run        (int)
        dataset_size      (int)
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

    # 50/50 split (paper §4 — equal dev/test splits)
    rng = random.Random(42)  # noqa: S311
    shuffled = list(pairs)
    rng.shuffle(shuffled)
    n_total = len(shuffled)
    n_val = max(1, n_total // 2)
    val_split = shuffled[-n_val:]
    duel_pool = shuffled[: n_total - n_val] or shuffled  # tiny dataset fallback

    # ── LLM clients ───────────────────────────────────────────────────────────
    fast_llm = build_duel_answerer(api_key)
    gen_llm = build_variant_generator(api_key)
    judge_llm = build_duel_judge(api_key)

    domain_summary, sample_questions = _build_domain_summary(duel_pool)

    # ── Baseline score ────────────────────────────────────────────────────────
    score_before = await _score_prompt(
        base_prompt, val_split[:MAX_VAL_EXAMPLES], fast_llm, judge_llm
    )

    # ── Generate initial candidate pool ──────────────────────────────────────
    # Base prompt is always slot 0 (paper Appendix C.2).
    n_variants = max(1, num_candidates - 1)
    variant_texts = await _generate_variants(
        base_prompt, n_variants, gen_llm, domain_summary, sample_questions
    )
    all_texts = [base_prompt] + [v for v in variant_texts if v != base_prompt]
    seen: set[str] = set()
    unique: list[str] = []
    for v in all_texts:
        if v not in seen:
            seen.add(v)
            unique.append(v)
    initial_texts = unique[:num_candidates]

    candidates = [_Candidate(text=t) for t in initial_texts]
    wm = _WinMatrix(size=len(candidates))

    if len(candidates) < 2:
        _log.error("Only 1 candidate generated — returning base prompt unchanged.")
        score_after = await _score_prompt(
            base_prompt, val_split[:MAX_VAL_EXAMPLES], fast_llm, judge_llm
        )
        return {
            "optimized_prompt": base_prompt,
            "score_before": round(score_before, 4),
            "score_after": round(score_after, 4),
        }

    _log.info(
        "Starting PDO tournament with %d candidates, %d rounds", len(candidates), TOURNAMENT_ROUNDS
    )

    # ── PDO tournament (D-TS) ─────────────────────────────────────────────────
    mutation_tip_idx = 0
    for round_idx in range(TOURNAMENT_ROUNDS):
        t = round_idx + 1  # 1-indexed round count (used in UCB/LCB log term)

        i, j = _select_duel_pair(wm, rng, t)
        ex = rng.choice(duel_pool)  # noqa: S311
        question, gold = ex["question"], ex["answer"]

        await _emit_tournament_state(
            domain_id, round_idx, TOURNAMENT_ROUNDS, candidates, wm, i, j, question, t
        )

        duel_result, gamma = await _duel(
            candidates[i].text, candidates[j].text, question, gold, fast_llm, judge_llm, rng
        )
        winner_idx, loser_idx = (i, j) if duel_result == 0 else (j, i)
        wm.record_win(winner_idx, loser_idx, gamma)

        # Top-performer guided mutation + pruning every M rounds (paper §3.2)
        if t % MUTATION_INTERVAL == 0:
            ranking = _copeland_ranking(wm, t)

            # Prune bottom _PRUNE_COUNT candidates (paper: remove 10 lowest Copeland)
            to_prune = ranking[len(ranking) - PRUNE_COUNT :]  # lowest Copeland indices
            # Remove in reverse index order so earlier removals don't shift later indices
            for idx in sorted(to_prune, reverse=True):
                candidates.pop(idx)
                wm.remove_candidate(idx)
                _log.debug("Round %d: pruned candidate C%d", t, idx)

            # Re-rank after pruning
            ranking = _copeland_ranking(wm, t)
            top_k = min(MUTATION_SOURCES, len(ranking))
            top_sources = [candidates[ranking[k]].text for k in range(top_k)]

            # Generate _MUTATION_BATCH new candidates from top sources
            new_texts = await _generate_mutation_batch(
                top_sources, MUTATION_BATCH, gen_llm, domain_summary, mutation_tip_idx
            )
            mutation_tip_idx += MUTATION_BATCH
            existing_texts = {c.text for c in candidates}
            added = 0
            for text in new_texts:
                if text not in existing_texts:
                    candidates.append(_Candidate(text=text))
                    wm.add_candidate()
                    existing_texts.add(text)
                    added += 1
            _log.info(
                "Round %d: pruned %d, added %d mutations (pool=%d)",
                t,
                min(PRUNE_COUNT, len(to_prune)),
                added,
                len(candidates),
            )

    # ── Copeland winner (paper §2) ────────────────────────────────────────────
    final_t = TOURNAMENT_ROUNDS
    winner_idx = _copeland_winner(wm, final_t)
    best_prompt = candidates[winner_idx].text

    # ── Final score on held-out val split ─────────────────────────────────────
    score_after = await _score_prompt(
        best_prompt, val_split[:MAX_VAL_EXAMPLES], fast_llm, judge_llm
    )

    # ── Stats ─────────────────────────────────────────────────────────────────
    winner_wins = sum(wm.W[winner_idx][j] for j in range(wm.size) if j != winner_idx)
    winner_total = sum(wm.N[winner_idx][j] for j in range(wm.size) if j != winner_idx)
    win_rate = round(winner_wins / winner_total, 4) if winner_total > 0 else 0.0

    _log.info(
        "PDO complete: %d candidates, %d rounds, win_rate=%.2f, score %.3f → %.3f",
        len(candidates),
        TOURNAMENT_ROUNDS,
        win_rate,
        score_before,
        score_after,
    )

    return {
        "optimized_prompt": best_prompt,
        "score_before": round(score_before, 4),
        "score_after": round(score_after, 4),
        "win_rate": win_rate,
        "candidates_tried": len(candidates),
        "rounds_run": TOURNAMENT_ROUNDS,
        "dataset_size": len(pairs),
    }
