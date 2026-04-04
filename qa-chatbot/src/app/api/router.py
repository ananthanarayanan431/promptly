from fastapi import APIRouter

from app.api.v1 import chat
from app.api.v1 import health
from app.api.v1 import prompts
from app.api.v1 import auth
from app.api.v1 import users

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)