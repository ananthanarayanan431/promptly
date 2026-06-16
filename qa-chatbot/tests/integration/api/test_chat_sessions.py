"""Integration tests for chat session endpoints: list, get, rename, delete."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

from promptly.core.cache import set_job_owner, set_job_result, set_job_status


async def _submit_chat(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    prompt: str = "You are a helpful assistant.",
) -> str:
    """Submit a chat job and return the session_id."""
    with patch("promptly.optimize.api.router.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": prompt},
            headers=headers,
        )
    assert res.status_code == 202
    return res.json()["data"]["session_id"]


@pytest.mark.asyncio
async def test_list_sessions_empty(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/chat/sessions", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["today"] == []
    assert data["last_7_days"] == []
    assert data["last_30_days"] == []
    assert data["older"] == []


@pytest.mark.asyncio
async def test_list_sessions_after_submit(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    await _submit_chat(client, headers)
    res = await client.get("/api/v1/chat/sessions", headers=headers)
    assert res.status_code == 200
    # session created today — should appear in "today" bucket
    data = res.json()["data"]
    assert len(data["today"]) >= 1


@pytest.mark.asyncio
async def test_list_sessions_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/chat/sessions")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_session_exists(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    session_id = await _submit_chat(client, headers)
    res = await client.get(f"/api/v1/chat/sessions/{session_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert str(data["id"]) == session_id
    assert "messages" in data


@pytest.mark.asyncio
async def test_get_session_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get(f"/api/v1/chat/sessions/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_session_invalid_id(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/chat/sessions/not-a-uuid", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_get_session_other_users_session(client: AsyncClient, make_user) -> None:
    _, headers_a = await make_user()
    _, headers_b = await make_user()
    session_id = await _submit_chat(client, headers_a)
    # user B cannot access user A's session
    res = await client.get(f"/api/v1/chat/sessions/{session_id}", headers=headers_b)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_rename_session(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    session_id = await _submit_chat(client, headers)
    res = await client.patch(
        f"/api/v1/chat/sessions/{session_id}",
        json={"title": "My renamed session"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["data"]["title"] == "My renamed session"


@pytest.mark.asyncio
async def test_rename_session_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.patch(
        f"/api/v1/chat/sessions/{uuid.uuid4()}",
        json={"title": "New title"},
        headers=headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_rename_session_invalid_id(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.patch(
        "/api/v1/chat/sessions/not-a-uuid",
        json={"title": "Anything"},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_delete_session(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    session_id = await _submit_chat(client, headers)

    res = await client.delete(f"/api/v1/chat/sessions/{session_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["deleted"] == session_id

    # Session should no longer be accessible
    get_res = await client.get(f"/api/v1/chat/sessions/{session_id}", headers=headers)
    assert get_res.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.delete(f"/api/v1/chat/sessions/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_invalid_id(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.delete("/api/v1/chat/sessions/not-a-uuid", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_delete_other_users_session(client: AsyncClient, make_user) -> None:
    _, headers_a = await make_user()
    _, headers_b = await make_user()
    session_id = await _submit_chat(client, headers_a)
    res = await client.delete(f"/api/v1/chat/sessions/{session_id}", headers=headers_b)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_queued_status(client: AsyncClient, make_user) -> None:
    user, headers = await make_user()

    job_id = str(uuid.uuid4())
    await set_job_status(job_id, "queued")
    await set_job_owner(job_id, str(user.id))

    res = await client.get(f"/api/v1/chat/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "queued"
    assert res.json()["data"]["result"] is None


@pytest.mark.asyncio
async def test_poll_job_failed_status(client: AsyncClient, make_user) -> None:
    user, headers = await make_user()

    job_id = str(uuid.uuid4())
    await set_job_status(job_id, "failed")
    await set_job_owner(job_id, str(user.id))
    await set_job_result(job_id, {"error": "LLM timeout"})

    res = await client.get(f"/api/v1/chat/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["status"] == "failed"
    assert data["error"] == "LLM timeout"


@pytest.mark.asyncio
async def test_poll_job_other_users_job(client: AsyncClient, make_user) -> None:
    """A user cannot poll another user's job."""
    user_a, _ = await make_user()
    _, headers_b = await make_user()

    job_id = str(uuid.uuid4())
    await set_job_status(job_id, "queued")
    await set_job_owner(job_id, str(user_a.id))

    res = await client.get(f"/api/v1/chat/jobs/{job_id}", headers=headers_b)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_recent_sessions_empty(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/chat/sessions/recent", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["sessions"] == []


@pytest.mark.asyncio
async def test_recent_sessions_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/chat/sessions/recent")
    assert res.status_code == 401
