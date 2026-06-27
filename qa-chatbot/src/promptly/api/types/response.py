from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field, model_validator

from .error_codes import Error

DataT = TypeVar("DataT", bound=BaseModel)


# ── Success / error envelope ───────────────────────────────────────────────────


class Response(BaseModel, Generic[DataT]):  # noqa: UP046
    success: bool = Field(..., description="Whether the request was successful")
    data: DataT | None = Field(..., description="The data of the response")


class SuccessResponse(Response[DataT]):
    """Returned by every endpoint that completes without error."""

    success: bool = True
    data: DataT = Field(..., description="The data of the response")

    @model_validator(mode="after")
    def _data_must_be_concrete_model(self) -> SuccessResponse[DataT]:
        # When SuccessResponse is called without a type parameter (e.g.
        # SuccessResponse(data=some_dict)) Pydantic v2 coerces the dict to the
        # TypeVar bound — plain BaseModel — which has no __private_attributes__
        # and silently produces a broken object that crashes on repr/str.
        # Fail fast here so the bug surfaces at construction time.
        if type(self.data) is BaseModel:
            raise ValueError(
                "SuccessResponse.data must be a concrete BaseModel subclass, not BaseModel itself. "
                "Pass a typed model instance or use SuccessResponse[YourModel](data=...)."
            )
        return self


class ErrorResponse(BaseModel):
    """Returned by every endpoint that raises an HTTP error.

    The shape is consistent across the entire API so clients can handle
    errors generically without inspecting the status code first.
    """

    success: bool = Field(False, description="Always false for error responses")
    data: None = Field(None, description="Always null for error responses")
    detail: str = Field(..., description="Human-readable error description")


# ── `responses=` helper ───────────────────────────────────────────────────────

_ERROR_CATALOG: dict[int, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "Bad request — check your input."},
    401: {
        "model": ErrorResponse,
        "description": "Unauthorized — valid Bearer token or API key required.",
    },
    402: {"model": ErrorResponse, "description": "Insufficient tokens — balance exhausted."},
    403: {
        "model": ErrorResponse,
        "description": "Forbidden — you do not have permission to perform this action.",
    },
    404: {
        "model": ErrorResponse,
        "description": "Not found — the requested resource does not exist.",
    },
    409: {
        "model": ErrorResponse,
        "description": "Conflict — resource already exists or a job is already running.",
    },
    422: {
        "model": ErrorResponse,
        "description": "Validation error — check the request body and query parameters.",
    },
    429: {"model": ErrorResponse, "description": "Rate limit exceeded — slow down and retry."},
    500: {
        "model": ErrorResponse,
        "description": "Internal server error — please try again shortly.",
    },
    502: {"model": ErrorResponse, "description": "Upstream LLM service error."},
    504: {
        "model": ErrorResponse,
        "description": "Gateway timeout — the LLM took too long to respond.",
    },
}


def error_responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """Return a ``responses=`` dict for the given HTTP error status codes.

    Usage::

        @router.post("/", responses=error_responses(401, 409, 429, 500))
        async def create_thing(...): ...
    """
    return {code: _ERROR_CATALOG[code] for code in codes if code in _ERROR_CATALOG}


# ── Legacy exception wrapper (kept for backward compat) ───────────────────────


class ResponseError(Exception):
    def __init__(self, error: Error) -> None:
        super().__init__(error.message)
        self.error = error

    def __str__(self) -> str:
        return f"[Error {self.error.code}]: {self.error.description}"
