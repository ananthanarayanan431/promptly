"""Clerk webhook handler — syncs user lifecycle events to the local database."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

from app.config.clerk import get_clerk_settings
from app.dependencies import get_db
from app.repositories.user_repo import UserRepository
from app.utils.log import get_logger

log = get_logger(__name__)

router = APIRouter(tags=["webhooks"])


def _verify_webhook(request_body: bytes, headers: dict[str, str], secret: str) -> dict[str, object]:
    """Verify a Clerk webhook using the SVIX signing secret.

    Raises HTTPException(400) when the signature is invalid.
    """
    wh = Webhook(secret)
    try:
        return cast(dict[str, object], wh.verify(request_body, headers))
    except WebhookVerificationError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook signature") from exc


@router.post("/webhooks/clerk")
async def clerk_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    svix_id: Annotated[str, Header(...)],
    svix_timestamp: Annotated[str, Header(...)],
    svix_signature: Annotated[str, Header(...)],
) -> dict[str, str]:
    """Receive and process signed Clerk webhook events.

    This endpoint is called by Clerk's servers, not by authenticated users.
    Authentication is performed via SVIX signature verification — no JWT/API
    key auth dependency is used here.

    Handled events
    --------------
    - ``user.created``  → insert a new User row (idempotent)
    - ``user.deleted``  → soft-delete the user (set is_active=False, idempotent)
    - anything else     → logged and acknowledged with 200
    """
    body: bytes = await request.body()

    clerk_settings = get_clerk_settings()
    secret = clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value()

    svix_headers = {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
    }
    payload: dict[str, object] = _verify_webhook(body, svix_headers, secret)

    event_type: str = str(payload.get("type", ""))
    data: dict[str, object] = payload.get("data", {})  # type: ignore[assignment]

    log.info("clerk_webhook_received", event_type=event_type)

    user_repo = UserRepository(db)

    if event_type == "user.created":
        await _handle_user_created(user_repo, data)
    elif event_type == "user.deleted":
        await _handle_user_deleted(user_repo, db, data)
    else:
        log.info("clerk_webhook_ignored", event_type=event_type)

    return {"status": "ok"}


async def _handle_user_created(user_repo: UserRepository, data: dict[str, object]) -> None:
    """Create a new User record from a ``user.created`` Clerk event."""
    clerk_user_id: str = str(data["id"])

    email_addresses: list[dict[str, object]] = data.get("email_addresses", [])  # type: ignore[assignment]
    email: str = str(email_addresses[0]["email_address"]) if email_addresses else ""

    first_name: str = str(data.get("first_name") or "")
    last_name: str = str(data.get("last_name") or "")
    full_name: str = f"{first_name} {last_name}".strip()

    try:
        await user_repo.create(
            clerk_user_id=clerk_user_id,
            email=email,
            full_name=full_name or None,
        )
        log.info("user_created_from_webhook", clerk_user_id=clerk_user_id, email=email)
    except IntegrityError:
        # Duplicate — webhook delivered more than once; treat as idempotent.
        log.warning("user_already_exists_webhook", clerk_user_id=clerk_user_id)


async def _handle_user_deleted(
    user_repo: UserRepository,
    db: AsyncSession,
    data: dict[str, object],
) -> None:
    """Soft-delete a user from a ``user.deleted`` Clerk event."""
    clerk_user_id: str = str(data["id"])

    user = await user_repo.get_by_clerk_id(clerk_user_id)
    if user is None:
        log.warning("user_not_found_for_deletion", clerk_user_id=clerk_user_id)
        return

    user.is_active = False
    await db.flush()
    log.info("user_deactivated_from_webhook", clerk_user_id=clerk_user_id)
