"""
LLM client for standalone prompt analysis.

Covers: prompt health-score and advisory endpoints (PromptService).
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from promptly.llm._client import _build


def build_analyser() -> ChatOpenAI:
    """General-purpose analyser — health score + advisory on a single prompt."""
    from promptly.llm.settings import get_llm_settings

    return _build(get_llm_settings().DEFAULT_MODEL)
