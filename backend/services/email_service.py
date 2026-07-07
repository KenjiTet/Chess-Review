"""Transactional email delivery via Resend's REST API.

Uses the already-present requests library rather than an email SDK. When
RESEND_API_KEY is unset (local dev), sending becomes a logged no-op so signup and
reset flows still work end-to-end — the token is visible in the server log and can
be pasted into the app manually.
"""

import logging
import os

import requests

logger = logging.getLogger("email_service")

_RESEND_API_URL: str = "https://api.resend.com/emails"
_RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
_EMAIL_FROM: str = os.getenv("EMAIL_FROM", "BlunderDrill <noreply@blunderdrill.com>")
_FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")


def send_email(to: str, subject: str, html: str) -> None:
    """Send a single HTML email through Resend.

    Args:
        to: Recipient email address.
        subject: Email subject line.
        html: HTML body of the message.
    """
    # No API key configured (local dev): log instead of sending so flows still work.
    if not _RESEND_API_KEY:
        logger.warning("RESEND_API_KEY unset — skipping email to %s. Subject: %s", to, subject)
        return

    payload: dict = {
        "from": _EMAIL_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    headers: dict = {
        "Authorization": f"Bearer {_RESEND_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(_RESEND_API_URL, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        # Never let an email failure break the calling auth flow — log and move on.
        logger.error("Failed to send email to %s: %s", to, exc)


def _link_for(param: str, token: str) -> str:
    """Build a frontend link carrying a token in a query param.

    Args:
        param: Query-param name ("confirm" or "reset").
        token: The token value to embed.

    Returns:
        Absolute URL the recipient clicks to complete the action.
    """
    return f"{_FRONTEND_URL}/?{param}={token}"


def send_confirmation(email: str, token: str) -> None:
    """Email a confirmation link for a newly registered account.

    Args:
        email: Recipient email address.
        token: Confirmation token to embed in the link.
    """
    link: str = _link_for("confirm", token)
    html: str = (
        "<h2>Confirm your email</h2>"
        "<p>Welcome to BlunderDrill! Please confirm your email address to finish setting up your account.</p>"
        f'<p><a href="{link}">Confirm my email</a></p>'
        f"<p>Or paste this link into your browser:<br>{link}</p>"
    )
    send_email(email, "Confirm your BlunderDrill email", html)


def send_reset(email: str, token: str) -> None:
    """Email a password-reset link.

    Args:
        email: Recipient email address.
        token: Reset token to embed in the link.
    """
    link: str = _link_for("reset", token)
    html: str = (
        "<h2>Reset your password</h2>"
        "<p>We received a request to reset your BlunderDrill password. "
        "If this wasn't you, you can safely ignore this email.</p>"
        f'<p><a href="{link}">Reset my password</a></p>'
        f"<p>Or paste this link into your browser:<br>{link}</p>"
        "<p>This link expires in 2 hours.</p>"
    )
    send_email(email, "Reset your BlunderDrill password", html)
