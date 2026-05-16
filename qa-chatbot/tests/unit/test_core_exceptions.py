"""Unit tests for app.core.exceptions — verifies status codes and detail messages."""

import pytest
from fastapi import status

from app.core.exceptions import (
    ForbiddenException,
    GuardrailException,
    LLMException,
    NotFoundException,
    RateLimitException,
    UnauthorizedException,
    UserAlreadyExistException,
)

# ---------------------------------------------------------------------------
# NotFoundException (404)
# ---------------------------------------------------------------------------


def test_not_found_exception_has_404_status_code() -> None:
    exc = NotFoundException()
    assert exc.status_code == status.HTTP_404_NOT_FOUND


def test_not_found_exception_default_detail() -> None:
    exc = NotFoundException()
    assert exc.detail == "Resource not found"


def test_not_found_exception_custom_detail() -> None:
    exc = NotFoundException(detail="User not found")
    assert exc.detail == "User not found"


# ---------------------------------------------------------------------------
# UnauthorizedException (401)
# ---------------------------------------------------------------------------


def test_unauthorized_exception_has_401_status_code() -> None:
    exc = UnauthorizedException()
    assert exc.status_code == status.HTTP_401_UNAUTHORIZED


def test_unauthorized_exception_default_detail() -> None:
    exc = UnauthorizedException()
    assert exc.detail == "Not authenticated"


def test_unauthorized_exception_custom_detail() -> None:
    exc = UnauthorizedException(detail="Token expired")
    assert exc.detail == "Token expired"


def test_unauthorized_exception_has_www_authenticate_header() -> None:
    exc = UnauthorizedException()
    assert exc.headers is not None
    assert exc.headers.get("WWW-Authenticate") == "Bearer"


# ---------------------------------------------------------------------------
# ForbiddenException (403)
# ---------------------------------------------------------------------------


def test_forbidden_exception_has_403_status_code() -> None:
    exc = ForbiddenException()
    assert exc.status_code == status.HTTP_403_FORBIDDEN


def test_forbidden_exception_default_detail() -> None:
    exc = ForbiddenException()
    assert exc.detail == "Permission denied"


def test_forbidden_exception_custom_detail() -> None:
    exc = ForbiddenException(detail="Insufficient permissions")
    assert exc.detail == "Insufficient permissions"


# ---------------------------------------------------------------------------
# RateLimitException (429)
# ---------------------------------------------------------------------------


def test_rate_limit_exception_has_429_status_code() -> None:
    exc = RateLimitException()
    assert exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS


def test_rate_limit_exception_default_detail() -> None:
    exc = RateLimitException()
    assert exc.detail == "Rate limit exceeded"


def test_rate_limit_exception_custom_detail() -> None:
    exc = RateLimitException(detail="Too many requests, slow down")
    assert exc.detail == "Too many requests, slow down"


# ---------------------------------------------------------------------------
# GuardrailException (422)
# ---------------------------------------------------------------------------


def test_guardrail_exception_has_422_status_code() -> None:
    exc = GuardrailException()
    assert exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_guardrail_exception_default_detail() -> None:
    exc = GuardrailException()
    assert exc.detail == "Prompt rejected by guardrails"


def test_guardrail_exception_custom_detail() -> None:
    exc = GuardrailException(detail="Injection attempt detected")
    assert exc.detail == "Injection attempt detected"


# ---------------------------------------------------------------------------
# UserAlreadyExistException (409)
# ---------------------------------------------------------------------------


def test_user_already_exist_exception_has_409_status_code() -> None:
    exc = UserAlreadyExistException()
    assert exc.status_code == status.HTTP_409_CONFLICT


def test_user_already_exist_exception_default_detail() -> None:
    exc = UserAlreadyExistException()
    assert exc.detail == "User already exists"


def test_user_already_exist_exception_custom_detail() -> None:
    exc = UserAlreadyExistException(detail="Email is already registered")
    assert exc.detail == "Email is already registered"


# ---------------------------------------------------------------------------
# LLMException (502)
# ---------------------------------------------------------------------------


def test_llm_exception_has_502_status_code() -> None:
    exc = LLMException()
    assert exc.status_code == status.HTTP_502_BAD_GATEWAY


def test_llm_exception_default_detail() -> None:
    exc = LLMException()
    assert exc.detail == "LLM service error"


def test_llm_exception_custom_detail() -> None:
    exc = LLMException(detail="OpenRouter returned 503")
    assert exc.detail == "OpenRouter returned 503"


# ---------------------------------------------------------------------------
# All exceptions are HTTPException subclasses (raise-ability check)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "exc_class,expected_status",
    [
        (NotFoundException, 404),
        (UnauthorizedException, 401),
        (ForbiddenException, 403),
        (RateLimitException, 429),
        (GuardrailException, 422),
        (UserAlreadyExistException, 409),
        (LLMException, 502),
    ],
)
def test_exception_status_codes_parametrized(exc_class: type, expected_status: int) -> None:
    exc = exc_class()
    assert exc.status_code == expected_status


@pytest.mark.parametrize(
    "exc_class",
    [
        NotFoundException,
        UnauthorizedException,
        ForbiddenException,
        RateLimitException,
        GuardrailException,
        UserAlreadyExistException,
        LLMException,
    ],
)
def test_exceptions_are_raisable(exc_class: type) -> None:
    with pytest.raises(exc_class):
        raise exc_class()
