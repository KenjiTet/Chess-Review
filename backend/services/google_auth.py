"""Google Sign-In (Google Identity Services) ID-token verification.

The frontend renders a Google button that returns a signed ID token (JWT). We
verify it here against our OAuth client id and extract the trusted email, so no
redirect flow or CORS/cookie handling is needed.
"""

import os

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

_GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")


def verify_google_token(token: str) -> str:
    """Verify a Google ID token and return the verified email address.

    Args:
        token: The credential (ID token JWT) returned by Google Identity Services.

    Returns:
        The verified, lowercased email address from the token.

    Raises:
        ValueError: If Google sign-in is not configured, the token is invalid,
            or the token carries no verified email. The message is safe to
            surface to the user.
    """
    if not _GOOGLE_CLIENT_ID:
        raise ValueError("Google sign-in is not configured.")

    try:
        # verify_oauth2_token checks the signature, audience, issuer and expiry.
        claims: dict = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), _GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise ValueError("Google sign-in failed. Please try again.")

    email: str | None = claims.get("email")
    email_verified: bool = bool(claims.get("email_verified", False))

    if email is None or not email_verified:
        raise ValueError("Your Google account has no verified email address.")

    return email.lower()
