"""Unit tests for the require_admin FastAPI dependency."""

import uuid
from unittest.mock import patch

import pytest

from promptly.core.exceptions import ForbiddenException
from promptly.core.user_context import UserContext


def _make_context(*, is_admin: bool) -> UserContext:
    return UserContext(
        user_id=uuid.uuid4(),
        supabase_user_id="user_abc",
        email="test@example.com",
        credits=100,
        token_balance=3_000_000,
        is_admin=is_admin,
    )


@pytest.mark.asyncio
async def test_require_admin_passes_for_admin_user() -> None:
    """Admin user → returns the UserContext unchanged."""
    ctx = _make_context(is_admin=True)

    with patch("promptly.dependencies.get_current_user", return_value=ctx):
        from promptly.dependencies import require_admin

        result = await require_admin(current_user=ctx)

    assert result is ctx


@pytest.mark.asyncio
async def test_require_admin_raises_forbidden_for_non_admin() -> None:
    """Non-admin user → raises ForbiddenException."""
    ctx = _make_context(is_admin=False)

    with patch("promptly.dependencies.get_current_user", return_value=ctx):
        from promptly.dependencies import require_admin

        with pytest.raises(ForbiddenException) as exc_info:
            await require_admin(current_user=ctx)

    assert exc_info.value.status_code == 403
