from promptly.graph.prompts.council_optimizer import council_optimizer_messages
from promptly.graph.prompts.critic import critic_messages
from promptly.graph.prompts.favorite_auto_tag import favorite_auto_tag_messages
from promptly.graph.prompts.intent_classifier import intent_classifier_messages
from promptly.graph.prompts.prompt_advisory import prompt_advisory_messages
from promptly.graph.prompts.prompt_health_score import prompt_health_score_messages
from promptly.graph.prompts.subject_classifier import subject_analysis_block
from promptly.graph.prompts.synthesize_best import synthesize_messages


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
    from promptly.graph.prompts import (  # noqa: PLC0415
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


def test_council_optimizer_with_subject_block():
    block = subject_analysis_block(["Data extraction prompt."], ["Add JSON schema."])
    msgs = council_optimizer_messages("My prompt.", None, subject_block=block)
    assert block is not None
    assert block in msgs[1]["content"]


def test_council_optimizer_subject_block_before_feedback():
    block = subject_analysis_block(["About."], ["Suggestion."])
    msgs = council_optimizer_messages("My prompt.", "Make shorter", subject_block=block)
    user = msgs[1]["content"]
    assert block is not None
    assert user.index(block) < user.index("Make shorter")


def test_council_optimizer_without_subject_block_unchanged():
    msgs_with = council_optimizer_messages("My prompt.", None, subject_block=None)
    msgs_without = council_optimizer_messages("My prompt.", None)
    assert msgs_with[1]["content"] == msgs_without[1]["content"]


def test_critic_messages_with_subject_block():
    block = subject_analysis_block(["A data extraction prompt."], ["Specify output format."])
    msgs = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB"), ("C", "CCC")],
        subject_block=block,
    )
    assert block is not None
    assert block in msgs[1]["content"]


def test_critic_messages_without_subject_block_unchanged():
    msgs_with = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB")],
        subject_block=None,
    )
    msgs_without = critic_messages(
        raw_prompt="Original",
        proposals=[("A", "AAA"), ("B", "BBB")],
    )
    assert msgs_with[1]["content"] == msgs_without[1]["content"]


def test_synthesize_messages_with_subject_block():
    from promptly.graph.prompts.synthesize_best import synthesize_messages

    block = subject_analysis_block(["A code review prompt."], ["Add severity levels."])
    msgs = synthesize_messages(
        raw_prompt="Review my code.",
        proposals_block="[Proposal A]:\nProposal text",
        critiques_block="[Critic A]\nRanking: A\nRationale: Good.",
        feedback=None,
        subject_block=block,
    )
    assert block is not None
    assert block in msgs[1]["content"]


def test_synthesize_messages_subject_block_before_feedback():
    from promptly.graph.prompts.synthesize_best import synthesize_messages

    block = subject_analysis_block(["About."], ["Suggestion."])
    msgs = synthesize_messages(
        raw_prompt="Review my code.",
        proposals_block="[Proposal A]:\ntext",
        critiques_block="[Critic A]\nRanking: A\nRationale: ok.",
        feedback="Keep it under 50 words",
        subject_block=block,
    )
    user = msgs[1]["content"]
    assert block is not None
    assert user.index(block) < user.index("Keep it under 50 words")
