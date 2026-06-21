from fastapi import HTTPException, status


class SkillOptProjectNotFoundError(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail="Skill project not found.")


class SkillOptAlreadyRunningError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="Optimization is already in progress.",
        )


class SkillOptInsufficientCreditsError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Not enough credits.",
        )


class SkillOptJobNotFoundError(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")


class SkillOptNoExamplesError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least 6 examples are required.",
        )
