from fastapi import HTTPException, status


class FavoriteNotFoundException(HTTPException):
    def __init__(self, detail: str = "Favorite not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class FavoriteVersionNotFoundException(HTTPException):
    def __init__(self, detail: str = "Prompt version not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
