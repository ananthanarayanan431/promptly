from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.template import Template
from app.repositories.base import BaseRepository


class TemplateRepository(BaseRepository[Template]):
    model = Template

    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)

    async def get_active(self) -> list[Template]:
        """Return all active templates ordered by category then name."""
        result = await self.db.execute(
            select(Template)
            .where(Template.is_active.is_(True))
            .order_by(Template.category, Template.name)
        )
        return list(result.scalars().all())

    async def count_active(self) -> int:
        """Return count of active templates (used to skip seeding if already populated)."""
        result = await self.db.execute(
            select(func.count()).select_from(Template).where(Template.is_active.is_(True))
        )
        return result.scalar_one()
