"""JWT creation and verification utilities.

JWT_SECRET env var controls the signing key — set a strong secret in production.
ADMIN_USERNAME env var controls which account gets is_admin=True in the token.
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

_SECRET: str = os.getenv("JWT_SECRET", "change-me-in-production")
_ALGORITHM: str = "HS256"
_EXPIRE_DAYS: int = 30
_ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "").lower()

# HTTPBearer extracts the token from the Authorization: Bearer <token> header.
_bearer_scheme = HTTPBearer()


def create_token(username: str) -> str:
    """Return a signed JWT for the given username.

    Args:
        username: The authenticated user's display name.

    Returns:
        Encoded JWT string.
    """
    is_admin: bool = username.lower() == _ADMIN_USERNAME
    payload: dict = {
        "sub": username,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(days=_EXPIRE_DAYS),
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTPException 401 on failure."""
    try:
        return jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme)) -> dict:
    """FastAPI dependency — decode the JWT and return the payload dict.

    Args:
        credentials: Injected by HTTPBearer from the Authorization header.

    Returns:
        Decoded JWT payload with at least {"sub": username, "is_admin": bool}.
    """
    return _decode_token(credentials.credentials)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency — allow only admin users through.

    Args:
        user: Injected by get_current_user.

    Returns:
        The user payload if is_admin is True.

    Raises:
        403 Forbidden if the user is not an admin.
    """
    if not user.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return user
