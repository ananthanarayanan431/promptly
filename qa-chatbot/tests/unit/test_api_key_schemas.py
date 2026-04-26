import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.api_key import (
    ApiKeyCreatedResponse,
    ApiKeyCreateRequest,
    ApiKeyListResponse,
    ApiKeyResponse,
)


def test_create_request_requires_name() -> None:
    with pytest.raises(ValidationError):
        ApiKeyCreateRequest()  # type: ignore[call-arg]


def test_create_request_rejects_blank_name() -> None:
    with pytest.raises(ValidationError):
        ApiKeyCreateRequest(name="   ")


def test_create_request_rejects_name_over_100_chars() -> None:
    with pytest.raises(ValidationError):
        ApiKeyCreateRequest(name="x" * 101)


def test_create_request_accepts_valid_name() -> None:
    req = ApiKeyCreateRequest(name="production")
    assert req.name == "production"


def test_created_response_includes_raw_key() -> None:
    resp = ApiKeyCreatedResponse(
        id=uuid.uuid4(),
        name="production",
        key="qac_abc123",
        created_at=datetime.now(UTC),
    )
    assert resp.key.startswith("qac_")


def test_api_key_response_never_has_key_field() -> None:
    resp = ApiKeyResponse(
        id=uuid.uuid4(),
        name="production",
        is_active=True,
        created_at=datetime.now(UTC),
        revoked_at=None,
    )
    assert not hasattr(resp, "key")


def test_api_key_list_response_wraps_list() -> None:
    resp = ApiKeyListResponse(keys=[])
    assert resp.keys == []
