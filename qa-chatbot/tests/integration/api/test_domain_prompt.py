"""Integration tests for the domain-prompt API endpoints."""

from __future__ import annotations

import io
import uuid
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.dependencies import get_current_user, get_db
from app.main import create_app
from app.models.user import User

_MINIMAL_PDF = b"%PDF-1.4 fake pdf content for testing purposes"
_VALID_PROMPT = "You are a helpful assistant. Answer questions based on the provided context."


def _make_user_context(
    user: User,
    *,
    credits: int = 100,
) -> UserContext:
    return UserContext(
        user_id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        credits=credits,
    )


def _minio_patch() -> Any:
    """Return a context-manager mock that silences MinIO calls."""
    return patch.multiple(
        "app.domain_prompt.api.router",
        upload_bytes=MagicMock(),
        upload_text=MagicMock(),
        download_text=MagicMock(return_value=""),
        delete_objects_with_prefix=MagicMock(),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="session")
async def _test_user(db_session: AsyncSession) -> User:
    """Create a real User row in the DB (FK required by domain_prompts.user_id)."""
    user = User(
        email="domain_prompt_user@example.com",
        supabase_user_id="user_domain_prompt_1",
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture(loop_scope="session")
async def _test_user2(db_session: AsyncSession) -> User:
    """A second real User row — used for cross-user ownership tests."""
    user = User(
        email="domain_prompt_user2@example.com",
        supabase_user_id="user_domain_prompt_2",
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture(loop_scope="session")
async def authed_client(
    db_session: AsyncSession, _test_user: User
) -> AsyncGenerator[AsyncClient, None]:
    """Authenticated client: 100 credits, org:optimize:pdo permission."""
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_current_user() -> UserContext:
        return _make_user_context(_test_user)

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture(loop_scope="session")
async def authed_client2(
    db_session: AsyncSession, _test_user2: User
) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient overridden with a *different* user — for cross-user ownership tests."""
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_current_user() -> UserContext:
        return _make_user_context(_test_user2)

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture(loop_scope="session")
async def low_credits_client(
    db_session: AsyncSession, _test_user: User
) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient overridden with 0 credits — for insufficient-credits tests."""
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_current_user() -> UserContext:
        return _make_user_context(_test_user, credits=0)

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture(loop_scope="session")
async def unauthed_client(
    db_session: AsyncSession,
) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient with NO get_current_user override — auth will fail with 401."""
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_domain_with_dataset(
    client: AsyncClient,
    *,
    name: str = "Dataset Test",
) -> tuple[str, str]:
    """Create a domain and return (domain_id, job_id)."""
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": name}
    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        res = await client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 202, res.text
    d = res.json()["data"]
    return d["domain_id"], d["job_id"]


# ---------------------------------------------------------------------------
# List / basic auth tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_domains_empty(authed_client: AsyncClient) -> None:
    res = await authed_client.get("/api/v1/domain-prompts/")
    assert res.status_code == 200
    assert res.json()["data"]["domains"] == []


@pytest.mark.asyncio
async def test_list_domains_unauthenticated(unauthed_client: AsyncClient) -> None:
    res = await unauthed_client.get("/api/v1/domain-prompts/")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_domain_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_domain_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.delete(f"/api/v1/domain-prompts/{uuid.uuid4()!s}")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_create_domain_unauthenticated(unauthed_client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await unauthed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_domain_non_pdf_rejected(authed_client: AsyncClient) -> None:
    files = {"file": ("test.txt", io.BytesIO(b"plain text content"), "text/plain")}
    data = {"name": "Test Domain"}
    res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_domain_invalid_pdf_content_rejected(authed_client: AsyncClient) -> None:
    """A .pdf filename but non-PDF bytes should be rejected."""
    files = {"file": ("test.pdf", io.BytesIO(b"not a real pdf"), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_domain_insufficient_credits(
    low_credits_client: AsyncClient,
) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await low_credits_client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_create_domain_success(authed_client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "My Test Domain", "description": "A test knowledge base"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)

    assert res.status_code == 202
    data_out = res.json()["data"]
    assert "job_id" in data_out
    assert "domain_id" in data_out


@pytest.mark.asyncio
async def test_create_domain_appears_in_list(authed_client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Listed Domain"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)

    res = await authed_client.get("/api/v1/domain-prompts/")
    assert res.status_code == 200
    domains = res.json()["data"]["domains"]
    assert any(d["name"] == "Listed Domain" for d in domains)


@pytest.mark.asyncio
async def test_get_domain_after_create(authed_client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Get Domain Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    domain_id = create_res.json()["data"]["domain_id"]

    res = await authed_client.get(f"/api/v1/domain-prompts/{domain_id}")
    assert res.status_code == 200
    assert res.json()["data"]["name"] == "Get Domain Test"


@pytest.mark.asyncio
async def test_get_domain_other_user_not_found(
    authed_client: AsyncClient,
    authed_client2: AsyncClient,
) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Private Domain"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    domain_id = create_res.json()["data"]["domain_id"]

    # A different user should not be able to see this domain
    res = await authed_client2.get(f"/api/v1/domain-prompts/{domain_id}")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_domain_job_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.get(f"/api/v1/domain-prompts/jobs/{uuid.uuid4()!s}")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_domain_job_queued(authed_client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Poll Job Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    job_id = create_res.json()["data"]["job_id"]

    res = await authed_client.get(f"/api/v1/domain-prompts/jobs/{job_id}")
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "queued"


@pytest.mark.asyncio
async def test_delete_domain_success(authed_client: AsyncClient, db_session: AsyncSession) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Delete Me"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    domain_id = create_res.json()["data"]["domain_id"]

    with patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None):
        res = await authed_client.delete(f"/api/v1/domain-prompts/{domain_id}")
    assert res.status_code == 200

    # Confirm gone
    res2 = await authed_client.get(f"/api/v1/domain-prompts/{domain_id}")
    assert res2.status_code == 404


@pytest.mark.asyncio
async def test_domain_runs_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/runs")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_domain_runs_empty_after_create(authed_client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Runs Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await authed_client.post("/api/v1/domain-prompts/", files=files, data=data)
    domain_id = create_res.json()["data"]["domain_id"]

    res = await authed_client.get(f"/api/v1/domain-prompts/{domain_id}/runs")
    assert res.status_code == 200
    assert res.json()["data"]["runs"] == []


# ---------------------------------------------------------------------------
# Dataset endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_dataset_rows_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/dataset")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_dataset_rows_empty_when_no_dataset_key(authed_client: AsyncClient) -> None:
    """Domain exists but dataset_key is None — should return empty rows."""
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Empty Dataset")

    with patch(
        "app.domain_prompt.api.router.download_text",
        return_value="",
    ):
        res = await authed_client.get(f"/api/v1/domain-prompts/{domain_id}/dataset")

    assert res.status_code == 200
    assert res.json()["data"]["rows"] == []
    assert res.json()["data"]["row_count"] == 0


@pytest.mark.asyncio
async def test_update_dataset_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.put(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/dataset",
        json={"rows": [{"question": "Q?", "answer": "A"}]},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_update_dataset_success(authed_client: AsyncClient) -> None:
    """PUT /dataset replaces rows and returns the new set."""
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Update Dataset")

    new_rows = [
        {"question": "What is AI?", "answer": "Artificial Intelligence"},
        {"question": "What is ML?", "answer": "Machine Learning"},
    ]
    with patch("app.domain_prompt.api.router.upload_text"):
        res = await authed_client.put(
            f"/api/v1/domain-prompts/{domain_id}/dataset",
            json={"rows": new_rows},
        )

    assert res.status_code == 200
    data = res.json()["data"]
    assert data["row_count"] == 2
    assert len(data["rows"]) == 2


# ---------------------------------------------------------------------------
# Augment endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_augment_dataset_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.post(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/dataset/augment",
        json={"count": 5},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_augment_dataset_no_dataset_key_returns_404(authed_client: AsyncClient) -> None:
    """Domain with no dataset_key cannot be augmented."""
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Augment No Key")

    res = await authed_client.post(
        f"/api/v1/domain-prompts/{domain_id}/dataset/augment",
        json={"count": 3},
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Tournament-state endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tournament_state_not_found_domain(authed_client: AsyncClient) -> None:
    res = await authed_client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/tournament-state")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_tournament_state_no_state_yet_returns_404(authed_client: AsyncClient) -> None:
    """Domain exists but no tournament state in Redis — 404."""
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Tournament State")

    with patch(
        "app.domain_prompt.api.router.get_dp_tournament_state",
        return_value=None,
    ):
        res = await authed_client.get(f"/api/v1/domain-prompts/{domain_id}/tournament-state")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Optimize endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_optimize_domain_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.post(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/optimize",
        json={"prompt": _VALID_PROMPT},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_optimize_domain_insufficient_credits(
    low_credits_client: AsyncClient,
    authed_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset, DomainPrompt, DomainPromptStatus

    # Create the domain with the full-credits client first
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Low Credits Domain")

    # Advance domain to completed with a dataset_key so credits check is reached
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.completed)
    )
    await db_session.execute(
        update(DomainDataset)
        .where(DomainDataset.domain_id == uuid.UUID(domain_id))
        .values(dataset_key="users/test/domains/test/dataset.jsonl")
    )
    await db_session.commit()

    # Now try to optimize using the low-credits client (same user_id, 0 credits in UserContext)
    res = await low_credits_client.post(
        f"/api/v1/domain-prompts/{domain_id}/optimize",
        json={"prompt": _VALID_PROMPT},
    )
    assert res.status_code == 402


# ---------------------------------------------------------------------------
# Stop endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_not_found(authed_client: AsyncClient) -> None:
    res = await authed_client.post(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/stop")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_stop_domain_not_running_returns_409(authed_client: AsyncClient) -> None:
    """Stopping a domain that's not in an active state returns 409."""
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Stop Not Running")

    res = await authed_client.post(f"/api/v1/domain-prompts/{domain_id}/stop")
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_stop_domain_optimizing_resets_to_failed(
    authed_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain stuck in 'optimizing' with no dataset reverts to 'failed' on stop."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainPrompt, DomainPromptStatus

    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Stop Optimizing")

    # Manually put domain into optimizing state
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.optimizing)
    )
    await db_session.commit()

    res = await authed_client.post(f"/api/v1/domain-prompts/{domain_id}/stop")
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "failed"


@pytest.mark.asyncio
async def test_stop_domain_preparing_with_dataset_resets_to_completed(
    authed_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain stuck in 'preparing_dataset' with dataset_key reverts to 'completed'."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset, DomainPrompt, DomainPromptStatus

    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Stop Preparing")

    # Give the dataset a dataset_key and set status to preparing_dataset
    await db_session.execute(
        update(DomainDataset)
        .where(DomainDataset.domain_id == uuid.UUID(domain_id))
        .values(dataset_key="users/test/domains/test/dataset.jsonl")
    )
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.preparing_dataset)
    )
    await db_session.commit()

    res = await authed_client.post(f"/api/v1/domain-prompts/{domain_id}/stop")
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_tournament_state_returns_state(authed_client: AsyncClient) -> None:
    """When Redis has tournament state, the endpoint returns it."""
    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Tournament Has State")

    fake_state = {
        "round": 1,
        "total_rounds": 5,
        "candidate_count": 2,
        "names": ["prompt A", "prompt B"],
        "copeland_scores": [1.0, 0.0],
        "avg_win_rates": [0.75, 0.25],
        "W": [[0.0, 1.0], [0.0, 0.0]],
        "duel_i": 0,
        "duel_j": 1,
        "question": "Is this prompt better?",
    }
    with patch(
        "app.domain_prompt.api.router.get_dp_tournament_state",
        return_value=fake_state,
    ):
        res = await authed_client.get(f"/api/v1/domain-prompts/{domain_id}/tournament-state")
    assert res.status_code == 200
    assert res.json()["data"]["round"] == 1


