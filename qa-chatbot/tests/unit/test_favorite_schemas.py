import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.favorite import (
    FavoriteCategory,
    FavoriteCreateRequest,
    FavoriteResponse,
    FavoriteUpdateRequest,
)


def test_create_request_requires_prompt_version_id() -> None:
    with pytest.raises(ValidationError):
        FavoriteCreateRequest()  # type: ignore[call-arg]


def test_create_request_accepts_uuid() -> None:
    req = FavoriteCreateRequest(prompt_version_id=uuid.uuid4())
    assert isinstance(req.prompt_version_id, uuid.UUID)


def test_update_request_all_fields_optional() -> None:
    req = FavoriteUpdateRequest()
    assert req.note is None
    assert req.tags is None
    assert req.category is None
    assert req.is_pinned is None


def test_update_request_validates_category() -> None:
    FavoriteUpdateRequest(category="Writing")
    with pytest.raises(ValidationError):
        FavoriteUpdateRequest(category="Bogus")  # type: ignore[arg-type]


def test_update_request_max_10_tags() -> None:
    FavoriteUpdateRequest(tags=["a"] * 10)
    with pytest.raises(ValidationError):
        FavoriteUpdateRequest(tags=["a"] * 11)


def test_category_enum_values() -> None:
    assert {c.value for c in FavoriteCategory} == {"Writing", "Coding", "Analysis", "Other"}


def test_response_has_prompt_store_id_alias() -> None:
    r = FavoriteResponse(
        id=uuid.uuid4(),
        prompt_version_id=uuid.uuid4(),
        prompt_id=str(uuid.uuid4()),
        family_name="fam",
        version=1,
        content="hello",
        note=None,
        tags=[],
        category="Other",
        is_pinned=False,
        use_count=0,
        last_used_at=None,
        liked_at=datetime.now(UTC),
        version_created_at=datetime.now(UTC),
        token_usage=None,
    )
    assert r.id
