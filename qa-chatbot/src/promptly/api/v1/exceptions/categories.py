from fastapi import HTTPException, status


class CategoryNotFoundException(HTTPException):
    def __init__(self, detail: str = "Category not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class CategorySlugConflictException(HTTPException):
    def __init__(self, detail: str = "A category with this name already exists.") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class PredefinedCategoryReadOnlyException(HTTPException):
    def __init__(
        self, detail: str = "Predefined categories cannot be modified or deleted."
    ) -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class InvalidCategoryException(HTTPException):
    def __init__(self, detail: str = "Invalid category slug.") -> None:
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)
