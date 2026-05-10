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

# Token budgets — variants/mutations need room to rewrite prompts that may be 3k+ tokens long.
# Scoring and judging only emit short JSON so they stay cheap.
_VARIANT_MAX_TOKENS = 8192  # a 3k-token base prompt needs ~6k tokens room for a full rewrite
_MUTATION_MAX_TOKENS = 8192  # same reasoning — mutations must also be complete rewrites
_JUDGE_MAX_TOKENS = 128  # {"winner": "A"} or {"winner": "B"} + reasoning
_SCORE_MAX_TOKENS = 64  # {"score": 0.87}

# ── LLM system prompts ────────────────────────────────────────────────────────
#
# System prompt design principles applied here (from SPRIG, MPO, APO research):
#   - Effective system prompts have 5–6 discrete modular sections: role, behavioral rules,
#     domain knowledge, conditional use-case instructions, output format, fallback behavior.
#   - Peak performance is at 400–800 tokens. Concise, precise instructions beat verbose prose.
#   - Conditional rules ("if user asks X, do Y") outperform examples for discrete decision cases.
#   - Examples in system prompts are appropriate ONLY for output format anchoring — not for
#     teaching domain knowledge or demonstrating reasoning. We exclude them here because
#     domain prompt users are optimizing system prompts that will be deployed as behavioral
#     frameworks, not as in-context learners.
#   - Positive instructions ("always state sources") outperform negative ones ("don't hallucinate").
#   - Each variant is a complete, standalone rewrite through one optimization lens.

_VARIANT_SYSTEM = textwrap.dedent("""
    You are a world-class prompt engineer specializing in system prompt optimization.
    You will receive an existing system prompt and must produce ONE complete, improved
    rewrite of it using the optimization strategy described below.

    Domain context (what this assistant must be expert at):
    {domain_summary}

    Sample questions this assistant must handle well:
    {sample_questions}

    Optimization strategy: {strategy_name}
    {strategy_instructions}

    ABSOLUTE RULES:
    - Output a COMPLETE system prompt — not a diff, not an extension, not a summary.
    - The output must stand alone as a fully functional system prompt.
    - Preserve the core role and intent of the original — do not change what the assistant IS.
    - You may restructure, reword, expand, tighten, or reorganize any part of the original.
    - Do NOT include Q&A examples or worked demonstrations in the output — these belong in
      the conversation, not the system prompt. Use explicit conditional rules instead.
    - Do NOT use placeholders like "[same as original]" or "[previous content]".
    - Output ONLY the system prompt text. No explanation, no preamble, no quotes.
""").strip()

# Four variant strategies — each produces a complete rewrite through a distinct lens.
# Research basis: MPO (modular section optimization), SPRIG (edit-based genetic), APO (gradients).
# No "few-shot examples" strategy — conditional rules are strictly preferred for system prompts.
_VARIANT_STRATEGIES: list[tuple[str, str]] = [
    (
        "ROLE PRECISION & BEHAVIORAL RULES",
        "Rewrite the prompt with a sharp, specific role definition followed by clear behavioral "
        "rules stated as positive obligations ('always do X', 'base every claim on Y'). "
        "Replace any vague or hedged language ('try to', 'consider', 'generally') with concrete "
        "directives. Keep the role section to 2–3 sentences; enumerate 5–8 behavioral rules as "
        "a bullet list. Research shows enumerated constraints are processed more reliably than "
        "prose — make every rule a discrete, checkable statement.",
    ),
    (
        "DOMAIN KNOWLEDGE & CONDITIONAL USE-CASES",
        "Rewrite the prompt to embed the domain's core principles, frameworks, and decision "
        "logic directly into the instructions. Study the sample questions to identify the "
        "specific situations this assistant will face, then add conditional use-case rules: "
        "'When the user asks about X, apply Y framework and consider Z.' "
        "'If the question involves [situation], prioritize [approach] over [alternative].' "
        "These conditional rules encode the domain expert's judgment as explicit branching "
        "logic — not examples, but IF/WHEN/IF-NOT rules the model can apply deterministically.",
    ),
    (
        "STRUCTURED REASONING PROTOCOL",
        "Rewrite the prompt to define a mandatory reasoning protocol the model must follow "
        "for every response. Based on the sample questions, identify what type of reasoning "
        "this domain requires (analytical, comparative, procedural, diagnostic, etc.), then "
        "embed a numbered step protocol: step 1 identify the question type, step 2 recall the "
        "most relevant domain principle, step 3 reason through it explicitly, step 4 state the "
        "answer with appropriate precision, step 5 flag uncertainty or edge cases. "
        "This protocol should be domain-specific — not a generic 'think step by step' instruction.",
    ),
    (
        "OUTPUT FORMAT & FALLBACK BEHAVIOR",
        "Rewrite the prompt to specify exactly how outputs should be structured and what to do "
        "in every edge case. Define: when to use bullet points vs prose vs tables; expected "
        "answer length for different question types; how to express uncertainty (e.g. 'Based on "
        "available information...' rather than making up facts); what to say verbatim when a "
        "question is out of scope or unanswerable from available knowledge; and how to handle "
        "contradictory or incomplete information. Every edge case must have a scripted behavior "
        "— the model must never improvise in ambiguous situations.",
    ),
]

