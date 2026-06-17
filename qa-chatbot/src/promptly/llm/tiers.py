"""
LLM Effort Tiers — Low / Medium / High model configurations.

Tiers control which 4 council models run and which synthesizer model produces
the final result. Lower tiers cost less; higher tiers produce better quality.

Cost estimates are blended $/1M-token approximations across a typical optimization
run (~8k–20k tokens total across council + critic + synthesize).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LLMTier:
    key: str  # "low" | "medium" | "high"
    label: str
    desc: str
    council_models: list[str]  # 4 models for council_vote + critic
    synthesizer: str  # chairman model for synthesize node
    est_cost_per_run_usd: float  # rough estimate for display only
    color: str


TIERS: dict[str, LLMTier] = {
    "low": LLMTier(
        key="low",
        label="Low",
        desc="Fast, cheap open-source models. Good for iteration.",
        council_models=[
            "meta-llama/llama-3.2-3b-instruct",  # $0.051/$0.34 per 1M
            "mistralai/mistral-7b-instruct",  # $0.13/$0.13 per 1M
            "google/gemini-2.0-flash",  # $0.10/$0.40 per 1M
            "openai/gpt-4o-mini",  # $0.15/$0.60 per 1M
        ],
        synthesizer="openai/gpt-4o-mini",
        est_cost_per_run_usd=0.006,  # ~$0.006 for full council+critic+synth
        color="#10b981",
    ),
    "medium": LLMTier(
        key="medium",
        label="Medium",
        desc="Balanced quality/cost. Current default configuration.",
        council_models=[
            "openai/gpt-4o-mini",  # $0.15/$0.60 per 1M
            "anthropic/claude-3.5-haiku",  # $0.80/$4.00 per 1M
            "google/gemini-2.5-flash",  # $0.30/$2.50 per 1M
            "x-ai/grok-4.3",  # $1.25/$2.50 per 1M
        ],
        synthesizer="openai/gpt-4o-mini",
        est_cost_per_run_usd=0.027,  # ~$0.027 for full council+critic+synth
        color="#f59e0b",
    ),
    "high": LLMTier(
        key="high",
        label="High",
        desc="Frontier models. Best quality, significantly higher cost.",
        council_models=[
            "openai/gpt-4o",  # $2.50/$10.00 per 1M
            "anthropic/claude-3.5-sonnet",  # $3.00/$15.00 per 1M
            "google/gemini-2.5-pro",  # $1.25/$10.00 per 1M
            "x-ai/grok-3",  # $3.00/$15.00 per 1M
        ],
        synthesizer="anthropic/claude-3.5-sonnet",
        est_cost_per_run_usd=0.15,  # ~$0.15 for full council+critic+synth
        color="#7c5cff",
    ),
}

DEFAULT_TIER = "medium"


def get_council_models(effort: str | None) -> list[str] | None:
    """Return the council model list for the given effort tier, or None for default."""
    if not effort or effort == DEFAULT_TIER:
        return None  # signal to use env-configured defaults
    tier = TIERS.get(effort)
    return tier.council_models if tier else None


def get_synthesizer(effort: str | None) -> str | None:
    """Return the synthesizer model for the given tier, or None for default."""
    if not effort or effort == DEFAULT_TIER:
        return None
    tier = TIERS.get(effort)
    return tier.synthesizer if tier else None
