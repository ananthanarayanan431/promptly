from fastapi import HTTPException, status


class PBInsufficientCreditsException(HTTPException):
    def __init__(self, required: int = 5) -> None:
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. {required} credits required for this operation.",
        )


class PBJobNotFoundException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transfer job not found.",
        )


class PBMappingNotFoundException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt mapping not found.",
        )


class PBInvalidModelException(HTTPException):
    def __init__(self, detail: str = "Invalid or unsupported model slug.") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )


class PBSameModelException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="source_model and target_model must be different.",
        )


class PBJobNotCancellableException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="Job cannot be cancelled — it is already completed, failed, or cancelled.",
        )
