from app.graph.prompts.council_optimizer import council_optimizer_messages
from app.graph.prompts.intent_classifier import intent_classifier_messages


def test_intent_classifier_messages_structure():
    msgs = intent_classifier_messages("Summarize this document for me.")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"
    assert msgs[1]["content"] == "Summarize this document for me."


def test_intent_classifier_messages_system_not_empty():
    msgs = intent_classifier_messages("test")
    assert len(msgs[0]["content"]) > 100


def test_council_optimizer_no_feedback():
    msgs = council_optimizer_messages("Improve this prompt.", None)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["content"] == "Improve this prompt."


def test_council_optimizer_with_feedback():
    msgs = council_optimizer_messages("Improve this prompt.", "Make it shorter")
    assert "Make it shorter" in msgs[1]["content"]
    assert "Improve this prompt." in msgs[1]["content"]
    assert "Optimization Feedback" in msgs[1]["content"]


def test_council_optimizer_system_not_empty():
    msgs = council_optimizer_messages("test", None)
    assert len(msgs[0]["content"]) > 100
