from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.user import AddCreditRequest, CreditResponse, UserResponse

router = APIRouter(prefix="/users", tags=["users"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


@router.get(
    "/me", response_model=SuccessResponse[UserResponse], dependencies=[Depends(_default_limiter)]
)
async def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[UserResponse]:
    """Get the currently logged in user information."""
    return SuccessResponse(data=UserResponse.model_validate(current_user))


@router.get(
    "/credits",
    response_model=SuccessResponse[CreditResponse],
    dependencies=[Depends(_default_limiter)],
)
async def get_credits(
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[CreditResponse]:
    """Get the current number of credits the user has left."""
    return SuccessResponse(data=CreditResponse(credits=current_user.credits))


@router.post(
    "/credits/add",
    response_model=SuccessResponse[CreditResponse],
    dependencies=[Depends(_default_limiter)],
)
async def add_credits(
    request: AddCreditRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[CreditResponse]:
    """Add more credits to the current user."""
    current_user.credits += request.amount
    return SuccessResponse(data=CreditResponse(credits=current_user.credits))
