"""Tests for subject_classifier prompt builder and subject_analysis_block formatter."""

from promptly.graph.prompts.subject_classifier import (
    subject_analysis_block,
    subject_classifier_messages,
)

# ---------------------------------------------------------------------------
# subject_classifier_messages
# ---------------------------------------------------------------------------


def test_messages_structure_no_feedback():
    msgs = subject_classifier_messages("You are a helpful assistant.")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"
    assert msgs[1]["content"] == "You are a helpful assistant."


def test_messages_system_contains_json_instruction():
    msgs = subject_classifier_messages("some prompt")
    system = msgs[0]["content"]
    assert '"about"' in system
    assert '"suggestions"' in system
    assert "JSON" in system


def test_messages_system_contains_equal_count_rule():
    msgs = subject_classifier_messages("some prompt")
    assert "SAME number" in msgs[0]["content"]


def test_messages_without_feedback_no_feedback_label():
    msgs = subject_classifier_messages("some prompt")
    assert "feedback" not in msgs[1]["content"].lower()


def test_messages_with_feedback_injects_feedback():
    msgs = subject_classifier_messages("You are a summarizer.", "Make it more concise")
    user = msgs[1]["content"]
    assert "You are a summarizer." in user
    assert "Make it more concise" in user


def test_messages_with_feedback_has_feedback_label():
    msgs = subject_classifier_messages("prompt text", "add JSON output")
    user = msgs[1]["content"]
    assert "feedback" in user.lower() or "Feedback" in user


def test_messages_with_feedback_has_folding_rule_in_system():
    msgs = subject_classifier_messages("some prompt", "Make it shorter")
    system = msgs[0]["content"]
    assert "FIRST" in system or "first" in system


# ---------------------------------------------------------------------------
# subject_analysis_block
# ---------------------------------------------------------------------------


def test_block_returns_none_for_none_inputs():
    assert subject_analysis_block(None, None) is None


def test_block_returns_none_for_empty_lists():
    assert subject_analysis_block([], []) is None


def test_block_returns_none_when_about_empty():
    assert subject_analysis_block([], ["suggestion"]) is None


def test_block_returns_none_when_suggestions_empty():
    assert subject_analysis_block(["about"], []) is None


def test_block_contains_about_points():
    result = subject_analysis_block(["It handles data extraction."], ["Add output format."])
    assert result is not None
    assert "It handles data extraction." in result


def test_block_contains_suggestion_points():
    result = subject_analysis_block(["Data extraction prompt."], ["Add a JSON schema."])
    assert result is not None
    assert "Add a JSON schema." in result


def test_block_contains_advisory_label():
    result = subject_analysis_block(["About point."], ["Suggestion point."])
    assert result is not None
    assert "advisory" in result.lower() or "ADVISORY" in result


def test_block_uses_bullet_format():
    result = subject_analysis_block(["Point A.", "Point B."], ["Sug A.", "Sug B."])
    assert result is not None
    assert "- Point A." in result
    assert "- Point B." in result
    assert "- Sug A." in result
    assert "- Sug B." in result
