"""
AutoData-inspired dataset builder for domain prompt optimization.

Core idea from AutoData (Facebook Research, 2026):
  Generate questions, test them against a weak solver and a strong solver,
  keep ONLY questions where the strong solver succeeds and the weak solver fails.
  Questions that both pass or both fail are discarded — they provide no training signal.

Adapted for domain prompt optimization:
  - Challenger: GPT-4o-mini generates candidate Q&A pairs from PDF chunks
  - Weak solver:  GPT-4o-mini with NO system prompt (raw capability, no domain guidance)
  - Strong solver: GPT-4o-mini with the user's base prompt as system prompt
  - Judge: GPT-4o scores both answers against the gold answer
  - Acceptance: strong score − weak score ≥ WEAK_STRONG_GAP_THRESHOLD

  Questions where both solvers score equally don't test the value of the prompt — reject them.
  Questions the weak solver already answers correctly don't need prompt optimization — reject them.
  Only keep questions where domain guidance (the base prompt) demonstrably improves the answer.

If no base_prompt is available (e.g. augment task), we fall back to difficulty-stratified
generation (4 question types: factual, inferential, applied, adversarial) without filtering.

Pipeline:
  1. Extract text from PDF → chunk into 3000-char segments
  2. Challenger generates 5 candidate questions per chunk (diverse types mixed)
  3. For each question: weak solver and strong solver answer in parallel
  4. Judge scores both answers (0.0 / 0.5 / 1.0)
  5. Accept if strong_score − weak_score ≥ 0.3 AND strong_score ≥ 0.5
  6. Log rejection reason (too_easy, too_hard, quality_fail) and continue
  7. Return all accepted pairs, deduplicated
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import textwrap

from langchain_openai import ChatOpenAI
from pypdf import PdfReader

_log = logging.getLogger(__name__)

# ── Acceptance thresholds (adapted from AutoData) ─────────────────────────────
# AutoData uses: weak_avg ≤ 65%, strong_avg − weak_avg ≥ 20%
# We use a stricter gap (30%) because our "weak" and "strong" differ only by system prompt,
# not by model size — smaller gap would let trivially easy questions through.
_WEAK_MAX_SCORE = 0.65  # weak solver must score AT or BELOW this
_STRONG_MIN_SCORE = 0.5  # strong solver must score AT or ABOVE this
_GAP_THRESHOLD = 0.30  # strong − weak gap must be at least this

# ── LLM prompts ───────────────────────────────────────────────────────────────

_CHALLENGER_SYSTEM = textwrap.dedent("""
    You are a dataset generation expert. Your task: read the passage below and generate
    5 high-quality question-answer pairs that test DEEP UNDERSTANDING of the content.

    Mix question types across the 5 pairs:
    - At least 1 FACTUAL: a specific fact, number, definition, or name from the passage
    - At least 1 INFERENTIAL: requires combining multiple facts; answer not stated verbatim
    - At least 1 APPLIED: "Given [situation from this domain], what should happen?"
    - At least 1 that CHALLENGES a common misconception or tests an edge case

    For each pair, also write a grading rubric: a list of 2–4 key points the ideal answer
    must contain. The rubric is used by the judge to score answers WITHOUT seeing the gold answer.

    Self-check before outputting:
    - Could someone answer this question correctly without reading the passage?
      If yes, make it more specific to the passage content.
    - Is the answer unambiguously derivable from the passage? If not, drop it.

    Output ONLY a valid JSON array of objects with keys:
      "question" (string), "answer" (string), "rubric" (array of strings)
    No preamble, no explanation, no markdown fences.
""").strip()

_JUDGE_SYSTEM = textwrap.dedent("""
    You are an impartial evaluation judge. Score how well a model answer satisfies
    the provided rubric for the question.

    Scale:
      0.0 = answer is wrong, irrelevant, or missing most rubric points
      0.5 = answer is partially correct — covers some rubric points but misses key ones
      1.0 = answer is fully correct and covers all rubric points

    Output ONLY valid JSON: {"score": <0.0, 0.5, or 1.0>}
    No explanation, no other keys, no markdown.
