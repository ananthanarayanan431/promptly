"""
LLM client for short name generation.

Covers: session title (Celery task), version name suggestion and save-version
        (chat API endpoints). All three use the same model + params.
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from promptly.llm._client import _build

# gpt-4o-mini is fast and cheap; names need no reasoning depth.
_MODEL = "openai/gpt-4o-mini"


def build_naming_llm() -> ChatOpenAI:
    """Naming model — session titles, version names. Returns ≤ 20 tokens."""
    return _build(_MODEL, temperature=0, max_tokens=20)
