"""Unit tests for app.core.cache — all Redis calls are mocked via AsyncMock."""

import hashlib
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.core.cache import (
    CACHE_PREFIX,
    JOB_PREFIX,
    _cache_key,
    _job_key,
    get_cached_response,
    get_job_progress_from,
    push_job_progress,
    set_cached_response,
)

# ---------------------------------------------------------------------------
# Key construction helpers
# ---------------------------------------------------------------------------


def test_cache_key_is_deterministic() -> None:
    key1 = _cache_key("Hello world")
    key2 = _cache_key("Hello world")
    assert key1 == key2


def test_cache_key_contains_sha256_of_stripped_lower_prompt() -> None:
    prompt = "  Hello World  "
    digest = hashlib.sha256(prompt.strip().lower().encode()).hexdigest()
    assert _cache_key(prompt) == f"{CACHE_PREFIX}{digest}"


def test_cache_key_differs_for_different_prompts() -> None:
    assert _cache_key("prompt one") != _cache_key("prompt two")


def test_job_key_includes_job_id() -> None:
    job_id = "abc-123"
    key = _job_key(job_id)
    assert key == f"{JOB_PREFIX}{job_id}"


def test_job_key_contains_job_id_substring() -> None:
    job_id = "unique-job-xyz"
    assert job_id in _job_key(job_id)


# ---------------------------------------------------------------------------
# get_cached_response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_cached_response_returns_none_when_key_missing() -> None:
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        result = await get_cached_response("some prompt")

    assert result is None
    mock_redis.get.assert_called_once_with(_cache_key("some prompt"))


@pytest.mark.asyncio
async def test_get_cached_response_returns_parsed_dict_when_present() -> None:
    payload = {"optimized": "better prompt", "token_usage": {"total": 100}}
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps(payload))

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        result = await get_cached_response("my prompt")

    assert result == payload


# ---------------------------------------------------------------------------
# set_cached_response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_cached_response_calls_redis_set_with_json_serialized_data() -> None:
    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)

    data = {"optimized": "new prompt", "score": 0.95}

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        await set_cached_response("test prompt", data)

    mock_redis.set.assert_called_once()
    call_args = mock_redis.set.call_args
    assert call_args[0][0] == _cache_key("test prompt")
    assert json.loads(call_args[0][1]) == data


@pytest.mark.asyncio
async def test_set_cached_response_uses_custom_ttl() -> None:
    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        await set_cached_response("prompt", {"x": 1}, ttl=42)

    call_kwargs = mock_redis.set.call_args[1]
    assert call_kwargs.get("ex") == 42


# ---------------------------------------------------------------------------
# push_job_progress
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_push_job_progress_calls_rpush_and_expire() -> None:
    mock_redis = AsyncMock()
    mock_redis.rpush = AsyncMock(return_value=1)
    mock_redis.expire = AsyncMock(return_value=True)

    event = {"node": "council_vote", "status": "started"}
    job_id = "job-001"
    expected_key = f"{_job_key(job_id)}:progress"

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        await push_job_progress(job_id, event)

    mock_redis.rpush.assert_called_once_with(expected_key, json.dumps(event))
    mock_redis.expire.assert_called_once()
    expire_call_args = mock_redis.expire.call_args[0]
    assert expire_call_args[0] == expected_key


@pytest.mark.asyncio
async def test_push_job_progress_serialises_event_as_json() -> None:
    mock_redis = AsyncMock()
    mock_redis.rpush = AsyncMock(return_value=1)
    mock_redis.expire = AsyncMock(return_value=True)

    event = {"node": "synthesize", "tokens": 200, "done": True}

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        await push_job_progress("job-abc", event)

    serialised = mock_redis.rpush.call_args[0][1]
    assert json.loads(serialised) == event


# ---------------------------------------------------------------------------
# get_job_progress_from
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_job_progress_from_returns_empty_list_when_no_events() -> None:
    mock_redis = AsyncMock()
    mock_redis.lrange = AsyncMock(return_value=[])

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        result = await get_job_progress_from("job-xyz", start=0)

    assert result == []


@pytest.mark.asyncio
async def test_get_job_progress_from_calls_lrange_with_correct_args() -> None:
    mock_redis = AsyncMock()
    mock_redis.lrange = AsyncMock(return_value=[])

    job_id = "job-lrange"
    expected_key = f"{_job_key(job_id)}:progress"

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        await get_job_progress_from(job_id, start=3)

    mock_redis.lrange.assert_called_once_with(expected_key, 3, -1)


@pytest.mark.asyncio
async def test_get_job_progress_from_parses_json_events() -> None:
    events = [
        {"node": "intent_classifier", "result": "OPTIMIZE"},
        {"node": "council_vote", "result": "done"},
    ]
    raw = [json.dumps(e) for e in events]

    mock_redis = AsyncMock()
    mock_redis.lrange = AsyncMock(return_value=raw)

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        result = await get_job_progress_from("job-parse", start=0)

    assert result == events


@pytest.mark.asyncio
async def test_get_job_progress_from_partial_start_index() -> None:
    """Only events at index >= start should be returned (lrange handles this)."""
    events = [
        {"node": "critic", "index": 1},
        {"node": "synthesize", "index": 2},
    ]
    raw = [json.dumps(e) for e in events]

    mock_redis = AsyncMock()
    mock_redis.lrange = AsyncMock(return_value=raw)

    with patch("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis)):
        result = await get_job_progress_from("job-partial", start=2)

    assert len(result) == 2
    assert result[0]["node"] == "critic"
    mock_redis.lrange.assert_called_once_with(f"{_job_key('job-partial')}:progress", 2, -1)
