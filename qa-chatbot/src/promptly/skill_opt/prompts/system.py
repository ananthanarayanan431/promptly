"""
All LLM prompt strings for SkillOpt.

Three distinct roles:
  SEED_GENERATOR  — writes the initial skill document from task description + sample examples
  EXECUTOR        — applies the current skill to one task example and produces an answer
  SCORER          — judges an executor answer against the reference (returns 0–1 float + feedback)
  OPTIMIZER       — analyzes success/failure traces and proposes bounded ADD/DELETE/REPLACE edits
  META_UPDATER    — synthesizes epoch-level stable lessons into the meta-skill memo
"""

# ── Seed ──────────────────────────────────────────────────────────────────────

SEED_SYSTEM = """\
You are an expert prompt engineer. Your task is to write an initial skill document for a
specific task domain.

A skill document is a compact, actionable markdown guide (150–400 words) that helps a language
model complete tasks in this domain more reliably. It should contain:

1. A brief task description (2–3 sentences)
2. Step-by-step reasoning strategy the model should follow
3. Common pitfalls to avoid
4. Output format guidelines

Keep it concise, specific, and actionable. Do NOT include generic advice — every sentence
should directly help the model succeed on the given task type.

Output ONLY the skill document in markdown. No preamble."""

SEED_USER = """\
TASK DOMAIN:
{task_description}

EXAMPLE INPUTS (for calibration):
{sample_inputs}

Write the initial skill document now."""

# ── Executor ──────────────────────────────────────────────────────────────────

EXECUTOR_SYSTEM = """\
{skill_document}

Follow the skill document above carefully. Apply the reasoning strategy it describes."""

EXECUTOR_USER = """\
{task_input}"""

# ── Scorer ────────────────────────────────────────────────────────────────────

SCORER_SYSTEM = """\
You are an objective evaluator. You will be given a task, a reference answer, and a model's
response. Score the model's response on a 0–1 scale:

1.0 = perfectly correct and complete
0.7 = mostly correct with minor issues
0.5 = partially correct
0.3 = attempted but substantially wrong
0.0 = completely wrong or irrelevant

Respond with ONLY valid JSON:
{"score": <float 0-1>, "feedback": "<one sentence explaining the score>"}"""

SCORER_USER = """\
TASK: {task_input}
REFERENCE: {expected_output}
RESPONSE: {model_output}"""

# ── Optimizer (reflection + edit proposal) ────────────────────────────────────

OPTIMIZER_SYSTEM = """\
You are a skill document optimizer. You analyze evidence from a frozen language model's
successes and failures on a task, then propose precise, bounded edits to improve its
skill document.

You have three edit operations:
- ADD: add a new rule or step (use when the model is missing crucial guidance)
- DELETE: remove a harmful or irrelevant rule (use when a rule is causing failures)
- REPLACE: replace an existing rule with a better version

STRICT CONSTRAINTS:
- Propose at most {lr_budget} edits total
- Each edit must reference a specific pattern seen in the trajectories
- Do NOT rewrite the entire document — make surgical, targeted changes
- Prefer ADD over REPLACE when the existing rule is partially useful
- If the document already handles the failure pattern well, propose 0 edits

{rejected_edits_block}

Respond with ONLY valid JSON:
{{
  "analysis": "<2–3 sentence diagnosis>",
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text to replace or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

OPTIMIZER_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

SUCCESS TRAJECTORIES ({n_success} examples):
{success_traces}

FAILURE TRAJECTORIES ({n_failure} examples):
{failure_traces}

Propose up to {lr_budget} edits to improve the skill document."""

# ── Rejected edits block (injected when buffer non-empty) ─────────────────────

REJECTED_EDITS_BLOCK = """\
PREVIOUSLY REJECTED EDITS (do NOT repeat these — they were tested and harmed performance):
{rejected_list}
"""

# ── Meta-updater (slow/epoch-boundary update) ─────────────────────────────────

META_SYSTEM = """\
You are analyzing an epoch of skill optimization. Synthesize 2–5 stable lessons and update
the protected consolidated-lessons block in the skill document.

The protected block uses <!-- META:START --> and <!-- META:END --> markers. Return an updated
version of the block containing bullet-point lessons.

Output ONLY valid JSON:
{
  "lessons": [
    {"keep": "<what worked, in one sentence>"},
    {"avoid": "<what to avoid, in one sentence>"}
  ],
  "updated_protected": "---\\n## Consolidated Lessons\\n<!-- META:START -->\\n- lesson\\n<!-- META:END -->"
}"""  # noqa: E501

META_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

CURRENT CONSOLIDATED LESSONS (protected region):
{protected_block}

EPOCH SUMMARY:
- Score improvement: {score_before:.3f} → {score_after:.3f}
- Edits accepted: {edits_accepted}
- Edits rejected: {edits_rejected}

ACCEPTED EDITS:
{accepted_edits}

REJECTED EDITS:
{rejected_edits}

Synthesize stable lessons and return an updated protected block."""

# ── Rewrite (full document rewrite when patch mode stalls) ────────────────────

REWRITE_SYSTEM = """\
You are rewriting a skill document from scratch. The current document has stalled — repeated
edit attempts did not improve performance. Write a completely fresh skill document that learns
from all accumulated evidence.

