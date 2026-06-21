"""Unit tests for admin response schemas."""

import uuid
from datetime import datetime

from promptly.admin.api.schemas import (
    AdminStats,
    AdminUserItem,
    AdminUserList,
    AdminUserPatch,
    GlitchTipIssue,
    GlitchTipIssueList,
    RateLimitEntry,
    RateLimitList,
)


class TestAdminUserItem:
    """Tests for AdminUserItem schema."""

    def test_from_attributes(self) -> None:
        """Construct from ORM model via from_attributes=True."""
        user_id = uuid.uuid4()
        created_at = datetime.now()
        last_login_at = datetime.now()

        data = {
            "id": user_id,
            "email": "admin@example.com",
            "full_name": "Admin User",
            "credits": 150,
            "token_balance": 5_000_000,
            "is_active": True,
            "is_admin": True,
            "last_login_at": last_login_at,
            "created_at": created_at,
        }

        user = AdminUserItem(**data)

        assert user.id == user_id
        assert user.email == "admin@example.com"
        assert user.full_name == "Admin User"
        assert user.credits == 150
        assert user.token_balance == 5_000_000
        assert user.is_active is True
        assert user.is_admin is True
        assert user.last_login_at == last_login_at
        assert user.created_at == created_at

    def test_with_none_full_name(self) -> None:
        """Handle None full_name."""
        user_id = uuid.uuid4()
        created_at = datetime.now()

        data = {
            "id": user_id,
            "email": "user@example.com",
            "full_name": None,
            "credits": 100,
            "token_balance": 3_000_000,
            "is_active": True,
            "is_admin": False,
            "last_login_at": None,
            "created_at": created_at,
        }

        user = AdminUserItem(**data)

        assert user.full_name is None
        assert user.last_login_at is None


class TestAdminUserPatch:
    """Tests for AdminUserPatch schema."""

    def test_all_none(self) -> None:
        """All fields optional; all can be None."""
        patch = AdminUserPatch()

        assert patch.is_active is None
        assert patch.is_admin is None
        assert patch.credits_delta is None

    def test_partial_update(self) -> None:
        """Set only some fields."""
        patch = AdminUserPatch(is_active=False, credits_delta=50)

        assert patch.is_active is False
        assert patch.is_admin is None
        assert patch.credits_delta == 50

    def test_all_fields(self) -> None:
        """Set all fields."""
        patch = AdminUserPatch(is_active=True, is_admin=True, credits_delta=-10)

        assert patch.is_active is True
        assert patch.is_admin is True
        assert patch.credits_delta == -10


class TestAdminUserList:
    """Tests for AdminUserList schema."""

    def test_construct(self) -> None:
        """Construct user list response."""
        user_id = uuid.uuid4()
        created_at = datetime.now()

        user = AdminUserItem(
            id=user_id,
            email="user@example.com",
            full_name="User",
            credits=100,
            token_balance=3_000_000,
            is_active=True,
            is_admin=False,
            last_login_at=None,
            created_at=created_at,
        )

        user_list = AdminUserList(
            page=1,
            per_page=20,
            total=42,
            users=[user],
        )

        assert user_list.page == 1
        assert user_list.per_page == 20
        assert user_list.total == 42
        assert len(user_list.users) == 1
        assert user_list.users[0].email == "user@example.com"

    def test_empty_list(self) -> None:
        """Handle empty user list."""
        user_list = AdminUserList(
            page=1,
            per_page=20,
            total=0,
            users=[],
        )

        assert user_list.total == 0
        assert len(user_list.users) == 0


class TestAdminStats:
    """Tests for AdminStats schema."""

    def test_construct(self) -> None:
        """Construct admin stats."""
        stats = AdminStats(
            total_users=150,
            total_optimizations=3_000,
            total_tokens_consumed=50_000_000,
            active_users_7d=45,
        )

        assert stats.total_users == 150
        assert stats.total_optimizations == 3_000
        assert stats.total_tokens_consumed == 50_000_000
        assert stats.active_users_7d == 45


class TestRateLimitEntry:
    """Tests for RateLimitEntry schema."""

    def test_construct(self) -> None:
        """Construct rate limit entry."""
        entry = RateLimitEntry(
            user_id="user_123",
            route="/api/v1/chat/",
            hit_count=105,
        )

        assert entry.user_id == "user_123"
        assert entry.route == "/api/v1/chat/"
        assert entry.hit_count == 105


class TestRateLimitList:
    """Tests for RateLimitList schema."""

    def test_construct(self) -> None:
        """Construct rate limit list."""
        entry1 = RateLimitEntry(user_id="user_1", route="/api/v1/chat/", hit_count=100)
        entry2 = RateLimitEntry(user_id="user_2", route="/api/v1/health/", hit_count=5)

        rate_limit_list = RateLimitList(entries=[entry1, entry2])

        assert len(rate_limit_list.entries) == 2
        assert rate_limit_list.entries[0].user_id == "user_1"
        assert rate_limit_list.entries[1].user_id == "user_2"

    def test_empty_list(self) -> None:
        """Handle empty rate limit list."""
        rate_limit_list = RateLimitList(entries=[])

        assert len(rate_limit_list.entries) == 0


class TestGlitchTipIssue:
    """Tests for GlitchTipIssue schema."""

    def test_construct(self) -> None:
        """Construct GlitchTip issue."""
        issue = GlitchTipIssue(
            id="issue_456",
            title="ValueError in chat processing",
            occurrences=12,
            status="unresolved",
            first_seen="2025-06-15T10:30:00Z",
            last_seen="2025-06-20T14:22:00Z",
        )

        assert issue.id == "issue_456"
        assert issue.title == "ValueError in chat processing"
        assert issue.occurrences == 12
        assert issue.status == "unresolved"
        assert issue.first_seen == "2025-06-15T10:30:00Z"
        assert issue.last_seen == "2025-06-20T14:22:00Z"


class TestGlitchTipIssueList:
    """Tests for GlitchTipIssueList schema."""

    def test_construct(self) -> None:
        """Construct GlitchTip issue list."""
        issue1 = GlitchTipIssue(
            id="issue_1",
            title="Error 1",
            occurrences=5,
            status="unresolved",
            first_seen="2025-06-15T00:00:00Z",
            last_seen="2025-06-20T00:00:00Z",
        )
        issue2 = GlitchTipIssue(
            id="issue_2",
            title="Error 2",
            occurrences=3,
            status="resolved",
            first_seen="2025-06-10T00:00:00Z",
            last_seen="2025-06-18T00:00:00Z",
        )

        issue_list = GlitchTipIssueList(issues=[issue1, issue2])

        assert len(issue_list.issues) == 2
        assert issue_list.issues[0].id == "issue_1"
        assert issue_list.issues[1].status == "resolved"

    def test_empty_list(self) -> None:
        """Handle empty GlitchTip issue list."""
        issue_list = GlitchTipIssueList(issues=[])

        assert len(issue_list.issues) == 0
