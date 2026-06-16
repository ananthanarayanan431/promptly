"""Unit tests for synthesize node helper functions (pure logic, no LLM)."""

from promptly.graph.nodes.synthesize import _build_critiques_block, _build_proposals_block


def test_build_proposals_block_single():
    responses = [{"optimized_prompt": "Improved prompt A"}]
    result = _build_proposals_block(responses)
    assert "[Proposal A]:" in result
    assert "Improved prompt A" in result


def test_build_proposals_block_four():
    responses = [{"optimized_prompt": f"Proposal {i}"} for i in range(4)]
    result = _build_proposals_block(responses)
    for label in ["A", "B", "C", "D"]:
        assert f"[Proposal {label}]:" in result


def test_build_proposals_block_caps_at_four():
    responses = [{"optimized_prompt": f"Proposal {i}"} for i in range(6)]
    result = _build_proposals_block(responses)
    assert "[Proposal E]:" not in result
    assert "[Proposal F]:" not in result


def test_build_critiques_block_empty():
    result = _build_critiques_block([])
    assert "No critic reviews available" in result


def test_build_critiques_block_with_critics():
    critics = [
        {
            "ranking": ["A", "B", "C"],
            "ranking_rationale": "A is best",
            "critiques": {
                "A": {
                    "dimension_scores": {"goal_clarity": "strong", "output_format": "weak"},
                    "primary_weakness": "Lacks format spec",
                    "failure_mode": "Ambiguous output",
                }
            },
        }
    ]
    result = _build_critiques_block(critics)
    assert "[Critic A]" in result
    assert "Ranking:" in result
    assert "Lacks format spec" in result


def test_build_critiques_block_flat_critique():
    """Handles critic entries where critiques value is a string, not dict."""
    critics = [
        {
            "ranking": ["A"],
            "ranking_rationale": "Only one proposal",
            "critiques": {"A": "Good overall"},
        }
    ]
    result = _build_critiques_block(critics)
    assert "Good overall" in result


def test_build_critiques_block_caps_at_four():
    critics = [
        {
            "ranking": [],
            "ranking_rationale": "",
            "critiques": {},
        }
        for _ in range(6)
    ]
    result = _build_critiques_block(critics)
    assert "[Critic E]" not in result


def test_build_critiques_block_all_strong_dimensions():
    critics = [
        {
            "ranking": ["A"],
            "ranking_rationale": "A wins",
            "critiques": {
                "A": {
                    "dimension_scores": {"goal_clarity": "strong", "output_format": "strong"},
                    "primary_weakness": "",
                    "failure_mode": "",
                }
            },
        }
    ]
    result = _build_critiques_block(critics)
    assert "all dimensions strong" in result
