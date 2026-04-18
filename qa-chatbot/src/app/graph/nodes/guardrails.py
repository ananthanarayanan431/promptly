"""
Guardrails node — runs BEFORE enhance_prompt.
Checks for:
  - Empty / whitespace-only input
  - Prompt injection patterns
  - Excessive length
  - Blocked content categories (PII leakage, hate, self-harm, etc.)

Returns an error in state to short-circuit the graph if triggered.
"""

import re
from typing import Any

from app.graph.state import GraphState

# Max characters allowed in a raw prompt
MAX_PROMPT_LENGTH = 8_000_000

# Simple regex patterns for obvious prompt injection attempts
INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"you\s+are\s+now\s+(?!a\s+QA)",  # "you are now DAN / evil AI"
    r"disregard\s+(your\s+)?(system|safety)",
    r"act\s+as\s+if\s+you\s+have\s+no\s+restrictions",
    r"jailbreak",
    r"<\s*script\s*>",  # XSS attempt in prompt
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in INJECTION_PATTERNS]

# Blocked keywords (extend as needed)
BLOCKED_KEYWORDS = frozenset(
    [
        "how to make a bomb",
        "synthesize drugs",
        "child pornography",
        "self-harm instructions",
    ]
)


def _check_empty(prompt: str) -> str | None:
    if not prompt or not prompt.strip():
        return "Prompt must not be empty."
    return None


def _check_length(prompt: str) -> str | None:
    if len(prompt) > MAX_PROMPT_LENGTH:
        return (
            f"Prompt exceeds maximum allowed length of {MAX_PROMPT_LENGTH} characters. "
            f"Received {len(prompt)} characters."
        )
    return None


def _check_injection(prompt: str) -> str | None:
    for pattern in COMPILED_PATTERNS:
        if pattern.search(prompt):
            return "Prompt contains disallowed content or injection patterns."
    return None


def _check_blocked_keywords(prompt: str) -> str | None:
    lower = prompt.lower()
    for kw in BLOCKED_KEYWORDS:
        if kw in lower:
            return "Prompt contains blocked content."
    return None


# Ordered list of checks — first failure short-circuits
_CHECKS = [
    _check_empty,
    _check_length,
    _check_injection,
    _check_blocked_keywords,
]


async def guardrails_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node. Returns {"error": "<reason>"} to stop the graph,
    or {"error": None} to continue.
    """
    raw = state.get("raw_prompt", "")

    for check in _CHECKS:
        reason = check(raw)
        if reason:
            return {"error": reason, "final_response": reason}

    return {"error": None}
