"""Auth router — login, registration, account linking, and passwordless identification."""

import requests as req_lib
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt as _jwt

from models import AuthRequest, AuthResponse, IdentifyRequest, LinkAccountRequest, RegisterRequest
from services.chess_com import get_player_profile as chesscom_get_profile
import services.lichess as lichess_svc
from services.jwt_service import create_token, get_current_user
from services.users import check_password, create_user, get_user, set_linked_accounts

router = APIRouter()


def _verify_platform_username(platform: str, username: str) -> str | None:
    """Verify a username exists on the given platform and return its avatar URL.

    Args:
        platform: "chesscom" or "lichess".
        username: The platform handle to verify.

    Returns:
        Avatar URL for Chess.com accounts, otherwise None.

    Raises:
        400 if the platform is unsupported or the username does not exist.
        502 if the platform API cannot be reached.
    """
    if platform == "chesscom":
        try:
            profile = chesscom_get_profile(username)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Chess.com username '{username}' does not exist. Please check and try again.",
            )
        except req_lib.RequestException:
            raise HTTPException(status_code=502, detail="Could not verify Chess.com username. Please try again.")

        return profile.get("avatar")

    if platform == "lichess":
        try:
            lichess_svc.get_player_profile(username)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Lichess username '{username}' does not exist. Please check and try again.",
            )
        except req_lib.RequestException:
            raise HTTPException(status_code=502, detail="Could not verify Lichess username. Please try again.")

        return None

    raise HTTPException(status_code=400, detail=f"Unsupported platform '{platform}'.")


def _linked_handles(username: str) -> tuple[str | None, str | None]:
    """Return the (chesscom_username, lichess_username) linked to an account.

    Args:
        username: Account username.

    Returns:
        Tuple of linked handles; each is None when not linked or the user is missing.
    """
    user = get_user(username)

    if user is None:
        return None, None

    return user.get("chesscom_username"), user.get("lichess_username")


@router.post("/login")
def login(req: AuthRequest) -> AuthResponse:
    """Verify credentials and return a signed JWT plus linked platform handles.

    Args:
        req: AuthRequest with username and password.

    Returns:
        AuthResponse with success flag, JWT token, and linked platform handles.

    Raises:
        401 if credentials are invalid.
    """
    if not check_password(req.username, req.password):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token: str = create_token(req.username)
    # Peek at the payload to include is_admin in the response without re-importing the secret logic.
    payload: dict = _jwt.get_unverified_claims(token)
    is_admin: bool = bool(payload.get("is_admin", False))

    chesscom_username, lichess_username = _linked_handles(req.username)

    return AuthResponse(
        success=True,
        username=req.username,
        message="Login successful.",
        token=token,
        is_admin=is_admin,
        chesscom_username=chesscom_username,
        lichess_username=lichess_username,
    )


@router.post("/register")
def register(req: RegisterRequest) -> AuthResponse:
    """Create a new account linked to one Chess.com / Lichess handle and auto-login.

    Password must be at least 5 characters. The linked platform_username must exist
    on the chosen platform.

    Args:
        req: RegisterRequest with username, password, platform, and platform_username.

    Returns:
        AuthResponse with a JWT token and the linked platform handle.

    Raises:
        400 if password is too short, username is taken, or the platform handle is invalid.
        502 if the platform API cannot be reached.
    """
    if len(req.password) < 5:
        raise HTTPException(status_code=400, detail="Password must be at least 5 characters.")

    # Verify the linked platform handle exists before creating the account.
    avatar: str | None = _verify_platform_username(req.platform, req.platform_username)

    chesscom_username: str | None = req.platform_username if req.platform == "chesscom" else None
    lichess_username: str | None = req.platform_username if req.platform == "lichess" else None

    try:
        create_user(req.username, req.password, chesscom_username, lichess_username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token: str = create_token(req.username)
    payload: dict = _jwt.get_unverified_claims(token)
    is_admin: bool = bool(payload.get("is_admin", False))

    return AuthResponse(
        success=True,
        username=req.username,
        message="Account created.",
        token=token,
        is_admin=is_admin,
        avatar=avatar,
        chesscom_username=chesscom_username,
        lichess_username=lichess_username,
    )


@router.post("/link")
def link(req: LinkAccountRequest, user: dict = Depends(get_current_user)) -> AuthResponse:
    """Link or change a platform handle on the authenticated account.

    Args:
        req: LinkAccountRequest with platform and platform_username.
        user: Injected JWT payload — identifies which account to update.

    Returns:
        AuthResponse with the account's updated linked handles.

    Raises:
        400 if the platform handle is invalid.
        502 if the platform API cannot be reached.
    """
    username: str = user["sub"]

    avatar: str | None = _verify_platform_username(req.platform, req.platform_username)

    chesscom_username: str | None = req.platform_username if req.platform == "chesscom" else None
    lichess_username: str | None = req.platform_username if req.platform == "lichess" else None

    set_linked_accounts(username, chesscom_username, lichess_username)

    new_chesscom, new_lichess = _linked_handles(username)

    return AuthResponse(
        success=True,
        username=username,
        message="Account linked.",
        is_admin=bool(user.get("is_admin", False)),
        avatar=avatar,
        chesscom_username=new_chesscom,
        lichess_username=new_lichess,
    )


@router.post("/identify")
def identify(req: IdentifyRequest) -> AuthResponse:
    """Passwordless identification — validate the username exists on the platform and return a JWT.

    This is the guest path: no account is created or required.

    Args:
        req: IdentifyRequest with username and platform ("chesscom" | "lichess").

    Returns:
        AuthResponse with success flag, JWT token, and is_admin flag.

    Raises:
        400 if the username does not exist on the platform.
        502 if the platform API cannot be reached.
    """
    avatar: str | None = _verify_platform_username(req.platform, req.username)

    token: str = create_token(req.username)
    payload: dict = _jwt.get_unverified_claims(token)
    is_admin: bool = bool(payload.get("is_admin", False))

    return AuthResponse(
        success=True,
        username=req.username,
        message="Identified.",
        token=token,
        is_admin=is_admin,
        avatar=avatar,
    )
