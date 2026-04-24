from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from uuid import UUID

from langchain_openai import ChatOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.llm import get_llm_settings
from app.graph.prompts import favorite_auto_tag_messages
from app.models.favorite_prompt import FavoritePrompt
from app.models.prompt_version import PromptVersion
from app.repositories.favorite_repo import FavoriteRepository

logger = logging.getLogger(__name__)
_VALID_CATEGORIES = {"Writing", "Coding", "Analysis", "Other"}
_LLM_TIMEOUT_SECONDS = 2.0


class FavoriteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = FavoriteRepository(db)

    async def like(self, *, user_id: UUID, prompt_version_id: UUID) -> tuple[FavoritePrompt, bool]:
        existing = await self.repo.get_by_version(
            user_id=user_id, prompt_version_id=prompt_version_id
        )
        if existing is not None:
            return existing, False

        pv_result = await self.db.execute(
            select(PromptVersion).where(
                PromptVersion.id == prompt_version_id,
                PromptVersion.user_id == user_id,
            )
        )
        version = pv_result.scalar_one_or_none()
        if version is None:
            raise LookupError("prompt version not found for this user")

        tags: list[str] = []
        category = "Other"
        try:
            tag_set, category = await self._generate_tags(version.content)
            tags = sorted(tag_set)
        except Exception as exc:  # noqa: BLE001
            logger.info("favorite auto-tag failed; using defaults: %s", exc)

        fav = await self.repo.create(
            user_id=user_id,
            prompt_version_id=prompt_version_id,
            tags=tags,
            category=category,
        )
        return fav, True

    async def unlike(self, *, user_id: UUID, favorite_id: UUID) -> bool:
        fav = await self.repo.get_for_user(favorite_id=favorite_id, user_id=user_id)
        if fav is None:
            return False
        await self.repo.delete(fav)
        return True

    async def unlike_by_version(self, *, user_id: UUID, prompt_version_id: UUID) -> bool:
        fav = await self.repo.get_by_version(user_id=user_id, prompt_version_id=prompt_version_id)
        if fav is None:
            return False
        await self.repo.delete(fav)
        return True

    async def status(self, *, user_id: UUID, prompt_version_id: UUID) -> tuple[bool, UUID | None]:
        fav = await self.repo.get_by_version(user_id=user_id, prompt_version_id=prompt_version_id)
        return (fav is not None, fav.id if fav else None)

    async def update(
        self,
        *,
        user_id: UUID,
        favorite_id: UUID,
        fields: dict[str, Any],
    ) -> FavoritePrompt | None:
        fav = await self.repo.get_for_user(favorite_id=favorite_id, user_id=user_id)
        if fav is None:
            return None
        return await self.repo.update_fields(fav, **fields)

    async def increment_use(self, *, user_id: UUID, favorite_id: UUID) -> bool:
        fav = await self.repo.get_for_user(favorite_id=favorite_id, user_id=user_id)
        if fav is None:
            return False
        await self.repo.increment_use(favorite_id=favorite_id, user_id=user_id)
        return True

    async def _generate_tags(self, content: str) -> tuple[set[str], str]:
        llm_settings = get_llm_settings()
        council = llm_settings.COUNCIL_MODELS
        model_name = council[0] if council else llm_settings.DEFAULT_MODEL

        model = ChatOpenAI(
            model=model_name,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
            max_tokens=150,
            temperature=0,
        )

        response = await asyncio.wait_for(
            model.ainvoke(favorite_auto_tag_messages(content[:4000])),
            timeout=_LLM_TIMEOUT_SECONDS,
        )
        raw = str(response.content).strip()
        parsed = _extract_json_object(raw)

        tags_raw = parsed.get("tags", []) if isinstance(parsed, dict) else []
        category_raw = parsed.get("category", "Other") if isinstance(parsed, dict) else "Other"

        tags: set[str] = set()
        for t in tags_raw if isinstance(tags_raw, list) else []:
            if isinstance(t, str):
                cleaned = t.strip().lower()
                if cleaned:
                    tags.add(cleaned)
            if len(tags) >= 4:
                break

        category = category_raw if category_raw in _VALID_CATEGORIES else "Other"
        return tags, category


def _extract_json_object(raw: str) -> dict[str, Any]:
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
    candidate = fence.group(1).strip() if fence else raw
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        first = candidate.find("{")
        last = candidate.rfind("}")
        if first == -1 or last == -1:
            return {}
        try:
            parsed = json.loads(candidate[first : last + 1])
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}
