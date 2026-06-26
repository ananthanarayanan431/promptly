from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminApiKeyItem,
    AdminUserItem,
    AdminUserList,
    UserActivity,
    UserActivitySession,
)
from promptly.core.exceptions import NotFoundException
from promptly.models.api_key import ApiKey
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.models.user import User
from promptly.repositories.user_repo import UserRepository


async def list_users_paginated(db: AsyncSession, page: int, per_page: int) -> AdminUserList:
    """Paginated list of all users with session and API key counts."""
    repo = UserRepository(db)
    users, total = await repo.get_all_paginated(page, per_page)
    user_ids = [u.id for u in users]

    session_rows = (
        await db.execute(
            select(
                ChatSession.user_id,
                func.count().label("cnt"),
                func.max(ChatSession.created_at).label("last_session"),
            )
            .where(ChatSession.user_id.in_(user_ids))
            .group_by(ChatSession.user_id)
        )
    ).fetchall()
    session_map = {str(r.user_id): (r.cnt, r.last_session) for r in session_rows}

    api_key_rows = (
        await db.execute(
            select(ApiKey.created_by, func.count().label("cnt"))
            .where(ApiKey.created_by.in_(user_ids), ApiKey.is_active == True)  # noqa: E712
            .group_by(ApiKey.created_by)
        )
    ).fetchall()
    api_key_map = {str(r.created_by): r.cnt for r in api_key_rows}

    items = []
    for u in users:
        s_cnt, last_session = session_map.get(str(u.id), (0, None))
        ak_cnt = api_key_map.get(str(u.id), 0)
        items.append(
            AdminUserItem(
                id=u.id,
                email=u.email,
                full_name=u.full_name,
                avatar_url=u.avatar_url,
                credits=u.credits,
                token_balance=u.token_balance,
                is_active=u.is_active,
                is_admin=u.is_admin,
                last_login_at=u.last_login_at,
                created_at=u.created_at,
                data_sharing_enabled=u.data_sharing_enabled,
                session_count=s_cnt,
                last_session_at=last_session,
                api_key_count=ak_cnt,
                total_tokens_consumed=max(0, 3_000_000 - u.token_balance),
            )
        )

    return AdminUserList(page=page, per_page=per_page, total=total, users=items)


async def fetch_user_activity(db: AsyncSession, user_id: uuid.UUID) -> UserActivity:
    """Activity drill-down for a single user."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise NotFoundException(detail="User not found")

    sessions_result = (
        (
            await db.execute(
                select(ChatSession)
                .where(ChatSession.user_id == user_id)
                .order_by(ChatSession.created_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )

    session_count: int = (
        await db.execute(
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user_id)
        )
    ).scalar_one()

    activity_sessions: list[UserActivitySession] = []
    total_tokens = 0
    for sess in sessions_result:
        msgs = (
            (await db.execute(select(Message).where(Message.session_id == sess.id))).scalars().all()
        )
        sess_tokens = 0
        for msg in msgs:
            if msg.token_usage and isinstance(msg.token_usage, dict):
                sess_tokens += int(msg.token_usage.get("total_tokens", 0))
        total_tokens += sess_tokens
        activity_sessions.append(
            UserActivitySession(
                id=str(sess.id),
                title=sess.title,
                created_at=sess.created_at.isoformat(),
                token_count=sess_tokens,
                message_count=len(msgs),
            )
        )

    feature_rows = (
        await db.execute(
            select(UsageEvent.action, func.count().label("cnt"))
            .where(UsageEvent.user_id == user_id)
            .group_by(UsageEvent.action)
        )
    ).fetchall()

    return UserActivity(
        user_id=str(user.id),
        email=user.email,
        sessions=activity_sessions,
        feature_counts={row.action: row.cnt for row in feature_rows},
        total_tokens_consumed=total_tokens,
        session_count=session_count,
        first_seen=user.created_at.isoformat(),
        last_seen=user.last_login_at.isoformat() if user.last_login_at else None,
    )


# Re-export AdminApiKeyItem so router can use it from this module
__all__ = [
    "AdminApiKeyItem",
    "list_users_paginated",
    "fetch_user_activity",
]
