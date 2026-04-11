from typing import Any

from fastapi import status
from pydantic import BaseModel, Field


class Error(BaseModel):
    code: int = Field(..., description="Error code")
    description: str = Field(..., description="Error description")
    message: str | None = Field(None, description="Custom Error message")


class InternalServerError(Error):
    code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    description: str = "Internal Server Error"


class NotFoundError(Error):
    code: int = status.HTTP_404_NOT_FOUND
    description: str = "Not found"


class BadRequestError(Error):
    code: int = status.HTTP_400_BAD_REQUEST
    description: str = "Bad Request"


class UnauthorizedError(Error):
    code: int = status.HTTP_401_UNAUTHORIZED
    description: str = "Unauthorized"


class ConflictError(Error):
    code: int = status.HTTP_409_CONFLICT
    description: str = "Conflict"


class ForbiddenError(Error):
    code: int = status.HTTP_403_FORBIDDEN
    description: str = "Forbidden"


FAST_API_ERROR_RESPONSE_MODELS: dict[int | str, dict[str, Any]] = {
    status.HTTP_404_NOT_FOUND: {"model": NotFoundError},
    status.HTTP_400_BAD_REQUEST: {"model": BadRequestError},
    status.HTTP_500_INTERNAL_SERVER_ERROR: {"model": Error},
    status.HTTP_401_UNAUTHORIZED: {"model": UnauthorizedError},
    status.HTTP_409_CONFLICT: {"model": ConflictError},
    status.HTTP_403_FORBIDDEN: {"model": ForbiddenError},
    status.HTTP_500_INTERNAL_SERVER_ERROR: {"model": InternalServerError},
}
