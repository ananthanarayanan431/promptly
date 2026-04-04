from typing import Generic
from typing import TypeVar

from pydantic import BaseModel
from pydantic import Field

from .error_codes import Error

DataT = TypeVar("DataT", bound=BaseModel)


class Response(BaseModel, Generic[DataT]):
    success: bool = Field(..., description="Whether the request was successful")
    data: DataT | None = Field(..., description="The data of the response")


class SuccessResponse(Response[DataT]):
    success: bool = True
    data: DataT = Field(..., description="The data of the response")


class ErrorResponse(Exception):
    def __init__(self, error: Error):
        super().__init__(error.message)
        self.error = error

    def __str__(self):
        return f"[Error {self.error.code}]: {self.error.description}"