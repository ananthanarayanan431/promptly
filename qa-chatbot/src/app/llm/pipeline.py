"""
LLM clients for the LangGraph optimization pipeline.

Covers: intent_classifier, performance_gate, council_vote, critic, synthesize, quality_gate.
Callers own the loop-affinity caching (Celery creates a fresh event loop per task).
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.llm._client import _build


def build_classifier() -> ChatOpenAI:
    """Intent gate — OPTIMIZE vs IRRELEVANT. Tiny token budget: only reads one word."""
    from app.llm.settings import get_llm_settings

    return _build(
        get_llm_settings().DEFAULT_MODEL,
        temperature=0,
        max_tokens=5,
    )


def build_subject_classifier() -> ChatOpenAI:
    """Subject analysis — about + suggestions. JSON output, ~512 tokens."""
    from app.llm.settings import get_llm_settings

    return _build(
        get_llm_settings().DEFAULT_MODEL,
        temperature=0,
        max_tokens=512,
    )


def build_gate() -> ChatOpenAI:
    """Performance and quality gates — 8-dimension prompt scoring."""
    return _build("openai/gpt-4o-mini")


def build_council_models() -> list[ChatOpenAI]:
    """Four council models — each independently optimizes in parallel."""
    from app.llm.settings import get_llm_settings

    return [_build(m) for m in get_llm_settings().COUNCIL_MODELS]


def build_critic_models() -> list[ChatOpenAI]:
    """Four critic models — same lineup as council; each reviews the other three."""
    from app.llm.settings import get_llm_settings

    return [_build(m) for m in get_llm_settings().COUNCIL_MODELS]


def build_synthesizer() -> ChatOpenAI:
    """Chairman model — synthesizes final prompt from proposals + critiques."""
    from app.llm.settings import get_llm_settings

    return _build(get_llm_settings().DEFAULT_MODEL)
