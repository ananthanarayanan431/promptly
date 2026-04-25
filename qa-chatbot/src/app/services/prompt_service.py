from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any
from uuid import UUID

from langchain_openai import ChatOpenAI
from openai import APIStatusError as OpenAIAPIError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.llm import get_llm_settings
from app.core.exceptions import GuardrailException, LLMException, NotFoundException
from app.graph.nodes.guardrails import guardrails_node
from app.graph.prompts import prompt_advisory_messages, prompt_health_score_messages
from app.graph.state import GraphState
from app.models.favorite_prompt import FavoritePrompt
from app.repositories.prompt_version_repo import PromptVersionRepository

logger = logging.getLogger(__name__)

_analyser: ChatOpenAI | None = None


def _get_analyser() -> ChatOpenAI:
    global _analyser
    if _analyser is None:
        llm_settings = get_llm_settings()
        _analyser = ChatOpenAI(
            model=llm_settings.DEFAULT_MODEL,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
    return _analyser


def _get_text_content(content: str | list | None) -> str:  # type: ignore[type-arg]
    """
    Normalise an AIMessage.content to a plain string.

    In langchain_openai ≥1.x / openai ≥2.x the field can be:
      - str   — normal text response
      - list  — list of content blocks e.g. [{"type": "text", "text": "..."}]
      - None  — filtered / quota exceeded
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


def _extract_json(raw: str) -> str:
    """
    Extract a JSON object from a model response that may be wrapped in markdown fences.

    Strategy:
      1. If the response contains ```...``` fences, pull the content from inside them.
      2. Otherwise, find the first '{' and last '}' and return that slice.
      3. Fall back to returning the stripped string as-is so json.loads surfaces
         a clear parse error rather than a confusing empty-string error.
    """
    # 1. Strip markdown fences (```json ... ``` or ``` ... ```)
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
    if fence_match:
        return fence_match.group(1).strip()

    # 2. Find the outermost { ... } in case the model added preamble text
    brace_start = raw.find("{")
    brace_end = raw.rfind("}")
    if brace_start != -1 and brace_end > brace_start:
        return raw[brace_start : brace_end + 1]

    # 3. Return stripped string — json.loads will raise a clear JSONDecodeError
    return raw.strip()


class PromptService:
    """
    Handles standalone prompt analysis — no council vote, no DB persistence.
    Used by the /prompts/health-score and /prompts/advisory endpoints.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _run_guardrails(self, raw_prompt: str, user_id: str) -> GraphState:
        state: GraphState = {
            "raw_prompt": raw_prompt,
            "session_id": "",
            "user_id": user_id,
            "feedback": None,
            "job_id": None,
            "intent": None,
            "council_responses": [],
            "critic_responses": [],
            "final_response": "",
            "messages": [],
            "token_usage": {},
            "error": None,
        }
        result = await guardrails_node(state)
        if result.get("error"):
            raise GuardrailException(detail=result["error"])
        state.update(result)  # type: ignore[typeddict-item]
        return state

    async def health_score(self, prompt: str, user_id: str) -> dict[str, Any]:
        await self._run_guardrails(prompt, user_id)

        try:
            response = await _get_analyser().ainvoke(prompt_health_score_messages(prompt))
        except OpenAIAPIError as exc:
            logger.error(
                "OpenRouter API error in health_score: status=%s body=%s",
                exc.status_code,
                exc.body,
            )
            raise LLMException(detail=f"OpenRouter error {exc.status_code}: {exc.message}") from exc

        raw = _get_text_content(response.content).strip()
        if not raw:
            raise LLMException(
                detail=(
                    "LLM returned an empty response"
                    " — check your OpenRouter API key and model availability."
                )
            )
        extracted = _extract_json(raw)
        try:
            scores = json.loads(extracted)
        except json.JSONDecodeError as exc:
            logger.error(
                "health_score JSON parse failed: %s\n"
                "--- raw (%d chars) ---\n%s\n--- extracted ---\n%s",
                exc,
                len(raw),
                raw,
                extracted,
            )
            raise LLMException(detail=f"LLM response was not valid JSON: {exc}") from exc
        return {"prompt": prompt, **scores}

    async def advisory(self, prompt: str, user_id: str) -> dict[str, Any]:
        await self._run_guardrails(prompt, user_id)

        try:
            response = await _get_analyser().ainvoke(prompt_advisory_messages(prompt))
        except OpenAIAPIError as exc:
            logger.error(
                "OpenRouter API error in advisory: status=%s body=%s",
                exc.status_code,
                exc.body,
            )
            raise LLMException(detail=f"OpenRouter error {exc.status_code}: {exc.message}") from exc

        raw = _get_text_content(response.content).strip()
        logger.debug(
            "advisory raw content type=%s len=%d",
            type(response.content).__name__,
            len(raw),
        )
        if not raw:
            raise LLMException(
                detail=(
                    "LLM returned an empty response"
                    " — check your OpenRouter API key and model availability."
                )
            )
        try:
            advice = json.loads(_extract_json(raw))
        except json.JSONDecodeError as exc:
            raise LLMException(detail=f"LLM response was not valid JSON: {exc}") from exc
        return {"prompt": prompt, **advice}


class PromptVersioningService:
    """
    Manages named, versioned prompts.

    Each prompt family shares a stable `prompt_id`. Versions start at 1 (the raw
    user input) and increment each time the user optimizes through the LangGraph
    council pipeline.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = PromptVersionRepository(db)

    @staticmethod
    def _fmt(v: Any) -> dict[str, Any]:  # noqa: ANN401
        return {
            "version_id": str(v.id),
            "prompt_id": str(v.prompt_id),
            "name": v.name,
            "version": v.version,
            "content": v.content,
            "created_at": v.created_at.isoformat(),
            "is_favorited": False,
            "favorite_id": None,
        }

    async def _favorites_by_version_id(
        self, user_id: UUID, version_ids: list[UUID]
    ) -> dict[UUID, FavoritePrompt]:
        """Return a mapping of prompt_version_id → FavoritePrompt for the given user."""
        if not version_ids:
            return {}
        result = await self.db.execute(
            select(FavoritePrompt).where(
                FavoritePrompt.user_id == user_id,
                FavoritePrompt.prompt_version_id.in_(version_ids),
            )
        )
        return {fav.prompt_version_id: fav for fav in result.scalars().all()}

    async def create(self, name: str, content: str, user_id: str) -> dict[str, Any]:
        """
        Save a prompt under a given name.

        - If the name is new for this user → issues a fresh prompt_id and starts at v1.
        - If the name already exists → reuses the same prompt_id and appends the next
          version number, so repeated submissions with the same name always continue
          the same version lineage (v1 → v2 → v3 …).

        Raises:
            GuardrailException if the content fails safety checks.
        """
        state: GraphState = {
            "raw_prompt": content,
            "session_id": "",
            "user_id": user_id,
            "feedback": None,
            "job_id": None,
            "intent": None,
            "council_responses": [],
            "critic_responses": [],
            "final_response": "",
            "messages": [],
            "token_usage": {},
            "error": None,
        }
        guardrail_result = await guardrails_node(state)
        if guardrail_result.get("error"):
            raise GuardrailException(detail=guardrail_result["error"])

        # Look up whether this name already has a version history for this user
        existing = await self.repo.get_latest_by_name(name, UUID(user_id))
        if existing:
            prompt_id = existing.prompt_id
            next_version = existing.version + 1
        else:
            prompt_id = uuid.uuid4()
            next_version = 1

        v = await self.repo.create_version(
            prompt_id=prompt_id,
            user_id=UUID(user_id),
            name=name,
            version=next_version,
            content=content,
        )
        favs = await self._favorites_by_version_id(UUID(user_id), [v.id])
        version_dict = self._fmt(v)
        if v.id in favs:
            version_dict["is_favorited"] = True
            version_dict["favorite_id"] = str(favs[v.id].id)
        return {"prompt_id": str(prompt_id), "version": version_dict}

    async def list_families(self, user_id: str) -> list[dict[str, Any]]:
        """
        Return all prompt families (grouped by prompt_id) for a user,
        each with their full version history in ascending order,
        sorted by the latest version's created_at descending (most-recently updated first).
        """
        all_versions = await self.repo.get_all_by_user_id(UUID(user_id))

        version_ids = [v.id for v in all_versions]
        favs = await self._favorites_by_version_id(UUID(user_id), version_ids)

        # Group by prompt_id preserving insertion order
        families: dict[str, dict[str, Any]] = {}
        for v in all_versions:
            key = str(v.prompt_id)
            if key not in families:
                families[key] = {
                    "prompt_id": key,
                    "name": v.name,
                    "versions": [],
                }
            version_dict = self._fmt(v)
            if v.id in favs:
                version_dict["is_favorited"] = True
                version_dict["favorite_id"] = str(favs[v.id].id)
            families[key]["versions"].append(version_dict)

        # Sort by latest version's created_at descending (most-recently updated first)
        return sorted(
            families.values(),
            key=lambda f: f["versions"][-1]["created_at"] if f["versions"] else "",
            reverse=True,
        )

    async def list_versions(self, prompt_id: UUID, user_id: str) -> dict[str, Any]:
        """
        Return all versions of a prompt in ascending order.

        Raises:
            NotFoundException if prompt_id does not exist or belongs to another user.
        """
        versions = await self.repo.get_all_by_prompt_id(prompt_id, UUID(user_id))
        if not versions:
            raise NotFoundException(detail="Prompt not found.")

        version_ids = [v.id for v in versions]
        favs = await self._favorites_by_version_id(UUID(user_id), version_ids)

        version_list = []
        for v in versions:
            version_dict = self._fmt(v)
            if v.id in favs:
                version_dict["is_favorited"] = True
                version_dict["favorite_id"] = str(favs[v.id].id)
            version_list.append(version_dict)

        return {
            "prompt_id": str(prompt_id),
            "name": versions[0].name,
            "versions": version_list,
        }
