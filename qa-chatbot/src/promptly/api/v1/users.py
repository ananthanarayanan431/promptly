from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse, error_responses
from promptly.core.exceptions import NotFoundException
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.repositories.user_repo import UserRepository
from promptly.schemas.user import AddTokenRequest, TokenResponse, UserResponse, UserSettingsPatch
from promptly.utils.log import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


@router.get(
    "/me",
    response_model=SuccessResponse[UserResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Get current user",
    description="Return the authenticated user's profile including email, token balance, and account creation date.",  # noqa: E501
    responses=error_responses(401, 500),
)
async def get_me(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[UserResponse]:
    """Get the currently logged in user information."""
    repo = UserRepository(db)
    user = await repo.get_by_id(current_user.user_id)
    if user is None:
        raise NotFoundException(detail="User not found")
    return SuccessResponse(data=UserResponse.model_validate(user))


@router.patch(
    "/me",
    response_model=SuccessResponse[UserResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Update current user settings",
    description="Update user-controlled settings such as data sharing preference.",
    responses=error_responses(401, 404, 500),
)
async def patch_me(
    body: UserSettingsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[UserResponse]:
    repo = UserRepository(db)
    user = await repo.get_by_id(current_user.user_id)
    if user is None:
        raise NotFoundException(detail="User not found")
    if body.data_sharing_enabled is not None:
        user = await repo.update(user, data_sharing_enabled=body.data_sharing_enabled)
    await db.commit()
    return SuccessResponse(data=UserResponse.model_validate(user))


@router.get(
    "/tokens",
    response_model=SuccessResponse[TokenResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Get token balance",
    description="Return the current token balance for the authenticated user.",
    responses=error_responses(401, 500),
)
async def get_tokens(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[TokenResponse]:
    """Get the current token balance for the logged-in user."""
    repo = UserRepository(db)
    user = await repo.get_by_id(current_user.user_id)
    if user is None:
        raise NotFoundException(detail="User not found")
    return SuccessResponse(data=TokenResponse(token_balance=user.token_balance))


@router.post(
    "/tokens/add",
    response_model=SuccessResponse[TokenResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Add tokens",
    description="Add tokens to the authenticated user's balance (admin / top-up use).",
    responses=error_responses(401, 404, 500),
)
async def add_tokens(
    request: AddTokenRequest,
    current_user: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[TokenResponse]:
    """Add tokens to the current user's balance."""
    user_repo = UserRepository(db)
    await user_repo.add_tokens(current_user.user_id, request.amount)
    await db.commit()
    user = await user_repo.get_by_id(current_user.user_id)
    if user is None:
        raise NotFoundException(detail="User not found")
    log.info("tokens_added", amount=request.amount, balance=user.token_balance)
    return SuccessResponse(data=TokenResponse(token_balance=user.token_balance))
