_USER = """\
You generate concise tag/category metadata for prompts that a user has saved as a favorite.

Return a SINGLE JSON object. No prose, no code fences, no commentary.

Schema:
{
  "tags": string[],     // 2-4 short, lowercase, hyphen-separated keywords describing the
                        // prompt's subject. No quotes, no emoji.
  "category": string    // Exactly one of: "Writing", "Coding", "Analysis", "Other"
}

Rules:
- Tags should describe the SUBJECT or USE CASE (e.g. "email", "cold-outreach",
  "summarization"), not the style.
- Prefer specific single words or short compounds. Examples: "email", "python", "research",
  "marketing".
- Never return more than 4 tags.
- If unsure about the category, return "Other".

Prompt to classify:
---
{{prompt}}
---

Respond with JSON only.\
"""


def favorite_auto_tag_messages(prompt: str) -> list[dict[str, str]]:
    return [
        {"role": "user", "content": _USER.replace("{{prompt}}", prompt)},
    ]
