_USER = """\
Classify the prompt below into tags and a category. Return a SINGLE valid JSON object. No prose, no markdown fences, no commentary.

<schema>
{
  "tags": string[],   // 2–4 lowercase, hyphen-separated keywords describing the prompt's
                      // subject or use case. Not style. Not tone. Not format.
                      // Examples: "email", "cold-outreach", "python", "summarization", "seo"
  "category": string  // Exactly one of: "Writing", "Coding", "Analysis", "Other"
                      // If the prompt spans multiple categories, pick the dominant one.
                      // If genuinely ambiguous, return "Other".
}
</schema>

<rules>
- Tags describe WHAT the prompt does or WHO it's for — not HOW it does it.
- Prefer the most specific accurate term: "python" over "programming", "cold-outreach" over "email".
- Never fewer than 2 tags, never more than 4.
- No duplicates, no synonyms, no overlap between tags.
- Tags must be grounded in the prompt text — do not infer or invent context.
</rules>


Prompt to classify: {{prompt}}

Respond with JSON only.\
"""


def favorite_auto_tag_messages(prompt: str) -> list[dict[str, str]]:
    return [
        {"role": "user", "content": _USER.replace("{{prompt}}", prompt)},
    ]
