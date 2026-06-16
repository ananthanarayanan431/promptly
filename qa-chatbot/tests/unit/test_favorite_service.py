"""Unit tests for FavoriteService and its helper functions."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from promptly.services.favorite_service import FavoriteService, _extract_json_object

# ── _extract_json_object pure tests ───────────────────────────────────────────


def test_extract_json_object_plain() -> None:
    raw = '{"tags": ["coding"], "category": "Coding"}'
    result = _extract_json_object(raw)
    assert result["tags"] == ["coding"]
    assert result["category"] == "Coding"


def test_extract_json_object_markdown_fence() -> None:
    raw = '```json\n{"tags": ["writing"], "category": "Writing"}\n```'
    result = _extract_json_object(raw)
    assert result["category"] == "Writing"


def test_extract_json_object_plain_fence() -> None:
    raw = '```\n{"tags": [], "category": "Other"}\n```'
    result = _extract_json_object(raw)
    assert result["category"] == "Other"


def test_extract_json_object_with_preamble() -> None:
    raw = 'Here are the tags: {"tags": ["analysis"], "category": "Analysis"}'
    result = _extract_json_object(raw)
    assert result["category"] == "Analysis"


def test_extract_json_object_invalid_returns_empty() -> None:
    result = _extract_json_object("not valid json at all")
    assert result == {}


def test_extract_json_object_non_dict_returns_empty() -> None:
    result = _extract_json_object("[1, 2, 3]")
    assert result == {}


def test_extract_json_object_partial_json_with_braces() -> None:
    raw = 'prefix {"tags": ["test"]} suffix'
    result = _extract_json_object(raw)
    assert result.get("tags") == ["test"]


# ── FavoriteService._generate_tags unit tests ─────────────────────────────────


def _make_tagger_mock(response_json: dict[str, Any]) -> MagicMock:
    mock = MagicMock()
    resp = MagicMock()
    resp.content = json.dumps(response_json)
    mock.ainvoke = AsyncMock(return_value=resp)
    return mock


@pytest.mark.asyncio
async def test_generate_tags_valid_response() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    tagger = _make_tagger_mock({"tags": ["python", "coding", "api"], "category": "Coding"})

    with patch("promptly.services.favorite_service.build_tagger", return_value=tagger):
        tags, category = await svc._generate_tags("Write Python code for API endpoints.")

    assert "python" in tags
    assert category == "Coding"


@pytest.mark.asyncio
async def test_generate_tags_trims_and_lowercases() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    tagger = _make_tagger_mock({"tags": ["  Writing  ", "BLOG"], "category": "Writing"})

    with patch("promptly.services.favorite_service.build_tagger", return_value=tagger):
        tags, category = await svc._generate_tags("Write a blog post.")

    assert "writing" in tags
    assert "blog" in tags


@pytest.mark.asyncio
async def test_generate_tags_caps_at_four() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    tagger = _make_tagger_mock({"tags": ["a", "b", "c", "d", "e", "f"], "category": "Other"})

    with patch("promptly.services.favorite_service.build_tagger", return_value=tagger):
        tags, _ = await svc._generate_tags("Some prompt.")

    assert len(tags) <= 4


@pytest.mark.asyncio
async def test_generate_tags_invalid_category_falls_back_to_other() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    tagger = _make_tagger_mock({"tags": [], "category": "UNKNOWN_CATEGORY"})

    with patch("promptly.services.favorite_service.build_tagger", return_value=tagger):
        _, category = await svc._generate_tags("Some prompt.")

    assert category == "Other"


@pytest.mark.asyncio
async def test_generate_tags_empty_tags_list() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    tagger = _make_tagger_mock({"tags": [], "category": "Analysis"})

    with patch("promptly.services.favorite_service.build_tagger", return_value=tagger):
        tags, category = await svc._generate_tags("Analyze the data.")

    assert tags == set()
    assert category == "Analysis"


@pytest.mark.asyncio
async def test_generate_tags_ignores_non_string_tags() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    tagger = _make_tagger_mock({"tags": [1, None, "valid"], "category": "Other"})

    with patch("promptly.services.favorite_service.build_tagger", return_value=tagger):
        tags, _ = await svc._generate_tags("Some prompt.")

    assert "valid" in tags
    assert len(tags) == 1


@pytest.mark.asyncio
async def test_generate_tags_fenced_json_response() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    mock = MagicMock()
    resp = MagicMock()
    resp.content = '```json\n{"tags": ["writing"], "category": "Writing"}\n```'
    mock.ainvoke = AsyncMock(return_value=resp)

    with patch("promptly.services.favorite_service.build_tagger", return_value=mock):
        tags, category = await svc._generate_tags("Write a blog post.")

    assert "writing" in tags
    assert category == "Writing"


@pytest.mark.asyncio
async def test_generate_tags_timeout_is_propagated() -> None:
    db = AsyncMock()
    svc = FavoriteService(db)
    mock = MagicMock()
    mock.ainvoke = AsyncMock(side_effect=asyncio.TimeoutError)

    with patch("promptly.services.favorite_service.build_tagger", return_value=mock):
        with pytest.raises((asyncio.TimeoutError, Exception)):
            await svc._generate_tags("Some prompt.")
