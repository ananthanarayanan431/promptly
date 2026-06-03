"""Prompt builder and block formatter for the subject_classifier LangGraph node."""

_SYSTEM = """\
You are a prompt analysis expert. Analyze the AI prompt you receive and return a JSON object
with exactly two sections: what the prompt is about, and how it can be enhanced.

<rules>
1. Both sections MUST have the SAME number of points.
2. Each section has BETWEEN 1 and 4 points — pick the count that fits the prompt complexity.
   Do not pad to reach 4. Do not exceed 4.
3. Each point is ONE short, specific sentence. No vague generalities. No padding.
4. Write for an expert who will use your analysis to optimize the prompt.
</rules>

<feedback_rule>
If user feedback is provided below the prompt, it MUST become the FIRST point in
"suggestions", rephrased as a specific enhancement directive. Fill remaining suggestion
points (to match the "about" count) with other genuine improvement opportunities.
If feedback alone fills the needed count, do not add more suggestions.
</feedback_rule>

<output_format>
Return ONLY valid JSON. No preamble, no markdown fences, no trailing text.
The first character of your output must be "{".

{
  "about": ["<what this prompt is about / its purpose — one sentence>", "..."],
  "suggestions": ["<specific, actionable enhancement — one sentence>", "..."]
}
</output_format>
"""

_USER = "{{raw_prompt}}"
_USER_WITH_FEEDBACK = "{{raw_prompt}}\n\n---\nUser feedback: {{feedback}}"


def subject_classifier_messages(
    raw_prompt: str, feedback: str | None = None
) -> list[dict[str, str]]:
    """Build subject classifier messages.

    On feedback turns, the feedback is appended so the model folds it
    into the first suggestion point (per the feedback_rule in the system prompt).
    """
    if feedback:
        user = _USER_WITH_FEEDBACK.replace("{{raw_prompt}}", raw_prompt).replace(
            "{{feedback}}", feedback
        )
    else:
        user = _USER.replace("{{raw_prompt}}", raw_prompt)
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


def subject_analysis_block(
    about: list[str] | None,
    suggestions: list[str] | None,
) -> str | None:
    """Format the analysis as an advisory context block for downstream prompts.

    Returns None when there is no analysis to inject, so callers can skip cleanly.
    """
    if not about or not suggestions:
        return None
    about_lines = "\n".join(f"- {p}" for p in about)
    suggestion_lines = "\n".join(f"- {p}" for p in suggestions)
    return (
        "PROMPT ANALYSIS (advisory context — consider these insights, but user feedback\n"
        "and quality gaps remain the overriding directives):\n"
        f"What this prompt is about:\n{about_lines}\n"
        f"Suggested enhancements to consider:\n{suggestion_lines}"
    )
