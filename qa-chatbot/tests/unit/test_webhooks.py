"""Contract tests for src/app/api/v1/webhooks.py.

The previous auth provider's webhook handler was removed in the Supabase
migration — user provisioning now happens lazily in
``app.dependencies._provision_user`` on the first authenticated request, so
there is no webhook to verify. ``webhooks.py`` is kept as an intentional empty
placeholder (still mounted in ``main.py``) for future Supabase webhook handlers.
These tests pin that contract: importable router, zero routes.
"""

from __future__ import annotations

from fastapi import APIRouter


def test_webhooks_router_is_importable() -> None:
    from app.api.v1.webhooks import router

    assert isinstance(router, APIRouter)


def test_webhooks_router_has_no_routes() -> None:
    """Guard against accidentally shipping an unauthenticated webhook endpoint."""
    from app.api.v1.webhooks import router

    assert router.routes == []
