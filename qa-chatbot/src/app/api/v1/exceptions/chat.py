from fastapi import HTTPException, status


class ChatInsufficientCreditsException(HTTPException):
    def __init__(self, detail: str = "Insufficient credits. 10 credits required per run.") -> None:
        super().__init__(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


class VersionedPromptNotFoundException(HTTPException):
    def __init__(self, detail: str = "Versioned prompt not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class JobNotFoundException(HTTPException):
    def __init__(self, detail: str = "Job not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class InvalidSessionIDException(HTTPException):
    def __init__(self, detail: str = "Invalid session ID.") -> None:
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


class SessionNotFoundException(HTTPException):
    def __init__(self, detail: str = "Session not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
