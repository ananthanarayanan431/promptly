from fastapi import HTTPException, status


class InvalidCredentialsException(HTTPException):
    def __init__(self, detail: str = "Incorrect email or password") -> None:
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


class InactiveUserException(HTTPException):
    def __init__(self, detail: str = "Inactive user") -> None:
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