_MUTATION_SYSTEM = textwrap.dedent("""
    You are a world-class prompt engineer. You are given the current best-performing system
    prompt and must produce ONE improved rewrite following the mutation strategy below.

    Domain context: {domain_summary}

    Mutation strategy: {strategy_name}
    {strategy_instructions}

    ABSOLUTE RULES:
    - Output the COMPLETE rewritten prompt — not a diff, not a patch, not an extension.
    - The result must be a fully self-contained, functional system prompt.
    - Preserve the core role and identity of the assistant — do not change what it IS.
    - You may restructure, tighten, expand, or reorganize any part.
    - Do NOT include Q&A examples or worked demonstrations — use explicit conditional rules instead.
    - NEVER use placeholders like "[ALL PREVIOUS CONTENT REMAINS IDENTICAL]", "[same as above]",
      "[unchanged]", or any shorthand. Write the full text every time.

    Output ONLY the rewritten prompt text. No preamble, no explanation, no quotes.
""").strip()

# Five mutation strategies cycling through different improvement axes.
# All produce conditional/rule-based improvements — no example injection.
_MUTATION_STRATEGIES: list[tuple[str, str]] = [
    (
        "INSTRUCTION SHARPENING",
        "Audit every sentence in the current prompt for vagueness. Rewrite the entire prompt "
        "replacing hedged or weak instructions with concrete, positive obligations. "
        "Every 'try to', 'consider', 'generally', 'if possible' becomes a hard rule. "
        "Every prohibition ('don't do X') becomes a positive directive ('instead do Y'). "
        "The result should have zero ambiguous instructions.",
    ),
    (
        "CONDITIONAL USE-CASE RULES",
        "Study the domain context and identify 3–5 specific situations or question types this "
        "assistant will regularly face. Rewrite the prompt to add explicit conditional rules "
        "for each: 'When the user asks about [situation], apply [specific approach].' "
        "'If the question involves [condition], prioritize [action] over [alternative].' "
        "'If information is missing or ambiguous, [specific scripted response].' "
        "These rules replace any generic instructions with domain-specific branching logic.",
    ),
    (
        "DOMAIN PRINCIPLES SECTION",
        "Rewrite the prompt to add a clearly delineated 'Domain Knowledge' or 'Core Principles' "
        "section containing 4–6 domain-specific rules-of-thumb, decision frameworks, or "
        "factual anchors the model must apply. These must be specific to this domain — not "
        "generic reasoning advice. Each principle should be 1–2 sentences, stated as a rule "
        "the model actively applies, not background information.",
    ),
    (
        "RESPONSE FORMAT PRECISION",
        "Rewrite the prompt to specify output format with surgical precision. Define: the exact "
        "structure for different answer types (factual vs analytical vs procedural questions); "
        "when to use numbered lists, bullets, or prose; target length ranges; how to express "
        "confidence levels; mandatory epistemic qualifiers for uncertain claims. Format rules "
        "should be stated as 'always', 'never', and 'when X use Y' — not vague preferences.",
    ),
    (
        "FALLBACK & EDGE-CASE HARDENING",
        "Identify the gaps in the current prompt — situations where the model would have to "
        "improvise because no rule covers them. Rewrite the prompt to add explicit fallback "
        "behaviors: what to say when a question is out of scope; how to handle contradictory "
        "information; what to do when the user asks for something the assistant cannot verify; "
        "how to escalate or redirect when needed. Every gap must have a scripted rule, "
        "not left to the model's discretion.",
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
)


def _is_placeholder_variant(text: str, base_prompt: str) -> bool:
    """Return True if the variant contains shorthand placeholders rather than real content."""
    lower = text.lower()
    if any(marker in lower for marker in _PLACEHOLDER_MARKERS):
        return True
    # Reject suspiciously short outputs — likely a truncated or failed response.
    # Full rewrites can be shorter than the original (e.g. CLARITY strategy trims bloat),
    # so we only reject if the output is under 30% of the base — clearly incomplete.
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
    """Parse JSON that may contain unescaped control characters inside string values.

    LLMs sometimes emit literal newlines/tabs inside JSON strings rather than \\n/\\t.
    We try strict parse first; on failure, sanitize control chars inside quoted regions only.
    """
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Replace control characters that appear inside JSON string literals.
        # We scan character-by-character tracking whether we're inside a quoted string.
        result_chars: list[str] = []
        in_string = False
        i = 0
        while i < len(raw):
            ch = raw[i]
            if in_string:
                if ch == "\\":
                    # Pass through escape sequence unchanged
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
    """Return (domain_summary_sentence, sample_questions_block) from dataset pairs."""
    sample = pairs[:max_samples]
    questions_block = "\n".join(f"- {p['question']}" for p in sample)
    # Single-sentence domain hint derived from the first few questions
    topics = ", ".join(" ".join(p["question"].split()[:6]) for p in sample[:3])
    domain_summary = f"This domain covers topics such as: {topics}."
    return domain_summary, questions_block


async def _generate_one_variant(
    base_prompt: str,
    strategy_name: str,
    strategy_instructions: str,
    gen_llm: ChatOpenAI,
    domain_summary: str,
    sample_questions: str,
) -> str | None:
    """Generate one full prompt rewrite using a single strategy. Returns None on failure."""
    system = _VARIANT_SYSTEM.format(
        strategy_name=strategy_name,
        strategy_instructions=strategy_instructions,
        domain_summary=domain_summary,
        sample_questions=sample_questions,
    )
    try:
        gen_llm = gen_llm.model_copy(update={"max_tokens": _VARIANT_MAX_TOKENS})
        response = await gen_llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": f"Original system prompt to rewrite:\n\n{base_prompt}"},
            ]
        )
        variant = _strip_fences(str(response.content).strip())
        if not variant:
            return None
        if _is_placeholder_variant(variant, base_prompt):
            _log.warning("Variant '%s' contained placeholder text — discarding", strategy_name)
            return None
        _log.debug("Generated variant '%s' (%d chars)", strategy_name, len(variant))
        return variant
    except Exception as exc:  # noqa: BLE001
        _log.warning("Variant generation failed for strategy '%s': %s", strategy_name, exc)
        return None


