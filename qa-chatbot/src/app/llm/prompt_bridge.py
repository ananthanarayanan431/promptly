"""
LLM clients for the PromptBridge transfer pipeline (arXiv:2512.01420).

All factories accept api_key at runtime — PromptBridge jobs run as Celery tasks
that extract the key from LLMSettings at task start time.

Roles:
  build_pb_task_llm        — generates alignment tasks from source prompt
  build_pb_target_llm      — the actual target model being calibrated for
  build_pb_eval_llm        — scores model responses during MAP-RPE
  build_pb_reflection_llm  — generates improved prompt candidates (reflection step)
  build_pb_extractor_llm   — high-capability LLM that extracts transfer mapping
  build_pb_adapter_llm     — applies mapping to unseen source prompt
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.llm._client import _build
from app.prompt_bridge.constants.map_rpe import (
    ALIGNMENT_TASK_MAX_TOKENS,
    EVALUATION_MAX_TOKENS,
    REFLECTION_MAX_TOKENS,
)


def build_pb_task_llm(api_key: str) -> ChatOpenAI:
    """Generates synthetic alignment tasks from the source prompt."""
    return _build(
        "openai/gpt-4o-mini",
        temperature=0.7,
        max_tokens=ALIGNMENT_TASK_MAX_TOKENS,
        api_key=api_key,
    )


def build_pb_target_llm(model: str, api_key: str) -> ChatOpenAI:
    """
    The actual target model — responses used for MAP-RPE evaluation.
    model is the user-supplied target model slug (e.g. 'anthropic/claude-3.5-haiku').
    """
    return _build(model, temperature=0.7, max_tokens=1024, api_key=api_key)


def build_pb_eval_llm(api_key: str) -> ChatOpenAI:
    """Scores model responses during MAP-RPE calibration."""
    return _build(
        "openai/gpt-4o-mini",
        temperature=0.0,
        max_tokens=EVALUATION_MAX_TOKENS,
        api_key=api_key,
    )


def build_pb_reflection_llm(api_key: str) -> ChatOpenAI:
    """Generates improved prompt candidates via reflective refinement."""
    return _build(
        "openai/gpt-4o",
        temperature=0.7,
        max_tokens=REFLECTION_MAX_TOKENS,
        api_key=api_key,
    )


def build_pb_extractor_llm(api_key: str) -> ChatOpenAI:
    """High-capability model that distils the transfer mapping from calibrated pairs."""
    return _build(
        "openai/gpt-4o",
        temperature=0.0,
        max_tokens=256,
        api_key=api_key,
    )


def build_pb_adapter_llm(api_key: str) -> ChatOpenAI:
    """Applies the learned mapping to adapt an unseen source prompt."""
    return _build(
        "openai/gpt-4o",
        temperature=0.3,
        max_tokens=512,
        api_key=api_key,
    )
