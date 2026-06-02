import hashlib
from collections.abc import AsyncGenerator
from typing import Annotated, Any

import structlog
from fastapi import Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedException
from app.core.supabase_auth import verify_supabase_token
from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.repositories.api_key_repo import ApiKeyRepository
from app.repositories.user_repo import UserRepository


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_async_session():
        yield session


async def get_graph(request: Request) -> Any:  # noqa: ANN401
    """Returns the compiled LangGraph instance from app state."""
    return request.app.state.graph


async def _provision_user(
    user_repo: UserRepository,
    supabase_user_id: str,
    email: str,
    full_name: str | None,
) -> Any:  # noqa: ANN401
    """Create the local DB record on first Supabase login.

    Email and full_name come directly from the verified JWT payload —
    no external API call required. Idempotent: if a concurrent request
    already inserted this user, we return the existing row.
    """
    log = structlog.get_logger()
    try:
        user = await user_repo.create(
            supabase_user_id=supabase_user_id,
            email=email,
            full_name=full_name or None,
        )
        log.info("user_auto_provisioned", supabase_user_id=supabase_user_id, email=email)
        return user
    except IntegrityError as exc:
        await user_repo.db.rollback()

        existing = await user_repo.get_by_supabase_id(supabase_user_id)
        if existing is not None:
            return existing

        if email:
            by_email = await user_repo.get_by_email(email)
            if by_email is not None:
                claimed = await user_repo.update(by_email, supabase_user_id=supabase_user_id)
                log.info(
                    "user_claimed_existing_by_email",
                    supabase_user_id=supabase_user_id,
                    email=email,
                )
                return claimed

        raise UnauthorizedException(detail="User provisioning failed") from exc


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserContext:
    """Resolves the current user from a Supabase JWT Bearer token or qac_-prefixed API key."""
    authorization = request.headers.get("Authorization", "")
    log = structlog.get_logger()

    scheme, _, token = authorization.partition(" ")
    if not authorization or scheme.lower() != "bearer" or not token:
        log.warning("auth_header_missing", path=request.url.path, has_auth=bool(authorization))
        raise UnauthorizedException(detail="Missing or invalid Authorization header")

    user_repo = UserRepository(db)
    api_key_repo = ApiKeyRepository(db)

    if token.startswith("qac_"):
        key_hash = hashlib.sha256(token.encode()).hexdigest()
        api_key = await api_key_repo.get_active_by_hash(key_hash)
        if api_key is None:
            raise UnauthorizedException(detail="Invalid API key")

        await api_key_repo.update_last_used(api_key.id)

        user = await user_repo.get_by_id(api_key.created_by)
        if user is None or not user.is_active:
            raise UnauthorizedException(detail="Invalid API key")

        structlog.contextvars.bind_contextvars(user_id=str(user.id))
        return UserContext(
            user_id=user.id,
            supabase_user_id=user.supabase_user_id,
            email=user.email,
            credits=user.credits,
            org_id=api_key.org_id or "",
        )

    payload = verify_supabase_token(token)
    supabase_user_id: str = payload["sub"]
    email: str = payload.get("email", "")
    full_name: str | None = payload.get("user_metadata", {}).get("full_name")

    user = await user_repo.get_by_supabase_id(supabase_user_id)
    if user is None:
        user = await _provision_user(user_repo, supabase_user_id, email, full_name)
    if not user.is_active:
        raise UnauthorizedException(detail="User account is inactive")

    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return UserContext(
        user_id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        credits=user.credits,
        org_id="",
    )
