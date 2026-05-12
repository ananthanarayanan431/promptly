"""
Hyperparameters for the MAP-RPE algorithm and PromptBridge transfer.

All values from arXiv:2512.01420 Table 1 / Section 4.
Web-use adjustments noted inline.
"""

# ── MAP-RPE evolution loop ────────────────────────────────────────────────────
GLOBAL_ITERATIONS: int = 5  # paper: 20; reduced for interactive cost
LOCAL_STEPS: int = 3  # paper: 10 (L local evolution steps per question)
CALIBRATION_TASKS: int = 5  # paper: 54 alignment tasks; 5 keeps cost practical
ISLANDS: int = 3  # evolutionary islands K (paper: 3)
ARCHIVE_SIZE: int = 50  # prompt archive cap per island (paper: 1000)

# ── Selection ratios (paper §4 island-based evolution) ───────────────────────
EXPLOITATION_RATIO: float = 0.7
EXPLORATION_RATIO: float = 0.2
ELITE_RATIO: float = 0.1

# ── Migration (paper: every 50 iterations, rate 0.1) ─────────────────────────
MIGRATION_INTERVAL: int = 10  # migrate every N evolution steps (scaled down)
MIGRATION_RATE: float = 0.1  # fraction of island population migrated

# ── Objective weights (paper §4: λ=0.8 performance, 0.2 behavioral) ─────────
LAMBDA_PERFORMANCE: float = 0.8
LAMBDA_BEHAVIORAL: float = 0.2

# ── Behavioral scoring weights (paper Appendix) ──────────────────────────────
W_SYNTAX: float = 0.35
W_ENTRYPOINT: float = 0.35
W_RISKFREE: float = 0.20
W_NODUPE: float = 0.10

# ── Token budgets ─────────────────────────────────────────────────────────────
REFLECTION_MAX_TOKENS: int = 4096  # reflective prompt generation
EVALUATION_MAX_TOKENS: int = 256  # scoring LLM response
ALIGNMENT_TASK_MAX_TOKENS: int = 512  # synthetic task generation
