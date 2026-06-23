"""Unit tests for skill_opt core algorithm."""

from __future__ import annotations

import pytest

from promptly.skill_opt.core.skillopt import (
    Example,
    _cosine_lr,
    _score_cache_key,
    _score_on_selection_cached,
    _split_examples,
)

# ── Task 1: LR floor ──────────────────────────────────────────────────────────


def test_cosine_lr_floor_is_two():
    result = _cosine_lr(base=3, epoch=2, total=3)
    assert result >= 2


def test_cosine_lr_floor_not_one():
    result = _cosine_lr(base=2, epoch=99, total=100)
    assert result == 2


def test_cosine_lr_first_epoch_is_base():
    assert _cosine_lr(base=4, epoch=0, total=4) == 4


# ── Task 2: Score cache ────────────────────────────────────────────────────────


def test_score_cache_key_is_deterministic() -> None:
    assert _score_cache_key("hello") == _score_cache_key("hello")


def test_score_cache_key_differs_for_different_skills() -> None:
    assert _score_cache_key("skill A") != _score_cache_key("skill B")


def test_score_cache_key_length() -> None:
    assert len(_score_cache_key("any skill")) == 16


# ── Tasks 4–6: Protected region, rewrite, analyst, rank ───────────────────────

from promptly.skill_opt.core.skillopt import (  # noqa: E402
    _META_END,
    _META_START,
    Edit,
    Trace,
    _analyze_failures,
    _analyze_successes,
    _apply_edits,
    _extract_protected,
    _merge_proposals,
    _rank_edits,
    _restore_protected,
    _rewrite_skill,
)

SKILL_WITH_META = """\
# Guide

Do step A.
Do step B.

---
## Consolidated Lessons
<!-- META:START -->
- lesson one
<!-- META:END -->"""

SKILL_NO_META = "# Guide\n\nDo step A."


def test_extract_protected_returns_editable_and_block() -> None:
    editable, protected = _extract_protected(SKILL_WITH_META)
    assert _META_START in protected
    assert _META_END in protected
    assert _META_START not in editable


def test_extract_protected_no_meta_returns_full_skill() -> None:
    editable, protected = _extract_protected(SKILL_NO_META)
    assert editable == SKILL_NO_META
    assert protected == ""


def test_restore_protected_roundtrips() -> None:
    editable, protected = _extract_protected(SKILL_WITH_META)
    result = _restore_protected(editable, protected)
    assert _META_START in result
    assert "Do step A." in result


def test_apply_edits_preserves_protected_block() -> None:
    edits = [Edit(op="ADD", target=None, content="New rule here.", rationale="r")]
    result = _apply_edits(SKILL_WITH_META, edits)
    assert "New rule here." in result
    assert _META_START in result
    assert _META_END in result


def test_apply_edits_cannot_delete_inside_protected() -> None:
    edits = [Edit(op="DELETE", target="lesson one", rationale="r", content=None)]
    result = _apply_edits(SKILL_WITH_META, edits)
    assert "lesson one" in result


def test_rank_edits_failure_before_success_at_equal_frequency() -> None:
    edits = [
        Edit(op="ADD", target=None, content="success rule", rationale="r", source="success"),
        Edit(op="ADD", target=None, content="failure rule", rationale="r", source="failure"),
    ]
    ranked = _rank_edits(edits, budget=2)
    assert ranked[0].source == "failure"
    assert ranked[1].source == "success"


def test_rank_edits_frequency_still_wins_within_same_source() -> None:
    edits = [
        Edit(
            op="ADD",
            target=None,
            content="rare failure",
            rationale="r",
            source="failure",
            frequency=1,
        ),
        Edit(
            op="ADD",
            target=None,
            content="common failure",
            rationale="r",
            source="failure",
            frequency=3,
        ),
    ]
    ranked = _rank_edits(edits, budget=2)
    assert ranked[0].content == "common failure"


def test_edit_default_source_is_failure() -> None:
    e = Edit(op="ADD", target=None, content="x", rationale="r")
    assert e.source == "failure"


def _make_trace(score: float) -> Trace:
    return Trace(
        example=Example(input="q", expected="a"),
        output="o",
        score=score,
        feedback="ok",
    )


@pytest.mark.asyncio
async def test_analyze_failures_returns_empty_for_no_failures() -> None:
    result = await _analyze_failures("skill", [], [], [], 3, "key")
    assert result == []


@pytest.mark.asyncio
async def test_analyze_successes_returns_empty_for_no_successes() -> None:
    result = await _analyze_successes("skill", [], [], 3, "key")
    assert result == []


