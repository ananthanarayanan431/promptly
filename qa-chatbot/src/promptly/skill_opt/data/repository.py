from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.skill_opt.data.models import SkillOptProject, SkillOptRun, SkillOptStatus


class SkillOptProjectRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        task_description: str,
        description: str | None = None,
        credits_charged: int = 10,
    ) -> SkillOptProject:
        project = SkillOptProject(
            user_id=user_id,
            name=name,
            description=description,
            task_description=task_description,
            credits_charged=credits_charged,
            status=SkillOptStatus.pending,
        )
        self.db.add(project)
        await self.db.flush()
        return project

    async def get_by_id(self, project_id: uuid.UUID) -> SkillOptProject | None:
        result = await self.db.execute(
            select(SkillOptProject).where(SkillOptProject.id == project_id)
        )
        return result.scalar_one_or_none()

    async def get_by_id_and_user(
        self, project_id: uuid.UUID, user_id: uuid.UUID
    ) -> SkillOptProject | None:
        result = await self.db.execute(
            select(SkillOptProject).where(
                SkillOptProject.id == project_id,
                SkillOptProject.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: uuid.UUID) -> list[SkillOptProject]:
        result = await self.db.execute(
            select(SkillOptProject)
            .where(SkillOptProject.user_id == user_id)
            .order_by(SkillOptProject.created_at.desc())
        )
        return list(result.scalars().all())

    async def set_status(
        self,
        project: SkillOptProject,
        status: SkillOptStatus,
        *,
        error_message: str | None = None,
        seed_skill: str | None = None,
        best_skill: str | None = None,
        score_before: float | None = None,
        score_after: float | None = None,
        score_test: float | None = None,
        epochs_run: int | None = None,
        edits_accepted: int | None = None,
        edits_rejected: int | None = None,
        example_count: int | None = None,
    ) -> None:
        project.status = status
        if error_message is not None:
            project.error_message = error_message
        if seed_skill is not None:
            project.seed_skill = seed_skill
        if best_skill is not None:
            project.best_skill = best_skill
        if score_before is not None:
            project.score_before = score_before
        if score_after is not None:
            project.score_after = score_after
        if score_test is not None:
            project.score_test = score_test
        if epochs_run is not None:
            project.epochs_run = epochs_run
        if edits_accepted is not None:
            project.edits_accepted = edits_accepted
        if edits_rejected is not None:
            project.edits_rejected = edits_rejected
        if example_count is not None:
            project.example_count = example_count

    async def delete(self, project: SkillOptProject) -> None:
        await self.db.delete(project)

    async def create_run(
        self,
        *,
        project_id: uuid.UUID,
        epoch: int,
        score_before: float | None = None,
        score_after: float | None = None,
        edits_proposed: int | None = None,
        edits_accepted: int | None = None,
        edits_rejected: int | None = None,
        rollout_count: int | None = None,
        status: str = "completed",
    ) -> SkillOptRun:
        run = SkillOptRun(
            project_id=project_id,
            epoch=epoch,
            score_before=score_before,
            score_after=score_after,
            edits_proposed=edits_proposed,
            edits_accepted=edits_accepted,
            edits_rejected=edits_rejected,
            rollout_count=rollout_count,
            status=status,
        )
        self.db.add(run)
        await self.db.flush()
        return run

    async def get_runs_by_project(self, project_id: uuid.UUID) -> list[SkillOptRun]:
        result = await self.db.execute(
            select(SkillOptRun)
            .where(SkillOptRun.project_id == project_id)
            .order_by(SkillOptRun.epoch)
        )
        return list(result.scalars().all())
