"""
LLM client for auto-tagging favorited prompts.

Covers: FavoriteService._generate_tags — tags + category classification.
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.llm._client import _build


def build_tagger() -> ChatOpenAI:
    """Tagger model — extracts tags and category from prompt content."""
    from app.llm.settings import get_llm_settings

    # Use the first council model (gpt-4o-mini by default); fall back to DEFAULT_MODEL.
    settings = get_llm_settings()
    model = settings.COUNCIL_MODELS[0] if settings.COUNCIL_MODELS else settings.DEFAULT_MODEL
    return _build(model, temperature=0, max_tokens=150)