@pytest.mark.asyncio
async def test_augment_dataset_queues_job(
    authed_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain with dataset_key returns 202 with job_id."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset

    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Augment With Key")

    # Give the dataset a key
    await db_session.execute(
        update(DomainDataset)
        .where(DomainDataset.domain_id == uuid.UUID(domain_id))
        .values(dataset_key="users/test/domains/test/dataset.jsonl")
    )
    await db_session.commit()

    with patch("app.domain_prompt.api.router.augment_domain_dataset.apply_async"):
        res = await authed_client.post(
            f"/api/v1/domain-prompts/{domain_id}/dataset/augment",
            json={"count": 5},
        )
    assert res.status_code == 202
    assert "job_id" in res.json()["data"]


@pytest.mark.asyncio
async def test_optimize_domain_queues_job(
    authed_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain with sufficient credits and dataset_key returns 202."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset, DomainPrompt, DomainPromptStatus

    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Optimize With Key")

    # Set domain to completed with a dataset_key
    await db_session.execute(
        update(DomainDataset)
        .where(DomainDataset.domain_id == uuid.UUID(domain_id))
        .values(dataset_key="users/test/domains/test/dataset.jsonl")
    )
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.completed)
    )
    await db_session.commit()

    with patch("app.domain_prompt.api.router.run_domain_optimization.apply_async"):
        res = await authed_client.post(
            f"/api/v1/domain-prompts/{domain_id}/optimize",
            json={"prompt": _VALID_PROMPT},
        )
    assert res.status_code == 202
    assert "job_id" in res.json()["data"]


@pytest.mark.asyncio
async def test_optimize_domain_already_running_returns_409(
    authed_client: AsyncClient, db_session: AsyncSession
) -> None:
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainPrompt, DomainPromptStatus

    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Optimize Already Running")

    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.optimizing)
    )
    await db_session.commit()

    res = await authed_client.post(
        f"/api/v1/domain-prompts/{domain_id}/optimize",
        json={"prompt": _VALID_PROMPT},
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_optimize_domain_no_dataset_returns_409(
    authed_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Optimizing a domain with no dataset_key returns 409 (not ready)."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainPrompt, DomainPromptStatus

    domain_id, _ = await _create_domain_with_dataset(authed_client, name="Optimize No Dataset")

    # Status completed but no dataset_key
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.completed)
    )
    await db_session.commit()

    res = await authed_client.post(
        f"/api/v1/domain-prompts/{domain_id}/optimize",
        json={"prompt": _VALID_PROMPT},
    )
    assert res.status_code == 409
