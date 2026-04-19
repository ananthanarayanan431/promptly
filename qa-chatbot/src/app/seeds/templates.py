"""Seed curated prompt templates. Called once on startup if the table is empty."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.template import Template
from app.repositories.template_repo import TemplateRepository

SEED_TEMPLATES: list[dict[str, str]] = [
    # ── Coding ───────────────────────────────────────────────────────────────
    {
        "category": "coding",
        "name": "Code Review",
        "description": "Review a function or module for bugs, style, and performance.",
        "content": (
            "Review the following code for correctness, readability, and performance. "
            "Identify any bugs, anti-patterns, or missed edge cases. "
            "Suggest concrete improvements with brief explanations.\n"
            "Code:\n{{code}}"
        ),
    },
    {
        "category": "coding",
        "name": "Explain Code",
        "description": "Explain what a block of code does in plain English.",
        "content": (
            "Explain what the following code does in plain English. "
            "Assume the reader understands basic programming but may not know this language. "
            "Cover: what it does, how it works, and any non-obvious behaviour.\n"
            "Code:\n{{code}}"
        ),
    },
    {
        "category": "coding",
        "name": "Write Unit Tests",
        "description": "Generate unit tests for a function or class.",
        "content": (
            "Write thorough unit tests for the following function. "
            "Cover the happy path, edge cases, and failure modes. "
            "Use the testing framework already present in the codebase.\n"
            "Function:\n{{function}}"
        ),
    },
    {
        "category": "coding",
        "name": "Debug Error",
        "description": "Diagnose an error message and suggest fixes.",
        "content": (
            "I'm seeing the following error. Explain the root cause and provide "
            "the most likely fix. If there are multiple possible causes, list them "
            "in order of likelihood.\n"
            "Error:\n{{error}}\n"
            "Relevant code:\n{{code}}"
        ),
    },
    # ── Writing ──────────────────────────────────────────────────────────────
    {
        "category": "writing",
        "name": "Blog Post",
        "description": "Draft a structured blog post on a topic.",
        "content": (
            "Write an 800-word blog post about {{topic}}. "
            "Open with a specific scene or concrete example, not a definition. "
            "Use short paragraphs (3–4 sentences max). "
            "End with one clear takeaway the reader can act on today."
        ),
    },
    {
        "category": "writing",
        "name": "Summarise Document",
        "description": "Condense a long document into key points.",
        "content": (
            "Summarise the following document in 5 bullet points. "
            "Each bullet should be one sentence. "
            "Focus on decisions, findings, and action items — skip background context.\n"
            "Document:\n{{document}}"
        ),
    },
    {
        "category": "writing",
        "name": "Rewrite for Clarity",
        "description": "Rewrite dense or jargon-heavy text in plain English.",
        "content": (
            "Rewrite the following text so it is clear and direct. "
            "Replace jargon with plain words. Break long sentences. "
            "Do not add new information — only clarify what is already there.\n"
            "Text:\n{{text}}"
        ),
    },
    # ── Customer Support ─────────────────────────────────────────────────────
    {
        "category": "customer-support",
        "name": "Support Reply",
        "description": "Draft a professional, empathetic customer support response.",
        "content": (
            "You are a support agent for {{company}}. "
            "Reply to the following customer message. "
            "Acknowledge the issue, explain the cause in one sentence, "
            "and give the resolution or next steps. "
            "Tone: professional, warm, concise (under 120 words).\n"
            "Customer message:\n{{message}}"
        ),
    },
    {
        "category": "customer-support",
        "name": "Escalation Summary",
        "description": "Summarise a support ticket for escalation to engineering.",
        "content": (
            "Summarise the following support ticket for the engineering team. "
            "Include: issue description, steps to reproduce, customer impact, "
            "and any workarounds already tried. "
            "Be precise — use the exact error messages and version numbers mentioned.\n"
            "Ticket:\n{{ticket}}"
        ),
    },
    {
        "category": "customer-support",
        "name": "FAQ Answer",
        "description": "Answer a frequently asked question concisely.",
        "content": (
            "Answer the following customer question about {{product}}. "
            "Keep the answer under 80 words. "
            "If the answer requires steps, use a numbered list. "
            "Do not refer to documentation — answer directly.\n"
            "Question:\n{{question}}"
        ),
    },
    # ── Analysis ─────────────────────────────────────────────────────────────
    {
        "category": "analysis",
        "name": "Compare Options",
        "description": "Compare two or more options with a structured pros/cons analysis.",
        "content": (
            "Compare the following options on the dimensions that matter most for this decision. "
            "Present a clear recommendation at the end with one-sentence justification. "
            "Format as a table if there are more than 3 dimensions.\n"
            "Options:\n{{options}}\n"
            "Context:\n{{context}}"
        ),
    },
    {
        "category": "analysis",
        "name": "Root Cause Analysis",
        "description": "Systematically identify the root cause of a problem.",
        "content": (
            "Perform a root cause analysis of the following problem using the 5-Whys method. "
            "State each 'why' and its answer. "
            "End with a concrete preventive action.\n"
            "Problem:\n{{problem}}"
        ),
    },
]


async def seed_templates(db: AsyncSession) -> None:
    """Insert seed templates if the table is empty."""
    repo = TemplateRepository(db)
    count = await repo.count_active()
    if count > 0:
        return

    for t in SEED_TEMPLATES:
        db.add(
            Template(
                id=uuid.uuid4(),
                category=t["category"],
                name=t["name"],
                description=t["description"],
                content=t["content"],
                is_active=True,
            )
        )
    await db.commit()
