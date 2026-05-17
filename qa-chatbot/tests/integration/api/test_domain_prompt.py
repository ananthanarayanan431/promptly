"""Integration tests for the domain-prompt API endpoints."""

from __future__ import annotations

import io
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()

_MINIMAL_PDF = b"%PDF-1.4 fake pdf content for testing purposes"
_VALID_PROMPT = "You are a helpful assistant. Answer questions based on the provided context."


async def _make_user_headers(client: AsyncClient) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


def _minio_patch() -> Any:
    """Return a context-manager mock that silences MinIO calls."""
    return patch.multiple(
        "app.domain_prompt.api.router",
        upload_bytes=MagicMock(),
        upload_text=MagicMock(),
        download_text=MagicMock(return_value=""),
        delete_objects_with_prefix=MagicMock(),
    )


@pytest.mark.asyncio
async def test_list_domains_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/domain-prompts/", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["domains"] == []


@pytest.mark.asyncio
async def test_list_domains_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/domain-prompts/")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_domain_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_domain_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.delete(f"/api/v1/domain-prompts/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_create_domain_unauthenticated(client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_domain_non_pdf_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.txt", io.BytesIO(b"plain text content"), "text/plain")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_domain_invalid_pdf_content_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A .pdf filename but non-PDF bytes should be rejected."""
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(b"not a real pdf"), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_domain_insufficient_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from sqlalchemy import select

    from app.models.user import User

    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = 0
    await db_session.commit()

    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_create_domain_success(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "My Test Domain", "description": "A test knowledge base"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)

    assert res.status_code == 202
    data_out = res.json()["data"]
    assert "job_id" in data_out
    assert "domain_id" in data_out


@pytest.mark.asyncio
async def test_create_domain_appears_in_list(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Listed Domain"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)

    res = await client.get("/api/v1/domain-prompts/", headers=headers)
    assert res.status_code == 200
    assert len(res.json()["data"]["domains"]) == 1
    assert res.json()["data"]["domains"][0]["name"] == "Listed Domain"


@pytest.mark.asyncio
async def test_get_domain_after_create(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Get Domain Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    domain_id = create_res.json()["data"]["domain_id"]

    res = await client.get(f"/api/v1/domain-prompts/{domain_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["name"] == "Get Domain Test"


@pytest.mark.asyncio
async def test_get_domain_other_user_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    h1 = await _make_user_headers(client)
    h2 = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Private Domain"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=h1
        )
    domain_id = create_res.json()["data"]["domain_id"]

    res = await client.get(f"/api/v1/domain-prompts/{domain_id}", headers=h2)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_domain_job_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/jobs/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_domain_job_queued(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Poll Job Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    job_id = create_res.json()["data"]["job_id"]

    res = await client.get(f"/api/v1/domain-prompts/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "queued"


@pytest.mark.asyncio
async def test_delete_domain_success(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Delete Me"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    domain_id = create_res.json()["data"]["domain_id"]

    with patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None):
        res = await client.delete(f"/api/v1/domain-prompts/{domain_id}", headers=headers)
    assert res.status_code == 200

    # Confirm gone
    res2 = await client.get(f"/api/v1/domain-prompts/{domain_id}", headers=headers)
    assert res2.status_code == 404


@pytest.mark.asyncio
async def test_domain_runs_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/runs", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_domain_runs_empty_after_create(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Runs Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn, *args, **kwargs: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    domain_id = create_res.json()["data"]["domain_id"]

    res = await client.get(f"/api/v1/domain-prompts/{domain_id}/runs", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["runs"] == []


# ---------------------------------------------------------------------------
# Dataset endpoints
# ---------------------------------------------------------------------------


async def _create_domain_with_dataset(
    client: AsyncClient,
    headers: dict[str, str],
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
        res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 202
    d = res.json()["data"]
    return d["domain_id"], d["job_id"]


@pytest.mark.asyncio
async def test_get_dataset_rows_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/dataset", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_dataset_rows_empty_when_no_dataset_key(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain exists but dataset_key is None — should return empty rows."""
    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Empty Dataset")

    with patch(
        "app.domain_prompt.api.router.download_text",
        return_value="",
    ):
        res = await client.get(f"/api/v1/domain-prompts/{domain_id}/dataset", headers=headers)

    assert res.status_code == 200
    assert res.json()["data"]["rows"] == []
    assert res.json()["data"]["row_count"] == 0


@pytest.mark.asyncio
async def test_update_dataset_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.put(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/dataset",
        json={"rows": [{"question": "Q?", "answer": "A"}]},
        headers=headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_update_dataset_success(client: AsyncClient, db_session: AsyncSession) -> None:
    """PUT /dataset replaces rows and returns the new set."""
    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Update Dataset")

    new_rows = [
        {"question": "What is AI?", "answer": "Artificial Intelligence"},
        {"question": "What is ML?", "answer": "Machine Learning"},
    ]
    with patch("app.domain_prompt.api.router.upload_text"):
        res = await client.put(
            f"/api/v1/domain-prompts/{domain_id}/dataset",
            json={"rows": new_rows},
            headers=headers,
        )

    assert res.status_code == 200
    data = res.json()["data"]
    assert data["row_count"] == 2
    assert len(data["rows"]) == 2


# ---------------------------------------------------------------------------
# Augment endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_augment_dataset_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.post(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/dataset/augment",
        json={"count": 5},
        headers=headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_augment_dataset_no_dataset_key_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain with no dataset_key cannot be augmented."""
    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Augment No Key")

    res = await client.post(
        f"/api/v1/domain-prompts/{domain_id}/dataset/augment",
        json={"count": 3},
        headers=headers,
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Tournament-state endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tournament_state_not_found_domain(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/tournament-state", headers=headers
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_tournament_state_no_state_yet_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain exists but no tournament state in Redis — 404."""
    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Tournament State")

    with patch(
        "app.domain_prompt.api.router.get_dp_tournament_state",
        return_value=None,
    ):
        res = await client.get(
            f"/api/v1/domain-prompts/{domain_id}/tournament-state", headers=headers
        )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Optimize endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_optimize_domain_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.post(
        f"/api/v1/domain-prompts/{uuid.uuid4()!s}/optimize",
        json={"prompt": _VALID_PROMPT},
        headers=headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_optimize_domain_insufficient_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from sqlalchemy import select, update

    from app.domain_prompt.data.models import DomainDataset, DomainPrompt, DomainPromptStatus
    from app.models.user import User

    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    # Create domain through API
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Low Credits Domain")

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

    # Zero out credits
    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = 0
    await db_session.commit()

    res = await client.post(
        f"/api/v1/domain-prompts/{domain_id}/optimize",
        json={"prompt": _VALID_PROMPT},
        headers=headers,
    )
    assert res.status_code == 402


# ---------------------------------------------------------------------------
# Stop endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.post(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/stop", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_stop_domain_not_running_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Stopping a domain that's not in an active state returns 409."""
    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Stop Not Running")

    res = await client.post(f"/api/v1/domain-prompts/{domain_id}/stop", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_stop_domain_optimizing_resets_to_failed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain stuck in 'optimizing' with no dataset reverts to 'failed' on stop."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainPrompt, DomainPromptStatus

    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Stop Optimizing")

    # Manually put domain into optimizing state
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.optimizing)
    )
    await db_session.commit()

    res = await client.post(f"/api/v1/domain-prompts/{domain_id}/stop", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "failed"


@pytest.mark.asyncio
async def test_stop_domain_preparing_with_dataset_resets_to_completed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Domain stuck in 'preparing_dataset' with dataset_key reverts to 'completed'."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset, DomainPrompt, DomainPromptStatus

    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Stop Preparing")

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

    res = await client.post(f"/api/v1/domain-prompts/{domain_id}/stop", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_tournament_state_returns_state(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """When Redis has tournament state, the endpoint returns it."""
    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Tournament Has State")

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
        res = await client.get(
            f"/api/v1/domain-prompts/{domain_id}/tournament-state", headers=headers
        )
    assert res.status_code == 200
    assert res.json()["data"]["round"] == 1


@pytest.mark.asyncio
async def test_augment_dataset_queues_job(client: AsyncClient, db_session: AsyncSession) -> None:
    """Domain with dataset_key returns 202 with job_id."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset

    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Augment With Key")

    # Give the dataset a key
    await db_session.execute(
        update(DomainDataset)
        .where(DomainDataset.domain_id == uuid.UUID(domain_id))
        .values(dataset_key="users/test/domains/test/dataset.jsonl")
    )
    await db_session.commit()

    with patch("app.domain_prompt.api.router.augment_domain_dataset.apply_async"):
        res = await client.post(
            f"/api/v1/domain-prompts/{domain_id}/dataset/augment",
            json={"count": 5},
            headers=headers,
        )
    assert res.status_code == 202
    assert "job_id" in res.json()["data"]


@pytest.mark.asyncio
async def test_optimize_domain_queues_job(client: AsyncClient, db_session: AsyncSession) -> None:
    """Domain with sufficient credits and dataset_key returns 202."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainDataset, DomainPrompt, DomainPromptStatus

    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Optimize With Key")

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
        res = await client.post(
            f"/api/v1/domain-prompts/{domain_id}/optimize",
            json={"prompt": _VALID_PROMPT},
            headers=headers,
        )
    assert res.status_code == 202
    assert "job_id" in res.json()["data"]


@pytest.mark.asyncio
async def test_optimize_domain_already_running_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainPrompt, DomainPromptStatus

    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(
        client, headers, name="Optimize Already Running"
    )

    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.optimizing)
    )
    await db_session.commit()

    res = await client.post(
        f"/api/v1/domain-prompts/{domain_id}/optimize",
        json={"prompt": _VALID_PROMPT},
        headers=headers,
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_optimize_domain_no_dataset_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Optimizing a domain with no dataset_key returns 409 (not ready)."""
    from sqlalchemy import update

    from app.domain_prompt.data.models import DomainPrompt, DomainPromptStatus

    headers = await _make_user_headers(client)
    domain_id, _ = await _create_domain_with_dataset(client, headers, name="Optimize No Dataset")

    # Status completed but no dataset_key
    await db_session.execute(
        update(DomainPrompt)
        .where(DomainPrompt.id == uuid.UUID(domain_id))
        .values(status=DomainPromptStatus.completed)
    )
    await db_session.commit()

    res = await client.post(
        f"/api/v1/domain-prompts/{domain_id}/optimize",
        json={"prompt": _VALID_PROMPT},
        headers=headers,
    )
    assert res.status_code == 409
