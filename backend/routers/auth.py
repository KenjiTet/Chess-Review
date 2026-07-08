"""Auth router — email login/registration, email confirmation, password reset,
Google sign-in, account linking, deletion, and passwordless identification."""

import requests as req_lib
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt as _jwt

from models import (
    AuthRequest,
    AuthResponse,
    ChangePasswordRequest,
    ConfirmEmailRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    IdentifyRequest,
    LinkAccountRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SetEmailRequest,
    SimpleResponse,
)
import services.analysis_queue as analysis_queue
from services.chess_com import get_player_profile as chesscom_get_profile
from services.email_service import send_confirmation, send_reset
from services.google_auth import verify_google_token
from services.jwt_service import create_token, get_current_user
import services.lichess as lichess_svc
from services.tokens import consume_token, create_token_row, peek_token_username
from services.users import (
    check_password,
    create_user,
    delete_user,
    email_exists,
    get_or_create_google_user,
    get_user,
    get_user_by_email,
    record_login,
    set_email_verified,
    set_linked_accounts,
    set_password,
    set_user_email,
)
from services.validation import validate_password

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


def _token_claims(token: str) -> tuple[bool, bool]:
    """Read is_admin and email_verified from a freshly minted token.

    Peeks at the unverified claims to avoid re-running the admin/verification
    lookups the token was just built from.

    Args:
        token: A JWT produced by create_token.

    Returns:
        Tuple of (is_admin, email_verified).
    """
    payload: dict = _jwt.get_unverified_claims(token)
    return bool(payload.get("is_admin", False)), bool(payload.get("email_verified", False))


@router.post("/login")
def login(req: AuthRequest) -> AuthResponse:
    """Verify credentials and return a signed JWT plus linked platform handles.

    The identifier is normally an email, but legacy accounts created before the
    email migration have no email on file, so it also matches an account username
    as a fallback — keeping those users logged in.

    Args:
        req: AuthRequest with an email-or-username identifier and password.

    Returns:
        AuthResponse with success flag, JWT token, and linked platform handles.

    Raises:
        401 if credentials are invalid.
    """
    identifier: str = req.email.strip()

    # Prefer an email match; fall back to a username match for legacy accounts.
    account = get_user_by_email(identifier)
    username: str | None = account["username"] if account is not None else None

    if username is None:
        legacy = get_user(identifier)
        username = legacy["username"] if legacy is not None else None

    if username is None or not check_password(username, req.password):
        raise HTTPException(status_code=401, detail="Invalid email/username or password.")

    record_login(username)

    # Reload the resolved account so the response carries its real email/provider,
    # whether the user logged in by email or by legacy username.
    user = get_user(username)
    token: str = create_token(username)
    is_admin, email_verified = _token_claims(token)

    return AuthResponse(
        success=True,
        username=username,
        message="Login successful.",
        token=token,
        is_admin=is_admin,
        email=user["email"] if user is not None else None,
        email_verified=email_verified,
        auth_provider=user["auth_provider"] if user is not None else "password",
        chesscom_username=user["chesscom_username"] if user is not None else None,
        lichess_username=user["lichess_username"] if user is not None else None,
    )


