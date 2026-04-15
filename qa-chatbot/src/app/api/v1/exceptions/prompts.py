from fastapi import HTTPException, status


class PromptInsufficientCreditsException(HTTPException):
    def __init__(self, detail: str = "Insufficient credits. 5 credits required per run.") -> None:
        super().__init__(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)
