"""
Extracts text from a PDF and uses an LLM to generate Q&A pairs
in the prompt-ops dataset format (one JSON object per line).
"""

from __future__ import annotations

import io
import json
import logging
import textwrap

from langchain_openai import ChatOpenAI
from pypdf import PdfReader

_log = logging.getLogger(__name__)

_QA_SYSTEM = textwrap.dedent("""
    You are a dataset generation assistant.
    Given a text passage, generate question-answer pairs that cover the key facts,
    concepts, and details in the passage.

    Rules:
    - Each question must be answerable solely from the provided passage.
    - Answers should be concise (1-3 sentences).
    - Output ONLY a JSON array of objects with keys "question" and "answer".
    - Generate between 5 and 10 pairs per passage.
    - Do not add any explanation, preamble, or trailing text.

    Example output:
    [
      {"question": "What is Vitamin C?", "answer": "Vitamin C is a water-soluble antioxidant."},
      {"question": "What foods are high in Vitamin C?", "answer": "Citrus fruits and bell peppers."}
    ]
""").strip()


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:
        raise ValueError("Invalid or unreadable PDF") from exc
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text.strip())
    return "\n\n".join(pages)


def _chunk_text(text: str, max_chars: int = 2000) -> list[str]:
    """Split text into overlapping chunks that fit within token budgets."""
    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for word in words:
        current.append(word)
        current_len += len(word) + 1
        if current_len >= max_chars:
            chunks.append(" ".join(current))
            overlap = max(1, len(current) // 10)
            current = current[-overlap:]
            current_len = sum(len(w) + 1 for w in current)
    if current:
        chunks.append(" ".join(current))
    return chunks


async def generate_qa_pairs(text: str, api_key: str) -> list[dict[str, str]]:
    """Generate Q&A pairs from extracted PDF text using an LLM."""
    llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.3,
        max_tokens=2048,
    )

    chunks = _chunk_text(text, max_chars=2000)
    all_pairs: list[dict[str, str]] = []

    if len(chunks) > 15:
        _log.warning("PDF produced %d chunks; processing first 15 only", len(chunks))
    for chunk in chunks[:15]:  # cap at 15 chunks to control cost
        try:
            response = await llm.ainvoke(
                [
                    {"role": "system", "content": _QA_SYSTEM},
                    {
                        "role": "user",
                        "content": f"Generate Q&A pairs from this passage:\n\n{chunk}",
                    },
                ]
            )
            raw = str(response.content).strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            pairs = json.loads(raw)
            if isinstance(pairs, list):
                for p in pairs:
                    if isinstance(p, dict) and "question" in p and "answer" in p:
                        all_pairs.append(
                            {
                                "question": str(p["question"]).strip(),
                                "answer": str(p["answer"]).strip(),
                            }
                        )
        except Exception as _exc:  # noqa: BLE001, S112
            _log.warning("Q&A generation failed for chunk: %s", _exc)
            continue

    return all_pairs


def pairs_to_jsonl(pairs: list[dict[str, str]]) -> str:
    """Convert Q&A pairs to JSONL format (one JSON object per line)."""
    return "\n".join(json.dumps(p, ensure_ascii=False) for p in pairs)
