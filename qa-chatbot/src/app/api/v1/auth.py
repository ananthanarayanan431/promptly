from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.auth import InactiveUserException, InvalidCredentialsException
from app.core.exceptions import UserAlreadyExistException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.db.session import get_async_session
from app.repositories.user_repo import UserRepository
from app.schemas.auth import RefreshRequest, Token, UserCreate, UserResponse
from app.utils.log import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=SuccessResponse[UserResponse])
async def register(
    user_in: UserCreate, db: Annotated[AsyncSession, Depends(get_async_session)]
) -> SuccessResponse[UserResponse]:
    user_repo = UserRepository(db)
    user = await user_repo.get_by_email(email=user_in.email)
    if user:
        log.warning("register_email_taken", email=user_in.email)
        raise UserAlreadyExistException("The user with this email already exists in the system.")

    hashed_password = hash_password(user_in.password)
    new_user = await user_repo.create(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name,
    )

    await db.commit()
    log.info("user_registered", user_id=str(new_user.id), email=new_user.email)
    return SuccessResponse(data=UserResponse.model_validate(new_user))


@router.post("/login", response_model=SuccessResponse[Token])
async def login_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_async_session)],
) -> SuccessResponse[Token]:
    user_repo = UserRepository(db)
    user = await user_repo.get_by_email(email=form_data.username)
    if not user or not user.hashed_password:
        log.warning("login_failed", reason="user_not_found", email=form_data.username)
        raise InvalidCredentialsException()
    if not verify_password(form_data.password, user.hashed_password):
        log.warning("login_failed", reason="wrong_password", user_id=str(user.id))
        raise InvalidCredentialsException()
    if not user.is_active:
        log.warning("login_failed", reason="inactive_user", user_id=str(user.id))
        raise InactiveUserException()

    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))
    log.info("user_logged_in", user_id=str(user.id))
    return SuccessResponse(
        data=Token(access_token=access_token, refresh_token=refresh_token, token_type="bearer")
    )


@router.post("/refresh", response_model=SuccessResponse[Token])
async def refresh_access_token(
    body: RefreshRequest,
    db: Annotated[AsyncSession, Depends(get_async_session)],
) -> SuccessResponse[Token]:
    """Exchange a valid refresh token for a new access + refresh token pair."""
    try:
        user_id = decode_refresh_token(body.refresh_token)
    except JWTError as exc:
        log.warning("token_refresh_failed", reason="invalid_refresh_token")
        raise InvalidCredentialsException() from exc

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(__import__("uuid").UUID(user_id))
    if user is None or not user.is_active:
        log.warning("token_refresh_failed", reason="user_not_found_or_inactive", user_id=user_id)
        raise InvalidCredentialsException()

    access_token = create_access_token(subject=user_id)
    new_refresh_token = create_refresh_token(subject=user_id)
    log.info("token_refreshed", user_id=user_id)
    return SuccessResponse(
        data=Token(access_token=access_token, refresh_token=new_refresh_token, token_type="bearer")
    )
