from fastapi import APIRouter

from app.api.v1 import api_keys, auth, chat, favorites, health, prompts, stats, templates, users

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(favorites.router)
api_router.include_router(api_keys.router)
