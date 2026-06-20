from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminStats,
    AdminUserItem,
    AdminUserList,
    AdminUserPatch,
)
from promptly.api.types.response import SuccessResponse
from promptly.core.exceptions import NotFoundException
from promptly.core.user_context import UserContext
from promptly.dependencies import get_db, require_admin
from promptly.models.session import ChatSession
from promptly.models.user import User
from promptly.repositories.user_repo import UserRepository

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/stats", response_model=SuccessResponse[AdminStats])
async def get_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[AdminStats]:
    """Aggregate application statistics."""
    total_users_result = await db.execute(select(func.count()).select_from(User))
    total_users: int = total_users_result.scalar_one()

    total_opts_result = await db.execute(select(func.count()).select_from(ChatSession))
    total_optimizations: int = total_opts_result.scalar_one()

    tokens_result = await db.execute(
        select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(User)
    )
    total_tokens_consumed: int = tokens_result.scalar_one()

    cutoff = datetime.now(UTC) - timedelta(days=7)
    active_result = await db.execute(
        select(func.count()).select_from(User).where(User.last_login_at >= cutoff)
    )
    active_users_7d: int = active_result.scalar_one()

    return SuccessResponse(
        data=AdminStats(
            total_users=total_users,
            total_optimizations=total_optimizations,
            total_tokens_consumed=total_tokens_consumed,
            active_users_7d=active_users_7d,
        )
    )


@router.get("/users", response_model=SuccessResponse[AdminUserList])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(require_admin)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
) -> SuccessResponse[AdminUserList]:
    """Paginated list of all users."""
    repo = UserRepository(db)
    users, total = await repo.get_all_paginated(page, per_page)
    return SuccessResponse(
        data=AdminUserList(
            page=page,
            per_page=per_page,
            total=total,
            users=[AdminUserItem.model_validate(u) for u in users],
        )
    )


@router.patch("/users/{user_id}", response_model=SuccessResponse[AdminUserItem])
async def patch_user(
    user_id: uuid.UUID,
    body: AdminUserPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[AdminUserItem]:
    """Update is_active, is_admin, or credits for any user."""
    repo = UserRepository(db)
    updated = await repo.update_admin_fields(
        user_id,
        is_active=body.is_active,
        is_admin=body.is_admin,
        credits_delta=body.credits_delta,
    )
    if updated is None:
        raise NotFoundException(detail="User not found")
    return SuccessResponse(data=AdminUserItem.model_validate(updated))
