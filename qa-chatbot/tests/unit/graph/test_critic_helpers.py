"""Unit tests for critic node helper functions (pure logic, no LLM)."""

import json

import pytest

from promptly.graph.nodes.critic import _collect_quality_gaps, _parse_critique


def test_parse_critique_plain_json():
    raw = '{"ranking": ["A", "B"], "critiques": {}}'
    result = _parse_critique(raw)
    assert result["ranking"] == ["A", "B"]


def test_parse_critique_with_json_fence():
    raw = '```json\n{"ranking": ["C"]}\n```'
    result = _parse_critique(raw)
    assert result["ranking"] == ["C"]


def test_parse_critique_with_plain_fence():
    raw = '```\n{"ranking": ["B"]}\n```'
    result = _parse_critique(raw)
    assert result["ranking"] == ["B"]


def test_parse_critique_strips_whitespace():
    raw = '  {"ranking": ["A"]}  '
    result = _parse_critique(raw)
    assert result["ranking"] == ["A"]


def test_parse_critique_invalid_json_raises():
    with pytest.raises((json.JSONDecodeError, ValueError)):
        _parse_critique("not valid json at all")


def test_collect_quality_gaps_empty_list():
    result = _collect_quality_gaps([])
    assert result == []


def test_collect_quality_gaps_no_gaps():
    critics = [{"ranking": ["A"], "quality_gaps": []}]
    result = _collect_quality_gaps(critics)
    assert result == []


def test_collect_quality_gaps_unanimous():
    critics = [
        {"quality_gaps": ["output_format", "context_grounding"]},
        {"quality_gaps": ["output_format", "context_grounding"]},
        {"quality_gaps": ["output_format", "context_grounding"]},
        {"quality_gaps": ["output_format", "context_grounding"]},
    ]
    result = _collect_quality_gaps(critics)
    assert "output_format" in result
    assert "context_grounding" in result


def test_collect_quality_gaps_majority_threshold():
    # 4 critics, threshold = max(1, (4+1)//2) = 2
    critics = [
        {"quality_gaps": ["output_format"]},
        {"quality_gaps": ["output_format"]},
        {"quality_gaps": ["goal_clarity"]},
        {"quality_gaps": []},
    ]
    result = _collect_quality_gaps(critics)
    assert "output_format" in result
    assert "goal_clarity" not in result


def test_collect_quality_gaps_single_critic():
    # threshold = max(1, (1+1)//2) = 1
    critics = [{"quality_gaps": ["role_persona"]}]
    result = _collect_quality_gaps(critics)
    assert "role_persona" in result


def test_collect_quality_gaps_strips_whitespace():
    critics = [
        {"quality_gaps": ["  output_format  "]},
        {"quality_gaps": ["output_format"]},
    ]
    result = _collect_quality_gaps(critics)
    assert "output_format" in result


def test_collect_quality_gaps_ignores_non_string():
    critics = [{"quality_gaps": [123, None, "valid_gap"]}]
    result = _collect_quality_gaps(critics)
    assert "valid_gap" in result
    assert 123 not in result
