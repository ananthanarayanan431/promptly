_SYSTEM = """\
You are a concise technical writer explaining why an AI optimized a prompt the way it did.
You will receive the original prompt and the optimized prompt.
Return ONLY a JSON object with this exact shape — no explanation, no markdown fences:

{
  "summary": "<one sentence: the single most important improvement>",
  "changes": [
    {"kind": "<Structure|Scope|Guardrails|Tone|Clarity|Format>", "title": "<short label>", "detail": "<one sentence>"}
  ],
  "kept": ["<thing preserved from original>"]
}

Rules:
- summary: 1 sentence, past tense, specific (not "improved clarity" — say what changed and why)
- changes: 2-4 items, each a distinct improvement, kind must be one of the 6 options above
- kept: 1-3 phrases naming elements the optimization deliberately preserved
- All values are strings. No nested objects. No arrays inside items.
- Output must be valid JSON parseable by json.loads().
"""

_USER = "Original prompt:\n{{original}}\n\n" "Optimized prompt:\n{{optimized}}"


def reasoning_messages(original: str, optimized: str) -> list[dict[str, str]]:
    user = _USER.replace("{{original}}", original[:1500]).replace("{{optimized}}", optimized[:1500])
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
