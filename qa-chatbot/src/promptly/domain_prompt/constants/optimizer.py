"""
Tuning constants for the PDO tournament optimizer (arXiv:2510.13907).

Values are calibrated for interactive web use. Paper's original values noted in comments.
"""

# ── Tournament parameters (paper §4 / Appendix E) ────────────────────────────
NUM_CANDIDATES = 10  # full pool size reached after intro phase (paper: 20–50)
INITIAL_CANDIDATES = 4  # tournament starts with this many; one added per round until full
TOURNAMENT_ROUNDS = 30  # total D-TS rounds (matches paper)
MUTATION_INTERVAL = 10  # mutation at rounds 10 and 20 (paper: same)
MUTATION_SOURCES = 3  # top-K prompts used as mutation seeds (paper: top-3)
MUTATION_BATCH = 3  # new candidates generated per mutation event (paper: 10; cost cap)
PRUNE_COUNT = 3  # prompts pruned per mutation event (paper: 10; cost cap)
UCB_ALPHA = 1.2  # D-TS confidence-bound parameter (paper §4.1, fixed at 1.2)
MAX_VAL_EXAMPLES = 20  # held-out examples for final scoring
MAX_SCORE_EXAMPLES = 15  # examples used during per-prompt tournament eval

# ── Weighted preference update (paper Appendix E.2) ──────────────────────────
# Win contribution per duel sums to 1.0 (W_ij + W_ji = 1).
# Answer-based judgments are high-confidence → γ=0.5 (winner gets full 1.0, loser 0.0).
# Reasoning-based judgments are noisier   → γ=0.2 (winner gets 0.7, loser 0.3).
GAMMA_ANSWER = 0.5
GAMMA_REASONING = 0.2

# ── Token budgets ─────────────────────────────────────────────────────────────
VARIANT_MAX_TOKENS = 8192  # full prompt rewrites on long prompts
MUTATION_MAX_TOKENS = 8192
JUDGE_MAX_TOKENS = 256  # dual judge emits answer + reasoning label + winner
SCORE_MAX_TOKENS = 64  # {"score": 0.87}
