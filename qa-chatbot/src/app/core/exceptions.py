from fastapi import HTTPException, status


class NotFoundException(HTTPException):
    def __init__(self, detail: str = "Resource not found") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class UnauthorizedException(HTTPException):
    def __init__(self, detail: str = "Not authenticated") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ForbiddenException(HTTPException):
    def __init__(self, detail: str = "Permission denied") -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class RateLimitException(HTTPException):
    def __init__(self, detail: str = "Rate limit exceeded") -> None:
        super().__init__(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)


class GuardrailException(HTTPException):
    def __init__(self, detail: str = "Prompt rejected by guardrails") -> None:
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class UserAlreadyExistException(HTTPException):
    def __init__(self, detail: str = "User already exists") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class LLMException(HTTPException):
    def __init__(self, detail: str = "LLM service error") -> None:
        super().__init__(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
