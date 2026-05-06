from app.graph.prompts.council_optimizer import council_optimizer_messages
from app.graph.prompts.critic import critic_messages
from app.graph.prompts.favorite_auto_tag import favorite_auto_tag_messages
from app.graph.prompts.intent_classifier import intent_classifier_messages
from app.graph.prompts.prompt_advisory import prompt_advisory_messages
from app.graph.prompts.prompt_health_score import prompt_health_score_messages
from app.graph.prompts.synthesize_best import synthesize_messages


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


def test_critic_messages_structure():
    msgs = critic_messages(
        raw_prompt="Summarize this.",
        proposals=[("A", "Proposal A text"), ("B", "Proposal B text"), ("C", "Proposal C text")],
    )
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"


def test_critic_messages_proposals_present():
    msgs = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB"), ("C", "CCC")],
    )
    user = msgs[1]["content"]
    assert "Original" in user
    assert "AAA" in user
    assert "BBB" in user
    assert "CCC" in user
    assert "Proposal A:" in user
    assert "Proposal B:" in user
    assert "Proposal C:" in user


def test_critic_messages_four_proposals():
    """All 4 proposals appear with correct labels when reviewer skips their own."""
    msgs = critic_messages(
        raw_prompt="Explain this.",
        proposals=[("A", "AAA"), ("B", "BBB"), ("C", "CCC"), ("D", "DDD")],
    )
    user = msgs[1]["content"]
    system = msgs[0]["content"]
    assert "Proposal A:" in user
    assert "Proposal B:" in user
    assert "Proposal C:" in user
    assert "Proposal D:" in user
    # Schema should contain all 4 labels
    assert '"Proposal A"' in system
    assert '"Proposal B"' in system
    assert '"Proposal C"' in system
    assert '"Proposal D"' in system
    # System prompt should reference count = 4
    assert "4" in system


def test_synthesize_messages_no_feedback():
    msgs = synthesize_messages(
        raw_prompt="Original",
        proposals_block="Proposal 1\n\nProposal 2",
        critiques_block="Critique 1\n\nCritique 2",
        feedback=None,
    )
    assert len(msgs) == 2
    user = msgs[1]["content"]
    assert "Original" in user
    assert "Proposal 1" in user
    assert "Critique 1" in user
    assert "Feedback Directive" not in user


def test_synthesize_messages_with_feedback():
    msgs = synthesize_messages(
        raw_prompt="Original",
        proposals_block="props",
        critiques_block="crits",
        feedback="Keep it under 50 words",
    )
    user = msgs[1]["content"]
    assert "Keep it under 50 words" in user
    assert "Feedback Directive" in user


def test_prompt_health_score_messages():
    msgs = prompt_health_score_messages("You are a helpful assistant.")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert "<prompt_to_evaluate>" in msgs[1]["content"]
    assert "You are a helpful assistant." in msgs[1]["content"]
    assert "</prompt_to_evaluate>" in msgs[1]["content"]


def test_prompt_advisory_messages():
    msgs = prompt_advisory_messages("You are a helpful assistant.")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert "<prompt_to_evaluate>" in msgs[1]["content"]
    assert "You are a helpful assistant." in msgs[1]["content"]
    assert "</prompt_to_evaluate>" in msgs[1]["content"]


def test_favorite_auto_tag_messages_user_only():
    msgs = favorite_auto_tag_messages("You are a helpful assistant.")
    assert len(msgs) == 1
    assert msgs[0]["role"] == "user"
    assert "You are a helpful assistant." in msgs[0]["content"]


def test_all_builders_importable_from_package():
    from app.graph.prompts import (  # noqa: PLC0415
        council_optimizer_messages,
        critic_messages,
        favorite_auto_tag_messages,
        intent_classifier_messages,
        prompt_advisory_messages,
        prompt_health_score_messages,
        synthesize_messages,
    )

    assert callable(intent_classifier_messages)
    assert callable(council_optimizer_messages)
    assert callable(critic_messages)
    assert callable(synthesize_messages)
    assert callable(prompt_health_score_messages)
    assert callable(prompt_advisory_messages)
    assert callable(favorite_auto_tag_messages)