@router.post("/register")
def register(req: RegisterRequest) -> AuthResponse:
    """Create a new account linked to one Chess.com / Lichess handle and auto-login.

    Password must satisfy the policy (>= 8 chars, at least one digit). The linked
    platform_username must exist on the chosen platform. A confirmation email is
    sent; the account can be used immediately (soft confirmation).

    Args:
        req: RegisterRequest with email, password, platform, and platform_username.

    Returns:
        AuthResponse with a JWT token and the linked platform handle.

    Raises:
        400 if the password is weak, the email is taken, or the platform handle is invalid.
        502 if the platform API cannot be reached.
    """
    # Enforce the password policy before doing any external work.
    try:
        validate_password(req.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if email_exists(req.email):
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    # Verify the linked platform handle exists before creating the account.
    avatar: str | None = _verify_platform_username(req.platform, req.platform_username)

    chesscom_username: str | None = req.platform_username if req.platform == "chesscom" else None
    lichess_username: str | None = req.platform_username if req.platform == "lichess" else None

    try:
        username: str = create_user(req.email, req.password, chesscom_username, lichess_username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Issue and email a confirmation link (no-op locally without RESEND_API_KEY).
    confirm_token: str = create_token_row(username, "confirm")
    send_confirmation(req.email.lower(), confirm_token)

    record_login(username)

    token: str = create_token(username)
    is_admin, email_verified = _token_claims(token)

    return AuthResponse(
        success=True,
        username=username,
        message="Account created.",
        token=token,
        is_admin=is_admin,
        avatar=avatar,
        email=req.email.lower(),
        email_verified=email_verified,
        auth_provider="password",
        chesscom_username=chesscom_username,
        lichess_username=lichess_username,
    )


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest) -> SimpleResponse:
    """Send a password-reset link if the email belongs to a password account.

    Always returns success so the endpoint cannot be used to probe which emails
    are registered (no user enumeration).

    Args:
        req: ForgotPasswordRequest with the account email.

    Returns:
        SimpleResponse — success regardless of whether the email exists.
    """
    account = get_user_by_email(req.email)

    # Only password accounts have something to reset; Google users sign in via Google.
    if account is not None and account["auth_provider"] == "password":
        reset_token: str = create_token_row(account["username"], "reset")
        send_reset(req.email.lower(), reset_token)

    return SimpleResponse(
        success=True,
        message="If an account exists for that email, a reset link is on its way.",
    )


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest) -> SimpleResponse:
    """Set a new password using a valid reset token.

    Args:
        req: ResetPasswordRequest with the reset token and new password.

    Returns:
        SimpleResponse on success.

    Raises:
        400 if the token is invalid/expired or the new password is weak.
    """
    # Validate the new password BEFORE consuming the token, so a rejected weak
    # password doesn't burn the single-use reset link and force a new request.
    try:
        validate_password(req.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    username: str | None = consume_token(req.token, "reset")

    if username is None:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")

    set_password(username, req.new_password)

    return SimpleResponse(success=True, message="Your password has been reset. You can now log in.")


@router.post("/confirm-email")
def confirm_email(req: ConfirmEmailRequest) -> SimpleResponse:
    """Confirm an email address using a valid confirmation token.

    Args:
        req: ConfirmEmailRequest with the confirmation token.

    Returns:
        SimpleResponse on success.

    Raises:
        400 if the token is invalid or has expired.
    """
    username: str | None = consume_token(req.token, "confirm")

    # Idempotency: a confirm link clicked twice (or re-fetched after a reload)
    # consumes on the first hit, then returns None here. Rather than showing a
    # misleading "invalid or expired" error, resolve the token's owner and, if
    # their email is already verified, treat the repeat click as a success.
    if username is None:
        owner: str | None = peek_token_username(req.token, "confirm")

        if owner is not None:
            account = get_user(owner)

            if account is not None and account["email_verified"]:
                return SimpleResponse(
                    success=True,
                    message="Your email is confirmed. Thanks!",
                    email=account["email"],
                    email_verified=True,
                )

        raise HTTPException(status_code=400, detail="This confirmation link is invalid or has expired.")

    set_email_verified(username)

    # Return the confirmed email so the frontend can update its store even when
    # the link is opened in a session that didn't have the email loaded.
    account = get_user(username)

    return SimpleResponse(
        success=True,
        message="Your email is confirmed. Thanks!",
        email=account["email"] if account is not None else None,
        email_verified=True,
    )


@router.post("/resend-confirmation")
def resend_confirmation(user: dict = Depends(get_current_user)) -> SimpleResponse:
    """Re-send the confirmation email for the authenticated account.

    Args:
        user: Injected JWT payload.

    Returns:
        SimpleResponse — success whether or not a new email was needed.
    """
    username: str = user["sub"]
    account = get_user(username)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    # Nothing to do if the email is already confirmed or there is no email on file.
    if account["email_verified"] or account["email"] is None:
        return SimpleResponse(success=True, message="Your email is already confirmed.")

    confirm_token: str = create_token_row(username, "confirm")
    send_confirmation(account["email"], confirm_token)

    return SimpleResponse(success=True, message="Confirmation email sent. Please check your inbox.")


@router.post("/set-email")
def set_email(req: SetEmailRequest, user: dict = Depends(get_current_user)) -> SimpleResponse:
    """Add or change the authenticated account's email, then send a confirmation.

    This is how legacy username-only accounts gain an email (unlocking password
    reset and confirmation). The new email must be unused by another account.

    Args:
        req: SetEmailRequest with the new email.
        user: Injected JWT payload.

    Returns:
        SimpleResponse on success.

    Raises:
        400 if the email is malformed or already used by a different account.
    """
    username: str = user["sub"]
    new_email: str = req.email.strip().lower()

    # Minimal shape check — a full RFC validator isn't worth the dependency here.
    if "@" not in new_email or "." not in new_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    # Reject an email already tied to a different account.
    existing = get_user_by_email(new_email)

    if existing is not None and existing["username"].lower() != username.lower():
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    set_user_email(username, new_email)

    # Send a fresh confirmation for the newly set address.
    confirm_token: str = create_token_row(username, "confirm")
    send_confirmation(new_email, confirm_token)

    return SimpleResponse(success=True, message="Email saved. Check your inbox to confirm it.")


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user)) -> SimpleResponse:
    """Change the authenticated account's password after verifying the current one.

    Args:
        req: ChangePasswordRequest with the current and new passwords.
        user: Injected JWT payload.

    Returns:
        SimpleResponse on success.

    Raises:
        400 if the account has no password (Google) or the new password is weak.
        401 if the current password is incorrect.
    """
    username: str = user["sub"]
    account = get_user(username)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    if account["auth_provider"] == "google":
        raise HTTPException(status_code=400, detail="Password change is not available for Google accounts.")

    if not check_password(username, req.current_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    try:
        validate_password(req.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    set_password(username, req.new_password)

    return SimpleResponse(success=True, message="Your password has been changed.")


@router.post("/google")
def google_login(req: GoogleAuthRequest) -> AuthResponse:
    """Sign in (or sign up) with a Google Identity Services ID token.

    Args:
        req: GoogleAuthRequest carrying the Google ID token.

    Returns:
        AuthResponse with a JWT token; needs_link is True when the account has no
        linked platform handle yet.

    Raises:
        400 if Google sign-in is not configured or the token is invalid.
    """
    try:
        email: str = verify_google_token(req.id_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    username, needs_link = get_or_create_google_user(email)
    record_login(username)

    token: str = create_token(username)
    is_admin, email_verified = _token_claims(token)

    chesscom_username, lichess_username = _linked_handles(username)

    return AuthResponse(
        success=True,
        username=username,
        message="Signed in with Google.",
        token=token,
        is_admin=is_admin,
        email=email,
        email_verified=email_verified,
        auth_provider="google",
        needs_link=needs_link,
        chesscom_username=chesscom_username,
        lichess_username=lichess_username,
    )


@router.delete("/account")
def delete_account(req: DeleteAccountRequest, user: dict = Depends(get_current_user)) -> SimpleResponse:
    """Permanently delete the authenticated account and all of its data.

    Password accounts must confirm with their current password; Google accounts
    may delete without one.

    Args:
        req: DeleteAccountRequest with an optional password confirmation.
        user: Injected JWT payload.

    Returns:
        SimpleResponse on success.

    Raises:
        401 if password confirmation is required and incorrect.
    """
    username: str = user["sub"]
    account = get_user(username)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    # Password accounts must re-authenticate before deletion.
    if account["auth_provider"] == "password":
        if req.password is None or not check_password(username, req.password):
            raise HTTPException(status_code=401, detail="Password is incorrect.")

    delete_user(username)

    return SimpleResponse(success=True, message="Your account has been deleted.")


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

    # Analysed-game rows are scoped per handle (and stats filter by the current
    # handle), so re-linking a different account neither mixes stats nor discards
    # the old handle's records — switching back to it shows its stats instantly
    # with no re-analysis. We just kick the queue so the (possibly new) handle's
    # games start analysing right away, with analysing spinners shown immediately.
    analysis_queue.notify_streams_changed(username.lower())

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
    is_admin, _ = _token_claims(token)

    # Guests get no scheduler stream (they have no users-table row), so kick a
    # shallow one-shot backfill here. The guest's handle doubles as their identity,
    # so stats recorded under it line up with what the frontend later queries.
    analysis_queue.enqueue_guest_backfill(req.username.lower(), req.platform, req.username)

    return AuthResponse(
        success=True,
        username=req.username,
        message="Identified.",
        token=token,
        is_admin=is_admin,
        avatar=avatar,
    )
