"""
LLM clients for the PDO tournament optimizer (arXiv:2510.13907).

Covers: domain_prompt/core/optimizer.py — duel answerer, variant/mutation
        generator, and duel judge. api_key is passed at runtime.

Token budgets come from domain_prompt/constants/optimizer.py; callers use
model.model_copy(update={"max_tokens": N}) for per-call overrides.
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from promptly.domain_prompt.constants.optimizer import JUDGE_MAX_TOKENS, VARIANT_MAX_TOKENS
from promptly.llm._client import _build


def build_duel_answerer(api_key: str) -> ChatOpenAI:
    """Fast answerer used during duels and held-out validation scoring."""
    return _build(
        "anthropic/claude-3.5-haiku",
        temperature=0.7,
        max_tokens=512,
        api_key=api_key,
    )


def build_variant_generator(api_key: str) -> ChatOpenAI:
    """Generates K initial prompt variants and mutations — long rewrites need GPT-4o."""
    return _build(
        "openai/gpt-4o",
        temperature=0.7,
        max_tokens=VARIANT_MAX_TOKENS,
        api_key=api_key,
    )


def build_duel_judge(api_key: str) -> ChatOpenAI:
    """Judges duel winners and scores validation examples — cross-model avoids self-preference."""
    return _build(
        "openai/gpt-4o",
        temperature=0.0,
        max_tokens=JUDGE_MAX_TOKENS,
        api_key=api_key,
    )
