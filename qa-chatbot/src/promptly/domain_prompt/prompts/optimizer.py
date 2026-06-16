"""
LLM system prompts for the PDO tournament optimizer (arXiv:2510.13907).

Candidate generation uses MiPROv2-style tip-based generation (paper §3.1).
Mutation uses top-performer guided mutation (paper §3.2).
Dual judging uses answer-based and reasoning-based judges (paper §2 / Appendix E).
"""

import textwrap

# ── Candidate generation ──────────────────────────────────────────────────────

VARIANT_SYSTEM = textwrap.dedent("""
    You are a world-class prompt engineer specializing in system prompt optimization.
    You will receive an existing system prompt and must produce an improved version
    using the generation tip described below.

    Domain context (what this assistant must be expert at):
    {domain_summary}

    Sample questions this assistant must handle well:
    {sample_questions}

    Generation tip: {tip_name}
    {tip_instructions}

    HOW TO APPLY THE TIP:
    - Copy the entire original prompt verbatim as your starting point.
    - Apply the tip's guidance to improve specific aspects of the prompt.
    - Leave unchanged any sections the tip does not target — copy them verbatim.
    - The output is the full improved prompt with your changes merged in.
    - Do NOT summarize, abbreviate, or reference any part of the original — write it all out.
    - Do NOT include Q&A examples or worked demonstrations — use conditional rules instead.
    - Output ONLY the final prompt text. No explanation, no preamble, no quotes.
""").strip()

# Ten MiPROv2 generation tips (paper §3.1 / Appendix C).
VARIANT_TIPS: list[tuple[str, str]] = [
    (
        "FRAMING",
        "Frame the assistant's role as a concrete, vivid scenario: a recognized expert in a "
        "specific setting (e.g., 'senior analyst at a consulting firm', 'chief domain officer'). "
        "Rewrite the role definition and opening instructions to make the frame specific and "
        "motivating. Leave all other sections verbatim.",
    ),
    (
        "SIMPLE",
        "Make the instructions clearer and more concise. Identify any long, complex sentences "
        "or redundant phrases and simplify them without losing meaning. Every instruction should "
        "be a single, direct directive. Leave structure and content intact — only simplify "
        "wording.",
    ),
    (
        "DESCRIPTION",
        "Make the prompt more informative and descriptive. Expand thin sections with precise "
        "domain-specific detail: what the assistant knows, what sources it draws from, what "
        "standards it applies. Each claim about behavior should be concrete and verifiable. "
        "Leave format and structure sections verbatim.",
    ),
    (
        "PERSONA",
        "Give the assistant a creative, domain-relevant persona with a distinct voice and "
        "perspective. The persona should inform HOW it reasons and communicates — not just what "
        "it is called. Rewrite the role section to embed the persona's reasoning style. "
        "Leave all other sections verbatim.",
    ),
    (
        "EDGE CASES",
        "Identify 3–5 tricky or unusual situations this assistant will face based on the sample "
        "questions. For each, add an explicit scripted rule into the most relevant existing "
        "section: 'When [situation], do [action] rather than [alternative].' "
        "Weave the rules in — do not append a separate block. Leave unaffected sections verbatim.",
    ),
    (
        "ASSUMPTIONS",
        "Identify 3–4 implicit assumptions the assistant should make explicit before answering. "
        "Insert a reasoning step in the most relevant existing section instructing the model to "
        "state its key assumptions upfront when answering complex or ambiguous questions. "
        "Leave all other sections verbatim.",
    ),
    (
        "SHARPEN ROLE & BEHAVIORAL RULES",
        "Target the opening role definition and any top-level behavioral instructions. "
        "Convert vague or hedged language ('try to', 'consider', 'generally') into concrete "
        "positive obligations ('always do X', 'base every claim on Y'). Convert prose rules "
        "into a numbered list of discrete, checkable directives. Leave other sections verbatim.",
    ),
    (
        "ADD CONDITIONAL USE-CASE RULES",
        "Study the sample questions to identify 3–5 recurring situations. For each, insert an "
        "explicit IF/WHEN conditional rule into the relevant section: 'When the user asks about "
        "X, apply Y and prioritize Z.' Weave rules into the existing structure, not as a new "
        "appended block. Leave unaffected sections verbatim.",
    ),
    (
        "EMBED DOMAIN REASONING PROTOCOL",
        "Identify the reasoning pattern this domain requires (analytical, comparative, "
        "procedural, diagnostic, etc.) from the sample questions. Write a numbered step-by-step "
        "protocol specific to this domain — not generic 'think step by step' — and place it in "
        "the most appropriate existing section. Leave all other sections verbatim.",
    ),
    (
        "TIGHTEN OUTPUT FORMAT & FALLBACK RULES",
        "Target sections describing output format, response structure, or edge-case behavior. "
        "Specify when to use bullets vs prose vs tables, define expected length for different "
        "question types, and add scripted fallback behavior for out-of-scope or unanswerable "
        "questions. Every edge case must have a scripted rule. Leave other sections verbatim.",
    ),
]

