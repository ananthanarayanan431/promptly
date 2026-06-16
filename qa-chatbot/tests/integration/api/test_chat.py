import uuid
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

from promptly.core.cache import set_job_owner, set_job_result, set_job_status


@pytest.mark.asyncio
async def test_submit_chat_returns_job_id(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    with patch("promptly.optimize.api.router.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": "You are a helpful assistant."},
            headers=headers,
        )
    assert res.status_code == 202
    data = res.json()["data"]
    assert "job_id" in data
    assert "session_id" in data


@pytest.mark.asyncio
async def test_submit_chat_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/chat/", json={"prompt": "hello"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_poll_job_known_id(client: AsyncClient, make_user) -> None:
    user, headers = await make_user()

    job_id = str(uuid.uuid4())
    await set_job_status(job_id, "completed")
    await set_job_owner(job_id, str(user.id))
    await set_job_result(
        job_id,
        {
            "session_id": str(uuid.uuid4()),
            "original_prompt": "You are a helpful assistant.",
            "optimized_prompt": "Better prompt.",
            "token_usage": {},
        },
    )

    res = await client.get(f"/api/v1/chat/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_poll_job_unknown_id(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get(f"/api/v1/chat/jobs/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_unauthenticated(client: AsyncClient) -> None:
    res = await client.get(f"/api/v1/chat/jobs/{uuid.uuid4()}")
    assert res.status_code == 401
