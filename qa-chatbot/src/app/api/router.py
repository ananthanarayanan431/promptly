from fastapi import APIRouter

from app.api.v1 import (
    api_keys,
    categories,
    favorites,
    health,
    openrouter,
    prompts,
    stats,
    templates,
    users,
)
from app.api.v1.orgs import router as orgs_router
from app.domain_prompt import router as domain_prompt_router
from app.optimize.api.router import router as optimize_router
from app.prompt_bridge import router as prompt_bridge_router

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(optimize_router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(users.router)
api_router.include_router(favorites.router)
api_router.include_router(api_keys.router)
api_router.include_router(categories.router)
api_router.include_router(openrouter.router)
api_router.include_router(orgs_router, tags=["orgs"])
api_router.include_router(domain_prompt_router)
api_router.include_router(prompt_bridge_router)
