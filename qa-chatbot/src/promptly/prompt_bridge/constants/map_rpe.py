"""
Hyperparameters for the MAP-RPE algorithm and PromptBridge transfer.

Two tiers controlled by PRODUCTION_APPLICATION env var:
  True  → full-quality run (~375 LLM calls per calibration)
  False → dev/lite run (~94 LLM calls per calibration, 1/4 of full)

Paper values from arXiv:2512.01420 Table 1 / Section 4.
"""

from promptly.config.app import get_app_settings

_prod = get_app_settings().PRODUCTION_APPLICATION

# ── MAP-RPE evolution loop ────────────────────────────────────────────────────
GLOBAL_ITERATIONS: int = 5 if _prod else 2  # paper: 20
LOCAL_STEPS: int = 3 if _prod else 1  # paper: 10
CALIBRATION_TASKS: int = 5 if _prod else 3  # paper: 54
ISLANDS: int = 3 if _prod else 2  # paper: 3
ARCHIVE_SIZE: int = 50 if _prod else 20  # paper: 1000

# ── Selection ratios (paper §4 island-based evolution) ───────────────────────
EXPLOITATION_RATIO: float = 0.7
EXPLORATION_RATIO: float = 0.2
ELITE_RATIO: float = 0.1

# ── Migration ─────────────────────────────────────────────────────────────────
MIGRATION_INTERVAL: int = 10 if _prod else 5
MIGRATION_RATE: float = 0.1

# ── Objective weights (paper §4: λ=0.8 performance, 0.2 behavioral) ─────────
LAMBDA_PERFORMANCE: float = 0.8
LAMBDA_BEHAVIORAL: float = 0.2

# ── Behavioral scoring weights (paper Appendix) ──────────────────────────────
W_SYNTAX: float = 0.35
W_ENTRYPOINT: float = 0.35
W_RISKFREE: float = 0.20
W_NODUPE: float = 0.10

# ── Token budgets ─────────────────────────────────────────────────────────────
REFLECTION_MAX_TOKENS: int = 4096
EVALUATION_MAX_TOKENS: int = 256
ALIGNMENT_TASK_MAX_TOKENS: int = 512
