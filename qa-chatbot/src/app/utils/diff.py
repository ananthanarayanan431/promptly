from __future__ import annotations

import difflib
import re
from dataclasses import dataclass


def _tokenize(text: str) -> list[str]:
    """Split text into tokens: words, whitespace runs, and punctuation."""
    return re.findall(r"\S+|\s+", text)


@dataclass
class DiffHunk:
    type: str  # "equal" | "insert" | "delete" | "replace"
    text: str | None = None  # for equal / insert / delete
    from_text: str | None = None  # for replace (old side)
    to_text: str | None = None  # for replace (new side)


def compute_diff(from_content: str, to_content: str) -> tuple[list[DiffHunk], dict[str, int]]:
    """
    Compute a word-level diff between two strings.
    Returns (hunks, stats) where stats = {added, removed, equal}.
    """
    from_tokens = _tokenize(from_content)
    to_tokens = _tokenize(to_content)

    matcher = difflib.SequenceMatcher(None, from_tokens, to_tokens, autojunk=False)
    hunks: list[DiffHunk] = []
    stats: dict[str, int] = {"added": 0, "removed": 0, "equal": 0}

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        from_chunk = "".join(from_tokens[i1:i2])
        to_chunk = "".join(to_tokens[j1:j2])

        if tag == "equal":
            hunks.append(DiffHunk(type="equal", text=from_chunk))
            stats["equal"] += len(from_tokens[i1:i2])
        elif tag == "insert":
            hunks.append(DiffHunk(type="insert", text=to_chunk))
            stats["added"] += len(to_tokens[j1:j2])
        elif tag == "delete":
            hunks.append(DiffHunk(type="delete", text=from_chunk))
            stats["removed"] += len(from_tokens[i1:i2])
        elif tag == "replace":
            hunks.append(DiffHunk(type="replace", from_text=from_chunk, to_text=to_chunk))
            stats["removed"] += len(from_tokens[i1:i2])
            stats["added"] += len(to_tokens[j1:j2])

    return hunks, stats