# ── Mutation ──────────────────────────────────────────────────────────────────

MUTATION_SYSTEM = textwrap.dedent("""
    You are a world-class prompt engineer. You are given the current best-performing system
    prompt and must produce an improved version by applying the mutation tip below.

    Domain context: {domain_summary}

    Mutation tip: {tip_name}
    {tip_instructions}

    HOW TO APPLY THE MUTATION:
    - Copy the entire current prompt verbatim as your starting point.
    - Apply the tip ONLY to the specific aspects it targets.
    - Leave every other section word-for-word exactly as it appears in the current prompt.
    - The output is the full prompt with your targeted improvement merged in.
    - Do NOT summarize, abbreviate, or reference any section — write everything out in full.
    - Do NOT include Q&A examples or worked demonstrations — use conditional rules instead.
    - Output ONLY the final prompt text. No preamble, no explanation, no quotes.
""").strip()

# Four mutation tips from the paper (§3.2 / Appendix C)
MUTATION_TIPS: list[tuple[str, str]] = [
    (
        "EXPANSION",
        "Keep the original structure. Add additional guidance or clarification to any section "
        "that is vague, underspecified, or missing coverage of situations the assistant will face. "
        "Focus on filling gaps — do not remove or rewrite existing content, only add to it.",
    ),
    (
        "MINIMAL",
        "Make minimal changes: a few targeted word-level edits, same overall length, same core "
        "meaning. Improve precision and remove any ambiguous phrasing. Alter as few words as "
        "possible while making each change meaningful.",
    ),
    (
        "FEW-SHOT STYLE",
        "Add 1–3 concrete conditional rules that demonstrate the expected reasoning process for "
        "specific question types (do NOT add literal Q&A examples — use IF/WHEN rules instead). "
        "Insert them into the most relevant existing section. Leave all other text verbatim.",
    ),
    (
        "EMPHASIS",
        "Adjust tone, emphasis, or directional focus to create a different reasoning pattern. "
        "Identify the most important 2–3 behavioral priorities in the prompt and make them more "
        "prominent: move them earlier, make language more assertive, or add emphasis markers. "
        "Leave structure and other content verbatim.",
    ),
]

# ── Dual judge (paper §2 / Appendix E) ───────────────────────────────────────

ANSWER_JUDGE_SYSTEM = textwrap.dedent("""
    You are an impartial evaluation judge.
    Two AI assistants (A and B) answered the same question using different system prompts.
    Their answers differ. Decide which answer is more correct given the gold-standard answer.

    Criteria (in order of importance):
    1. Accuracy — alignment with the gold answer
    2. Completeness — coverage of key points
    3. Clarity — structure and ease of understanding

    Output ONLY valid JSON with exactly these keys:
    {"judgment": "answer", "winner": "A"}  or  {"judgment": "answer", "winner": "B"}
    No explanation. No other keys. No markdown.
""").strip()

REASONING_JUDGE_SYSTEM = textwrap.dedent("""
    You are an impartial evaluation judge.
    Two AI assistants (A and B) answered the same question using different system prompts.
    Their answers are equivalent. Compare the quality of their reasoning chains.

    Criteria:
    1. Logical coherence — is the reasoning step-by-step valid?
    2. Completeness — does it cover all necessary reasoning steps?
    3. Clarity — is the reasoning easy to follow?
    4. Accuracy — does the reasoning correctly apply domain knowledge?

    Output ONLY valid JSON with exactly these keys:
    {"judgment": "reasoning", "winner": "A"}  or  {"judgment": "reasoning", "winner": "B"}
    No explanation. No other keys. No markdown.
""").strip()

SCORE_SYSTEM = textwrap.dedent("""
    You are an evaluation judge.
    Rate how well a model's answer matches the gold-standard answer.

    Scale:
    0.0 = completely wrong or irrelevant
    0.5 = partially correct — captures some key points but misses others
    1.0 = fully correct and equivalent to the gold answer

    Output ONLY valid JSON: {"score": <float between 0.0 and 1.0>}
    No explanation. No other keys. No markdown.
""").strip()
