from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_async_session
from app.repositories.user_repo import UserRepository
from app.schemas.auth import Token, UserCreate, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=SuccessResponse[UserResponse])
async def register(
    user_in: UserCreate, db: Annotated[AsyncSession, Depends(get_async_session)]
) -> SuccessResponse[UserResponse]:
    user_repo = UserRepository(db)
    user = await user_repo.get_by_email(email=user_in.email)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )

    hashed_password = hash_password(user_in.password)
    new_user = await user_repo.create(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name,
    )

    await db.commit()

    return SuccessResponse(data=UserResponse.model_validate(new_user))


@router.post("/login", response_model=SuccessResponse[Token])
async def login_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_async_session)],
) -> SuccessResponse[Token]:
    user_repo = UserRepository(db)
    user = await user_repo.get_by_email(email=form_data.username)
    if not user or not user.hashed_password:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    access_token = create_access_token(subject=str(user.id))
    return SuccessResponse(data=Token(access_token=access_token, token_type="bearer"))
