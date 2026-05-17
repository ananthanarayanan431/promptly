"""Unit tests for quality_gate node helper functions (pure logic, no LLM)."""

import json

import pytest

from app.graph.nodes.quality_gate import _is_converged, _parse_gate_response


def test_parse_gate_response_plain_json():
    raw = '{"overall": "pass", "dimensions": {"goal_clarity": "strong"}}'
    result = _parse_gate_response(raw)
    assert result["overall"] == "pass"
    assert result["dimensions"]["goal_clarity"] == "strong"


def test_parse_gate_response_with_markdown_fence():
    raw = '```json\n{"overall": "fail"}\n```'
    result = _parse_gate_response(raw)
    assert result["overall"] == "fail"


def test_parse_gate_response_with_plain_code_fence():
    raw = '```\n{"overall": "pass"}\n```'
    result = _parse_gate_response(raw)
    assert result["overall"] == "pass"


def test_parse_gate_response_with_leading_whitespace():
    raw = '  {"overall": "pass"}  '
    result = _parse_gate_response(raw)
    assert result["overall"] == "pass"


def test_parse_gate_response_invalid_json_raises():
    with pytest.raises((json.JSONDecodeError, ValueError)):
        _parse_gate_response("not valid json")


def test_is_converged_none_previous():
    assert _is_converged("some text", None) is False


def test_is_converged_identical_text():
    text = "You are an expert. Answer concisely."
    assert _is_converged(text, text) is True


def test_is_converged_different_texts():
    a = "You are a helpful assistant with expertise in marketing."
    b = "Completely different content about programming languages."
    assert _is_converged(a, b) is False


def test_is_converged_near_identical_high_overlap():
    # 100 unique shared words + 1 word difference = 100/102 = 98% Jaccard overlap
    shared = " ".join(f"token{i}" for i in range(100))
    a = shared + " extra_a"
    b = shared + " extra_b"
    assert _is_converged(a, b) is True


def test_is_converged_whitespace_normalized():
    a = "word1   word2  word3"
    b = "word1 word2 word3"
    assert _is_converged(a, b) is True


def test_is_converged_empty_strings():
    assert _is_converged("", "") is True


def test_is_converged_one_empty():
    assert _is_converged("some text", "") is False
