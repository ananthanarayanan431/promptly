import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from app.config.auth import get_auth_settings

auth_settings = get_auth_settings()

# ── Passwords ─────────────────────────────────────────────────


def hash_password(plain: str) -> str:
    pwd_bytes = plain.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    pwd_bytes = plain.encode("utf-8")
    return bcrypt.checkpw(pwd_bytes, hashed.encode("utf-8"))


# ── JWT ───────────────────────────────────────────────────────


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire, "iat": datetime.now(UTC)}
    return jwt.encode(
        payload,
        auth_settings.SECRET_KEY.get_secret_value(),
        algorithm=auth_settings.ALGORITHM,
    )


def decode_access_token(token: str) -> str:
    """Returns the subject (user id) or raises JWTError."""
    payload = jwt.decode(
        token,
        auth_settings.SECRET_KEY.get_secret_value(),
        algorithms=[auth_settings.ALGORITHM],
    )
    sub: str | None = payload.get("sub")
    if sub is None:
        raise JWTError("Missing subject")
    return sub


# ── API Keys ──────────────────────────────────────────────────


def generate_api_key() -> tuple[str, str]:
    """
    Returns (raw_key, hashed_key).
    Store only the hash in the DB; return the raw key once to the user.
    """
    raw = f"qac_{secrets.token_urlsafe(32)}"
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
