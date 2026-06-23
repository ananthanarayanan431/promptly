"""Unit tests for skill_opt core algorithm."""

from __future__ import annotations

from promptly.skill_opt.core.skillopt import _cosine_lr

# ── Task 1: LR floor ──────────────────────────────────────────────────────────


def test_cosine_lr_floor_is_two():
    result = _cosine_lr(base=3, epoch=2, total=3)
    assert result >= 2


def test_cosine_lr_floor_not_one():
    result = _cosine_lr(base=2, epoch=99, total=100)
    assert result == 2


def test_cosine_lr_first_epoch_is_base():
    assert _cosine_lr(base=4, epoch=0, total=4) == 4
