"""
LLM clients for the AutoData-inspired Q&A dataset builder.

Covers: domain_prompt/core/dataset_builder.py — challenger, weak solver,
        strong solver, and judge. api_key is passed at runtime (sourced from
        the user's stored credential in the Celery task).
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from promptly.llm._client import _build


def build_challenger(api_key: str) -> ChatOpenAI:
    """Generates candidate Q&A pairs with rubrics from PDF chunks."""
    return _build("openai/gpt-4o-mini", temperature=0.6, max_tokens=2048, api_key=api_key)


def build_weak_solver(api_key: str) -> ChatOpenAI:
    """Answers questions with no system prompt — raw model capability baseline."""
    return _build("openai/gpt-4o-mini", temperature=0.0, max_tokens=512, api_key=api_key)


def build_strong_solver(api_key: str) -> ChatOpenAI:
    """Answers questions with the user's domain prompt — guided capability."""
    return _build("openai/gpt-4o-mini", temperature=0.0, max_tokens=512, api_key=api_key)


def build_dataset_judge(api_key: str) -> ChatOpenAI:
    """Scores weak and strong answers against gold — needs stronger reasoning than mini."""
    return _build("openai/gpt-4o", temperature=0.0, max_tokens=64, api_key=api_key)
