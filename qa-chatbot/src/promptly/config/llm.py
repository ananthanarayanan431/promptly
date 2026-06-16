# Re-export from the canonical location.  All new code should import from promptly.llm directly.
from promptly.llm.settings import LLMSettings, get_llm_settings

__all__ = ["LLMSettings", "get_llm_settings"]
