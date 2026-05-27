from fastapi import HTTPException, status


class DomainInsufficientCreditsException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. 10 credits required per domain optimization.",
        )


class DomainNotFoundException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found.",
        )


class DomainJobNotFoundException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain optimization job not found.",
        )


class InvalidPDFException(HTTPException):
    def __init__(self, detail: str = "Uploaded file is not a valid PDF.") -> None:
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class DomainAlreadyRunningException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="This domain already has an optimization in progress.",
        )


class DomainNotReadyException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="Domain dataset is not ready yet. Wait for the preparation job to complete.",
        )


class DomainJobNotCancellableException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="Job cannot be cancelled — it is already completed, failed, or cancelled.",
        )
