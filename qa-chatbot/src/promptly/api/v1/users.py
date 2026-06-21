from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse, error_responses
from promptly.core.exceptions import NotFoundException
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.repositories.user_repo import UserRepository
from promptly.schemas.user import AddCreditRequest, CreditResponse, UserResponse
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


@router.get(
    "/credits",
    response_model=SuccessResponse[CreditResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Get credit balance",
    description="Return the current credit balance for the authenticated user.",
    responses=error_responses(401, 500),
)
async def get_credits(
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CreditResponse]:
    """Get the current number of credits the user has left."""
    return SuccessResponse(data=CreditResponse(credits=current_user.credits))


@router.post(
    "/credits/add",
    response_model=SuccessResponse[CreditResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Add credits",
    description="Add credits to the authenticated user's account balance.",
    responses=error_responses(401, 404, 500),
)
async def add_credits(
    request: AddCreditRequest,
    current_user: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[CreditResponse]:
    """Add more credits to the current user."""
    user_repo = UserRepository(db)
    new_balance = await user_repo.add_credits(current_user.user_id, request.amount)
    if new_balance is None:
        raise NotFoundException(detail="User not found")
    current_user.credits = new_balance
    log.info("credits_added", amount=request.amount, balance=new_balance)
    return SuccessResponse(data=CreditResponse(credits=new_balance))
