"""MinIO storage helpers for SkillOpt: skill docs and example JSONL."""

from __future__ import annotations

from promptly.domain_prompt.infrastructure.storage import (
    download_text,
    upload_text,
)

__all__ = ["skill_key", "examples_key", "upload_text", "download_text"]


def skill_key(user_id: str, project_id: str, filename: str = "best_skill.md") -> str:
    """MinIO key for a skill document."""
    return f"skill_opt/{user_id}/{project_id}/{filename}"


def examples_key(user_id: str, project_id: str) -> str:
    """MinIO key for the examples JSONL file."""
    return f"skill_opt/{user_id}/{project_id}/examples.jsonl"
