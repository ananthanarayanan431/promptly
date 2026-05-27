import hashlib
import secrets


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