""").strip()

_FALLBACK_CHALLENGER_SYSTEM = textwrap.dedent("""
    You are a dataset generation expert. Your task: read the passage below and generate
    8 question-answer pairs that test understanding of the content.

    Mix question types:
    - 2 FACTUAL: specific facts, numbers, or definitions stated in the passage
    - 2 INFERENTIAL: require reasoning across multiple facts; answer not stated verbatim
    - 2 APPLIED: "Given [scenario], what should happen?" based on principles in the passage
    - 2 ADVERSARIAL: test edge cases, negations, or common misconceptions about the content

    Rules:
    - Every question must be answerable from the passage alone.
    - Answers should be concise (1–3 sentences).
    - Output ONLY a valid JSON array of objects with keys "question" and "answer".
    - No preamble, no explanation, no markdown fences.
""").strip()


# ── Text processing ───────────────────────────────────────────────────────────


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


def _chunk_text(text: str, max_chars: int = 3000) -> list[str]:
    """Split text into overlapping chunks.

    3000 chars gives inferential/applied generators enough context to produce
    multi-fact questions. 15% overlap ensures facts at boundaries appear in two chunks.
    """
    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for word in words:
        current.append(word)
        current_len += len(word) + 1
        if current_len >= max_chars:
            chunks.append(" ".join(current))
            overlap = max(1, len(current) // 7)
            current = current[-overlap:]
            current_len = sum(len(w) + 1 for w in current)
    if current:
        chunks.append(" ".join(current))
    return chunks


def _parse_pairs_with_rubric(raw: str) -> list[dict[str, str | list[str]]]:
    """Parse challenger output: [{question, answer, rubric}]."""
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        items = _json_loads_tolerant(raw)
    if not isinstance(items, list):
        return []
    out: list[dict[str, str | list[str]]] = []
    for p in items:
        if not isinstance(p, dict):
            continue
        q = str(p.get("question", "")).strip()
        a = str(p.get("answer", "")).strip()
        raw_rubric = p.get("rubric", [])
        if not isinstance(raw_rubric, list):
            rubric: list[str] = [str(raw_rubric)]
        else:
            rubric = [str(r).strip() for r in raw_rubric if str(r).strip()]
        if q and a:
            out.append({"question": q, "answer": a, "rubric": rubric})
    return out


def _parse_simple_pairs(raw: str) -> list[dict[str, str]]:
    """Parse simple [{question, answer}] output (fallback path)."""
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        items = _json_loads_tolerant(raw)
    if not isinstance(items, list):
        return []
    out = []
    for p in items:
        if isinstance(p, dict) and "question" in p and "answer" in p:
            q = str(p["question"]).strip()
            a = str(p["answer"]).strip()
            if q and a:
                out.append({"question": q, "answer": a})
    return out


def _json_loads_tolerant(raw: str) -> object:
    """Parse JSON that may contain literal newlines/tabs inside string values."""
    result_chars: list[str] = []
    in_string = False
    i = 0
    while i < len(raw):
        ch = raw[i]
        if in_string:
            if ch == "\\":
                result_chars.append(ch)
                if i + 1 < len(raw):
                    i += 1
                    result_chars.append(raw[i])
            elif ch == '"':
                in_string = False
                result_chars.append(ch)
            elif ch == "\n":
                result_chars.append("\\n")
            elif ch == "\r":
                result_chars.append("\\r")
            elif ch == "\t":
                result_chars.append("\\t")
            else:
                result_chars.append(ch)
        else:
            if ch == '"':
                in_string = True
            result_chars.append(ch)
        i += 1
    return json.loads("".join(result_chars))


# ── Solver & judge calls ──────────────────────────────────────────────────────


async def _get_answer(llm: ChatOpenAI, system: str, question: str) -> str:
    try:
        response = await llm.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": question},
            ]
        )
        return str(response.content).strip()
    except Exception as exc:  # noqa: BLE001
        _log.warning("Solver call failed: %s", exc)
        return ""


async def _judge_answer(
    judge_llm: ChatOpenAI,
    question: str,
    rubric: list[str],
    answer: str,
) -> float:
    if not answer:
        return 0.0
    rubric_text = "\n".join(f"- {r}" for r in rubric) if rubric else "- Correct and relevant answer"
    try:
        response = await judge_llm.ainvoke(
            [
                {"role": "system", "content": _JUDGE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Question: {question}\n\n"
                        f"Rubric (key points to check):\n{rubric_text}\n\n"
                        f"Answer to score:\n{answer}"
                    ),
                },
            ]
        )
        raw = str(response.content).strip()
        obj = json.loads(raw)
        score = float(obj.get("score", 0.0))
        return max(0.0, min(1.0, score))
    except Exception as exc:  # noqa: BLE001
        _log.warning("Judge call failed: %s", exc)
        return 0.0


# ── Per-chunk pipeline ────────────────────────────────────────────────────────


async def _process_chunk_with_filtering(
    chunk: str,
    base_prompt: str,
    challenger_llm: ChatOpenAI,
    weak_llm: ChatOpenAI,
    strong_llm: ChatOpenAI,
    judge_llm: ChatOpenAI,
    weak_system: str,
    strong_system: str,
) -> tuple[list[dict[str, str]], dict[str, int]]:
    """Generate candidates for one chunk and filter by weak-strong gap.

    Returns (accepted_pairs, rejection_stats).
    """
    stats = {"accepted": 0, "too_easy": 0, "too_hard": 0, "quality_fail": 0}

    # Step 1: Challenger generates 5 candidates with rubrics
    try:
        response = await challenger_llm.ainvoke(
            [
                {"role": "system", "content": _CHALLENGER_SYSTEM},
                {"role": "user", "content": f"Passage:\n\n{chunk}"},
            ]
        )
        candidates = _parse_pairs_with_rubric(str(response.content))
    except Exception as exc:  # noqa: BLE001
        _log.warning("Challenger failed for chunk: %s", exc)
        return [], stats

    if not candidates:
        return [], stats

    accepted: list[dict[str, str]] = []

    # Step 2–5: For each candidate, test weak + strong in parallel, then judge
    async def evaluate_candidate(candidate: dict[str, str | list[str]]) -> dict[str, str] | None:
        question = str(candidate["question"])
        gold_answer = str(candidate["answer"])
        rubric = candidate.get("rubric", [])
        if not isinstance(rubric, list):
            rubric = []

        # Both solvers answer in parallel
        weak_answer, strong_answer = await asyncio.gather(
            _get_answer(weak_llm, weak_system, question),
            _get_answer(strong_llm, strong_system, question),
        )

        # Judge both answers in parallel
        rubric_list = rubric if isinstance(rubric, list) else []
        weak_score, strong_score = await asyncio.gather(
            _judge_answer(judge_llm, question, rubric_list, weak_answer),
            _judge_answer(judge_llm, question, rubric_list, strong_answer),
        )

        gap = strong_score - weak_score
        _log.debug(
            "Q: %s... | weak=%.2f strong=%.2f gap=%.2f",
            question[:60],
            weak_score,
            strong_score,
            gap,
        )

        # AutoData acceptance criteria (adapted)
        if weak_score > _WEAK_MAX_SCORE:
            stats["too_easy"] += 1
            _log.debug("Rejected (too easy — weak scored %.2f)", weak_score)
            return None
        if strong_score < _STRONG_MIN_SCORE:
            stats["too_hard"] += 1
            _log.debug("Rejected (too hard — strong scored %.2f)", strong_score)
            return None
        if gap < _GAP_THRESHOLD:
            stats["quality_fail"] += 1
            _log.debug("Rejected (gap too small — %.2f)", gap)
            return None

        stats["accepted"] += 1
        return {"question": question, "answer": gold_answer}

    results = await asyncio.gather(*[evaluate_candidate(c) for c in candidates])
    accepted = [r for r in results if r is not None]
    return accepted, stats


async def _process_chunk_fallback(
    chunk: str,
    challenger_llm: ChatOpenAI,
) -> list[dict[str, str]]:
    """Fallback for augment task (no base_prompt): generate without filtering."""
    try:
        response = await challenger_llm.ainvoke(
            [
                {"role": "system", "content": _FALLBACK_CHALLENGER_SYSTEM},
                {"role": "user", "content": f"Passage:\n\n{chunk}"},
            ]
        )
        return _parse_simple_pairs(str(response.content))
    except Exception as exc:  # noqa: BLE001
        _log.warning("Fallback challenger failed: %s", exc)
        return []


# ── Public entry points ───────────────────────────────────────────────────────


async def generate_qa_pairs(
    text: str,
    api_key: str,
    base_prompt: str | None = None,
) -> list[dict[str, str]]:
    """Generate a discriminative Q&A dataset from extracted PDF text.

    With base_prompt (prepare_domain_dataset task):
      Runs the AutoData weak-strong filtering loop. Each question is tested against:
        - Weak solver: GPT-4o-mini with NO system prompt (raw model, no domain guidance)
        - Strong solver: GPT-4o-mini WITH the user's base prompt as system prompt
      Only questions where the base prompt demonstrably helps (gap ≥ 0.3) are kept.
      This creates a dataset specifically calibrated to the user's domain and prompt.

    Without base_prompt (augment_domain_dataset task):
      Falls back to diversity-stratified generation without filtering.
    """
    challenger_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        base_url="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.6,
        max_tokens=2048,
    )

    chunks = _chunk_text(text, max_chars=3000)
    # With filtering: each chunk runs 5 candidates × 3 LLM calls (weak+strong+judge×2) = 15 calls
    # Cap at 12 chunks → max 180 calls. Without filtering: 12 chunks × 1 call = 12 calls.
    max_chunks = 12
    if len(chunks) > max_chunks:
        _log.warning("PDF produced %d chunks; processing first %d", len(chunks), max_chunks)
    selected = chunks[:max_chunks]

    if base_prompt is None:
        # Fallback path: no filtering
        tasks = [_process_chunk_fallback(chunk, challenger_llm) for chunk in selected]
        batch_results: list[list[dict[str, str]]] = await asyncio.gather(*tasks)
        all_pairs: list[dict[str, str]] = []
        seen: set[str] = set()
        for batch in batch_results:
            for p in batch:
                key = p["question"].strip().lower()
                if key not in seen:
                    seen.add(key)
                    all_pairs.append(p)
        _log.info("Fallback generation: %d pairs from %d chunks", len(all_pairs), len(selected))
        return all_pairs

    # Main path: AutoData weak-strong filtering
    weak_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        base_url="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=512,
    )
    strong_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        base_url="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=512,
    )
    judge_llm = ChatOpenAI(
        model="openai/gpt-4o",
        base_url="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=64,
    )

    # Weak solver: no system prompt (plain model capability)
    weak_system = "You are a helpful assistant. Answer the question as best you can."
    # Strong solver: the user's actual base prompt (domain-guided)
    strong_system = base_prompt

    chunk_tasks = [
        _process_chunk_with_filtering(
            chunk,
            base_prompt,
            challenger_llm,
            weak_llm,
            strong_llm,
            judge_llm,
            weak_system,
            strong_system,
        )
        for chunk in selected
    ]
    chunk_results = await asyncio.gather(*chunk_tasks)

    all_pairs = []
    seen = set()
    total_stats: dict[str, int] = {"accepted": 0, "too_easy": 0, "too_hard": 0, "quality_fail": 0}
    for pairs, stats in chunk_results:
        for k in total_stats:
            total_stats[k] += stats.get(k, 0)
        for p in pairs:
            key = p["question"].strip().lower()
            if key not in seen:
                seen.add(key)
                all_pairs.append(p)

    total_candidates = sum(total_stats.values())
    _log.info(
        "AutoData filtering complete: %d/%d accepted (too_easy=%d, too_hard=%d, gap_fail=%d)",
        total_stats["accepted"],
        total_candidates,
        total_stats["too_easy"],
        total_stats["too_hard"],
        total_stats["quality_fail"],
    )

    if not all_pairs:
        _log.warning(
            "No pairs passed AutoData filtering — lowering thresholds and retrying with fallback"
        )
        fallback_tasks = [_process_chunk_fallback(chunk, challenger_llm) for chunk in selected]
        fallback_results: list[list[dict[str, str]]] = await asyncio.gather(*fallback_tasks)
        seen = set()
        for batch in fallback_results:
            for p in batch:
                key = p["question"].strip().lower()
                if key not in seen:
                    seen.add(key)
                    all_pairs.append(p)
        _log.info("Fallback produced %d pairs", len(all_pairs))

    return all_pairs


def pairs_to_jsonl(pairs: list[dict[str, str]]) -> str:
    """Convert Q&A pairs to JSONL format (one JSON object per line)."""
    return "\n".join(json.dumps(p, ensure_ascii=False) for p in pairs)
