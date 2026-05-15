"""
PromptBridge transfer engine (arXiv:2512.01420 §3.2).

Two sub-components:

  1. Mapping Extractor — given N calibrated (source, target) prompt pairs, distil
     a reusable structural transfer mapping that describes HOW prompts must change
     from source model style to target model style.

  2. Adapter — given an unseen source prompt and the learned mapping, produce an
     optimised target prompt. Zero-shot at inference time.

The mapping is persisted in the DB so repeated transfers between the same model
pair skip calibration entirely (reuse_mapping flow, 1 credit).
"""

from __future__ import annotations

import logging

from app.llm import LLMClient
from app.prompt_bridge.prompts.transfer import ADAPTER_SYSTEM, MAPPING_EXTRACTOR_SYSTEM

_log = logging.getLogger(__name__)


def _build_pairs_block(pairs: list[tuple[str, str]]) -> str:
    """Format calibrated (source, target) prompt pairs for the extractor prompt."""
    blocks: list[str] = []
    for i, (src, tgt) in enumerate(pairs, 1):
        entry = f"--- Pair {i} ---\n[SOURCE PROMPT]\n{src}\n\n[TARGET PROMPT]\n{tgt}"
        blocks.append(entry)
    return "\n\n".join(blocks)


async def extract_mapping(
    source_model: str,
    target_model: str,
    calibrated_pairs: list[tuple[str, str]],
    extractor_llm: LLMClient,
) -> str:
    """
    Phase 1 — Mapping Extractor (arXiv:2512.01420 §3.2, Algorithm 1 lines 8-10).

    Analyses N calibrated (source_prompt, target_prompt) pairs and produces a
    textual transfer mapping describing the structural/stylistic transformation
    rules needed to convert source-model prompts into target-model prompts.

    Args:
        source_model: Human-readable name of the source model.
        target_model: Human-readable name of the target model.
        calibrated_pairs: List of (source_optimal_prompt, target_optimal_prompt).
        extractor_llm: High-capability LLM used for analysis (e.g. GPT-4o).

    Returns:
        Transfer mapping as a structured text document.
    """
    if not calibrated_pairs:
        raise ValueError("At least one calibrated pair is required for mapping extraction")

    pairs_block = _build_pairs_block(calibrated_pairs)
    system = MAPPING_EXTRACTOR_SYSTEM.format(
        source_model=source_model,
        target_model=target_model,
        n=len(calibrated_pairs),
        pairs_block=pairs_block,
    )

    _log.info(
        "Extracting transfer mapping: %s → %s (%d pairs)",
        source_model,
        target_model,
        len(calibrated_pairs),
    )
    response = await extractor_llm.ainvoke([{"role": "user", "content": system}])
    mapping = str(response.content).strip()
    if not mapping:
        _log.error(
            "Mapping extractor returned empty content for %s → %s", source_model, target_model
        )
        raise ValueError("Mapping extractor returned empty content")
    _log.debug("Transfer mapping extracted (%d chars)", len(mapping))
    return mapping


async def adapt_prompt(
    source_prompt: str,
    source_model: str,
    target_model: str,
    transfer_mapping: str,
    n_pairs: int,
    adapter_llm: LLMClient,
) -> str:
    """
    Phase 2 — Adapter (arXiv:2512.01420 §3.2, Algorithm 1 lines 11-13).

    Applies the learned transfer mapping to transform an unseen source prompt
    into an optimised prompt for the target model. Zero-shot at inference time —
    no additional calibration or evaluation required.

    Args:
        source_prompt: The prompt optimised for source_model to be transferred.
        source_model: Human-readable name of the source model.
        target_model: Human-readable name of the target model.
        transfer_mapping: The mapping produced by extract_mapping().
        n_pairs: Number of calibration pairs used to produce the mapping (for prompt).
        adapter_llm: LLM that applies the mapping (same or similar to extractor).

    Returns:
        Adapted prompt optimised for target_model.
    """
    system = ADAPTER_SYSTEM.format(
        source_model=source_model,
        target_model=target_model,
        transfer_mapping=transfer_mapping,
        source_prompt=source_prompt,
        n_pairs=n_pairs,
    )

    _log.info("Adapting prompt: %s → %s", source_model, target_model)
    response = await adapter_llm.ainvoke([{"role": "user", "content": system}])
    adapted = str(response.content).strip()
    if not adapted:
        _log.error("Adapter returned empty content for %s → %s", source_model, target_model)
        raise ValueError("Adapter returned empty content")
    _log.debug("Prompt adapted (%d → %d chars)", len(source_prompt), len(adapted))
    return adapted


async def run_transfer_pipeline(
    source_prompt: str,
    source_model: str,
    target_model: str,
    source_optimal_prompt: str,
    target_optimal_prompt: str,
    extractor_llm: LLMClient,
    adapter_llm: LLMClient,
    existing_pairs: list[tuple[str, str]] | None = None,
) -> tuple[str, str]:
    """
    Full PromptBridge pipeline: calibrated pairs → mapping → adapted prompt.

    Given the MAP-RPE outputs (optimal prompts for source and target model on
    the same calibration tasks), extract the transfer mapping and immediately
    apply it to produce the adapted prompt.

    Args:
        source_prompt: Original user prompt (for source model).
        source_model: Source model name.
        target_model: Target model name.
        source_optimal_prompt: MAP-RPE best prompt for source model.
        target_optimal_prompt: MAP-RPE best prompt for target model.
        extractor_llm: Used for mapping extraction.
        adapter_llm: Used for prompt adaptation.
        existing_pairs: Previously collected pairs to include (accumulation).

    Returns:
        (transfer_mapping, adapted_prompt)
    """
    pairs: list[tuple[str, str]] = list(existing_pairs or [])
    pairs.append((source_optimal_prompt, target_optimal_prompt))

    mapping = await extract_mapping(source_model, target_model, pairs, extractor_llm)
    adapted = await adapt_prompt(
        source_prompt=source_prompt,
        source_model=source_model,
        target_model=target_model,
        transfer_mapping=mapping,
        n_pairs=len(pairs),
        adapter_llm=adapter_llm,
    )
    return mapping, adapted
