from fastapi import HTTPException, status


class ApiKeyNotFoundException(HTTPException):
    def __init__(self, detail: str = "API key not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class ApiKeyAlreadyRevokedException(HTTPException):
    def __init__(self, detail: str = "API key is already revoked.") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class ApiKeyNameConflictException(HTTPException):
    def __init__(self, detail: str = "An active API key with this name already exists.") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)