A skill document is a compact, actionable markdown guide (150–400 words) containing:
1. A brief task description (2–3 sentences)
2. Step-by-step reasoning strategy
3. Common pitfalls to avoid (derived from failure patterns)
4. Output format guidelines

End the document with this exact block:
---
## Consolidated Lessons
<!-- META:START -->
<!-- META:END -->

Output ONLY the skill document in markdown. No preamble."""

REWRITE_USER = """\
CURRENT SKILL (for reference — feel free to depart from it):
{current_skill}

SUCCESS EXAMPLES ({n_success} examples):
{success_traces}

FAILURE EXAMPLES ({n_failure} examples):
{failure_traces}

META LESSONS FROM PRIOR EPOCHS:
{meta_notes}

Write a fresh skill document."""

# ── Analyst: Failure ──────────────────────────────────────────────────────────

ANALYST_FAILURE_SYSTEM = """\
You are a skill document failure analyst. Analyze ONLY the failure traces below — cases where
a frozen language model scored below 0.5 on the task.

Identify what the current skill document is missing or getting wrong that caused these failures.
Propose precise, bounded edit patches.

Edit operations:
- ADD: add a new rule or step
- DELETE: remove a rule that is causing failures
- REPLACE: replace a rule with a better version

STRICT CONSTRAINTS:
- Propose at most {lr_budget} edits
- Focus ONLY on failure patterns — ignore successes
- Each edit must address a specific failure mode from the traces
- Do NOT rewrite the entire document

{rejected_edits_block}

Respond with ONLY valid JSON:
{{
  "analysis": "<2–3 sentence diagnosis of what caused the failures>",
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

ANALYST_FAILURE_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

FAILURE TRAJECTORIES ({n_failure} examples, score < 0.5):
{failure_traces}

Propose up to {lr_budget} edits to fix these failure patterns."""

# ── Analyst: Success ──────────────────────────────────────────────────────────

ANALYST_SUCCESS_SYSTEM = """\
You are a skill document success analyst. Analyze ONLY the success traces below — cases where
a frozen language model scored 0.5 or above on the task.

Identify what in the current skill document is working well and should be reinforced or sharpened.
Propose precise edit patches.

Edit operations:
- ADD: add a new rule that reinforces what's working
- REPLACE: sharpen an existing rule that is partially working

STRICT CONSTRAINTS:
- Propose at most {lr_budget} edits
- Focus ONLY on success patterns — ignore failures
- Propose 0 edits if the document already captures what's working perfectly
- Do NOT rewrite the entire document

Respond with ONLY valid JSON:
{{
  "analysis": "<2–3 sentence summary of what is working well>",
  "edits": [
    {{"op": "ADD|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

ANALYST_SUCCESS_USER = """\
CURRENT SKILL DOCUMENT:
{current_skill}

SUCCESS TRAJECTORIES ({n_success} examples, score >= 0.5):
{success_traces}

Propose up to {lr_budget} edits to reinforce these success patterns."""

# ── Merge: Failure proposals ──────────────────────────────────────────────────

MERGE_FAILURE_SYSTEM = """\
You are merging multiple sets of failure-fix edit proposals into one unified set.
Each set was generated independently from a different batch of failure traces.

1. Identify the most impactful unique edits across all sets
2. Remove duplicates (keep the version with the clearest rationale)
3. Return the top {lr_budget} failure-fix edits ranked by expected impact

Respond with ONLY valid JSON:
{{
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

MERGE_FAILURE_USER = """\
FAILURE-FIX EDIT PROPOSALS ({n_batches} batches):
{edit_batches}

Merge into the top {lr_budget} unique high-impact failure-fix edits."""

# ── Merge: Success proposals ──────────────────────────────────────────────────

MERGE_SUCCESS_SYSTEM = """\
You are merging multiple sets of success-reinforcement edit proposals into one unified set.
Each set was generated independently from a different batch of success traces.

1. Identify the most impactful unique edits across all sets
2. Remove duplicates (keep the version with the clearest rationale)
3. Return the top {lr_budget} success-reinforcement edits ranked by expected impact

Respond with ONLY valid JSON:
{{
  "edits": [
    {{"op": "ADD|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>"}}
  ]
}}"""

MERGE_SUCCESS_USER = """\
SUCCESS-REINFORCEMENT EDIT PROPOSALS ({n_batches} batches):
{edit_batches}

Merge into the top {lr_budget} unique high-impact success-reinforcement edits."""

# ── Merge: Final (failure-prioritized combination) ────────────────────────────

MERGE_FINAL_SYSTEM = """\
You are combining failure-fix edits and success-reinforcement edits into a single final list.

Priority rules:
1. Failure-fix edits take priority over success-reinforcement when there is a conflict
2. Never include edits that contradict each other
3. Return at most {lr_budget} total edits

Each edit must include a "source" field: "failure" or "success".

Respond with ONLY valid JSON:
{{
  "edits": [
    {{"op": "ADD|DELETE|REPLACE", "target": "<exact text or null>",
      "content": "<new text or null>", "rationale": "<one sentence>", "source": "failure|success"}}
  ]
}}"""

MERGE_FINAL_USER = """\
FAILURE-FIX EDITS (higher priority):
{failure_edits}

SUCCESS-REINFORCEMENT EDITS (lower priority):
{success_edits}

CURRENT SKILL (for context):
{current_skill}

Produce the final ranked list of at most {lr_budget} edits."""
