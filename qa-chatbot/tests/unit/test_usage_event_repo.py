"""Unit tests for UsageEventRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from promptly.repositories.usage_event_repo import UsageEventRepository, month_start_utc

# ── month_start_utc pure tests ─────────────────────────────────────────────────


def test_month_start_utc_returns_first_day() -> None:
    result = month_start_utc()
    assert result.day == 1
    assert result.hour == 0
    assert result.minute == 0
    assert result.second == 0


def test_month_start_utc_is_utc() -> None:
    result = month_start_utc()
    assert result.tzinfo is not None


# ── UsageEventRepository.log tests ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_log_invalid_action_raises_value_error() -> None:
    db = AsyncMock()
    repo = UsageEventRepository(db)
    import uuid

    with pytest.raises(ValueError, match="Unknown usage action"):
        await repo.log(user_id=uuid.uuid4(), action="invalid_action", credits_spent=5)


@pytest.mark.asyncio
async def test_log_valid_actions_are_accepted() -> None:
    """All valid actions should not raise ValueError."""
    import uuid

    for action, cost in [("optimize", 10), ("health_score", 5), ("advisory", 5)]:
        db = AsyncMock()
        repo = UsageEventRepository(db)

        # Mock the `create` method to return a dummy object
        mock_event = MagicMock()
        repo.create = AsyncMock(return_value=mock_event)

        result = await repo.log(user_id=uuid.uuid4(), action=action, credits_spent=cost)
        assert result == mock_event