async def _generate_variants(
    base_prompt: str,
    n: int,
    gen_llm: ChatOpenAI,
    domain_summary: str,
    sample_questions: str,
) -> list[str]:
    # One parallel LLM call per strategy — each produces a complete rewrite.
    # This avoids the JSON-array-of-long-strings encoding problem and gives each
    # strategy its full token budget. We take the first n successful results.
    strategies = _VARIANT_STRATEGIES[:n]
    tasks = [
        _generate_one_variant(
            base_prompt, name, instructions, gen_llm, domain_summary, sample_questions
        )
        for name, instructions in strategies
    ]
    results = await asyncio.gather(*tasks)
    variants = [v for v in results if v is not None and v != base_prompt]

    if variants:
        _log.info("Generated %d/%d variants successfully", len(variants), len(strategies))
        return variants

    _log.error("All variant generation calls failed — falling back to base prompt only")
    return [base_prompt]


async def _mutate_prompt(
    prompt: str,
    gen_llm: ChatOpenAI,
    domain_summary: str,
    strategy_idx: int,
) -> str:
    strategy_name, strategy_instructions = _MUTATION_STRATEGIES[
        strategy_idx % len(_MUTATION_STRATEGIES)
    ]
    system = _MUTATION_SYSTEM.format(
        strategy_name=strategy_name,
        strategy_instructions=strategy_instructions,
        domain_summary=domain_summary,
    )
    try:
        mut_llm = gen_llm.model_copy(update={"max_tokens": _MUTATION_MAX_TOKENS})
        response = await mut_llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": f"Current best-performing prompt:\n\n{prompt}"},
            ]
        )
        mutated = _strip_fences(str(response.content).strip())
        if mutated and mutated != prompt and not _is_placeholder_variant(mutated, prompt):
            _log.debug("Mutation '%s' succeeded (%d chars)", strategy_name, len(mutated))
            return mutated
        if mutated and _is_placeholder_variant(mutated, prompt):
            _log.warning("Mutation '%s' contained placeholder text — discarding", strategy_name)
    except Exception as exc:  # noqa: BLE001
        _log.warning("Mutation '%s' failed: %s", strategy_name, exc)
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
) -> None:
    """Write live tournament state to Redis for frontend polling. Fire-and-forget."""
    if domain_id is None:
        return
    try:
        from app.domain_prompt.cache import set_dp_tournament_state  # local import avoids circular

        names = [f"C{k}" for k in range(len(candidates))]
        state: dict[str, object] = {
            "round": round_idx + 1,
            "total_rounds": total_rounds,
            "candidate_count": len(candidates),
            "names": names,
            "elos": [round(c.elo, 1) for c in candidates],
            # W matrix as flat list-of-lists of ints for JSON compactness
            "W": [[int(wm.W[r][c]) for c in range(wm.size)] for r in range(wm.size)],
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
    num_candidates: int = _NUM_CANDIDATES,
    domain_id: str | None = None,
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
    # Claude Haiku: fast + cheap for answering during duels (answers are short)
    fast_llm = ChatOpenAI(
        model="anthropic/claude-3.5-haiku",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.7,
        max_tokens=512,
    )
    # GPT-4o: used for variant/mutation generation — long prompts need a capable model
    # that can produce 8k-token full rewrites reliably. Also used as judge (cross-model
    # to avoid self-preference bias).
    gen_llm = ChatOpenAI(
        model="openai/gpt-4o",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.7,
        max_tokens=_VARIANT_MAX_TOKENS,
    )
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
    # Generate num_candidates-1 variants so the base prompt always has a guaranteed slot.
    # The paper (Appendix C.2) keeps the original prompt in the pool and competes it directly.
    n_variants = max(1, num_candidates - 1)
    variant_texts = await _generate_variants(
        base_prompt, n_variants, gen_llm, domain_summary, sample_questions
    )
    # Base prompt is always first — never capped out
    all_texts = [base_prompt] + [v for v in variant_texts if v != base_prompt]
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_variants: list[str] = []
    for v in all_texts:
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
    mutation_strategy_idx = 0
    for round_idx in range(_TOURNAMENT_ROUNDS):
        i, j = _select_duel_pair(wm, rng)
        ex = rng.choice(duel_pool)
        question, gold = ex["question"], ex["answer"]

        # Emit state BEFORE the duel so UI shows "answering Q…" for current pair
        await _emit_tournament_state(
            domain_id, round_idx, _TOURNAMENT_ROUNDS, candidates, wm, i, j, question
        )

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
            mutated_text = await _mutate_prompt(
                candidates[best_now].text, gen_llm, domain_summary, mutation_strategy_idx
            )
            mutation_strategy_idx += 1
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
