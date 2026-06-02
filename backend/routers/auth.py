"""Auth router — login and registration endpoints."""

import requests as req_lib
from fastapi import APIRouter, HTTPException
from jose import jwt as _jwt

from models import AuthRequest, AuthResponse
from services.chess_com import get_player_profile
from services.jwt_service import create_token
from services.users import check_password, create_user

router = APIRouter()


@router.post("/login")
def login(req: AuthRequest) -> AuthResponse:
    """Verify credentials and return a signed JWT on success.

    Args:
        req: AuthRequest with username and password.

    Returns:
        AuthResponse with success flag, message, and JWT token.

    Raises:
        401 if credentials are invalid.
    """
    if not check_password(req.username, req.password):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token: str = create_token(req.username)
    # Peek at the payload to include is_admin in the response without re-importing the secret logic.
    payload: dict = _jwt.get_unverified_claims(token)
    is_admin: bool = bool(payload.get("is_admin", False))

    return AuthResponse(
        success=True,
        username=req.username,
        message="Login successful.",
        token=token,
        is_admin=is_admin,
    )


@router.post("/register")
def register(req: AuthRequest) -> AuthResponse:
    """Create a new account.

    Password must be at least 5 characters. Username must exist on Chess.com.

    Args:
        req: AuthRequest with username and password.

    Returns:
        AuthResponse with success flag and message.

    Raises:
        400 if password is too short, username is already taken, or Chess.com username not found.
        502 if Chess.com cannot be reached to verify the username.
    """
    if len(req.password) < 5:
        raise HTTPException(status_code=400, detail="Password must be at least 5 characters.")

    # Verify the username exists on Chess.com before creating the account.
    try:
        get_player_profile(req.username)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Chess.com username '{req.username}' does not exist. Please check and try again.",
        )
    except req_lib.RequestException:
        raise HTTPException(status_code=502, detail="Could not verify Chess.com username. Please try again.")

    try:
        create_user(req.username, req.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return AuthResponse(success=True, username=req.username, message="Account created.")
