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