@pytest.mark.asyncio
async def test_analyze_failures_tags_edits_as_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    mock_resp = MagicMock()
    mock_resp.content = (
        '{"analysis": "ok", "edits": [{"op": "ADD", "target": null,'
        ' "content": "fix", "rationale": "r"}]}'
    )
    mock_resp.usage_metadata = None
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    monkeypatch.setattr("promptly.skill_opt.core.skillopt._build", lambda *a, **kw: mock_llm)
    edits = await _analyze_failures("skill", [_make_trace(0.2)], [], [], 3, "key")
    assert all(e.source == "failure" for e in edits)


@pytest.mark.asyncio
async def test_analyze_successes_tags_edits_as_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    mock_resp = MagicMock()
    mock_resp.content = (
        '{"analysis": "ok", "edits": [{"op": "ADD", "target": null,'
        ' "content": "reinforce", "rationale": "r"}]}'
    )
    mock_resp.usage_metadata = None
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    monkeypatch.setattr("promptly.skill_opt.core.skillopt._build", lambda *a, **kw: mock_llm)
    edits = await _analyze_successes("skill", [_make_trace(0.8)], [], 3, "key")
    assert all(e.source == "success" for e in edits)


@pytest.mark.asyncio
async def test_merge_proposals_empty_batches_returns_empty() -> None:
    result = await _merge_proposals([], [], "skill", 3, "key")
    assert result == []


@pytest.mark.asyncio
async def test_rewrite_skill_appends_meta_block_if_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    mock_resp = MagicMock()
    mock_resp.content = "# Fresh Skill\n\nDo things."
    mock_resp.usage_metadata = None
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    monkeypatch.setattr("promptly.skill_opt.core.skillopt._build", lambda *a, **kw: mock_llm)
    result = await _rewrite_skill("old skill", [], [], "key", None)
    assert _META_START in result


@pytest.mark.asyncio
async def test_rewrite_skill_returns_current_on_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=Exception("LLM failed"))
    monkeypatch.setattr("promptly.skill_opt.core.skillopt._build", lambda *a, **kw: mock_llm)
    result = await _rewrite_skill("fallback skill", [], [], "key", None)
    assert result == "fallback skill"


@pytest.mark.asyncio
async def test_score_cache_hit_skips_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    cache: dict[str, float] = {}
    skill = "my skill"
    cache[_score_cache_key(skill)] = 0.75

    call_count = 0

    async def fake_score(
        s: str,
        d: list[Example],
        api_key: str,
        tc: list[int] | None,
        em: str,
    ) -> float:
        nonlocal call_count
        call_count += 1
        return 0.5

    monkeypatch.setattr(
        "promptly.skill_opt.core.skillopt._score_on_selection",
        fake_score,
    )
    result = await _score_on_selection_cached(skill, [], cache, "key", None, "m")

    assert result == 0.75
    assert call_count == 0


# ── Task 3: D_test split ──────────────────────────────────────────────────────


def test_split_requires_ten_examples() -> None:
    with pytest.raises(ValueError, match="10"):
        _split_examples([{"input": "a", "expected": "b"}] * 9, seed=42)


def test_split_produces_three_non_empty_parts() -> None:
    data = [{"input": str(i), "expected": str(i)} for i in range(20)]
    d_train, d_sel, d_test = _split_examples(data, seed=42)
    assert len(d_train) + len(d_sel) + len(d_test) == 20
    assert len(d_test) >= 2
    assert len(d_sel) >= 2
    assert len(d_train) >= 2


def test_split_is_deterministic() -> None:
    data = [{"input": str(i), "expected": str(i)} for i in range(15)]
    a_train, _, _ = _split_examples(data, seed=42)
    b_train, _, _ = _split_examples(data, seed=42)
    assert [e.input for e in a_train] == [e.input for e in b_train]


@pytest.mark.asyncio
async def test_score_cache_miss_calls_llm_and_stores(monkeypatch: pytest.MonkeyPatch) -> None:
    cache: dict[str, float] = {}
    skill = "my skill"

    async def fake_score(
        s: str,
        d: list[Example],
        api_key: str,
        tc: list[int] | None,
        em: str,
    ) -> float:
        return 0.6

    monkeypatch.setattr(
        "promptly.skill_opt.core.skillopt._score_on_selection",
        fake_score,
    )
    result = await _score_on_selection_cached(skill, [], cache, "key", None, "m")

    assert result == 0.6
    assert cache[_score_cache_key(skill)] == 0.6
