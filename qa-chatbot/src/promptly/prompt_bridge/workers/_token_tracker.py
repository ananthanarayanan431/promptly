from __future__ import annotations

from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult


class TokenAccumulator(BaseCallbackHandler):
    """Accumulates total_tokens across all LLM calls in a bridge job."""

    def __init__(self) -> None:
        self.total_tokens: int = 0

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        for generations in response.generations:
            for gen in generations:
                meta: dict[str, Any] = {}
                if hasattr(gen, "message") and hasattr(gen.message, "usage_metadata"):
                    meta = gen.message.usage_metadata or {}
                elif hasattr(gen, "generation_info") and isinstance(gen.generation_info, dict):
                    meta = gen.generation_info.get("token_usage") or {}
                self.total_tokens += int(meta.get("total_tokens", 0))
