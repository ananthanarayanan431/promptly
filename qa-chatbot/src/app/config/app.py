from typing import List
from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    APP_NAME: str = "qa-chatbot"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGIN: List[str] = ["http://localhost:3000", "*"]
    
@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
