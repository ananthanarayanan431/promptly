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
