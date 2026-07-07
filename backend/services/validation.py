"""Shared input-validation helpers.

Kept provider-agnostic and dependency-free so the same rules can be reused across
the register, reset-password, and change-password endpoints.
"""

# Minimum acceptable password length. Kept as a constant so the rule is stated
# once and reused by every caller and any future test.
_MIN_PASSWORD_LENGTH: int = 8


def validate_password(password: str) -> None:
    """Enforce the password policy: at least 8 characters including a digit.

    Args:
        password: The plaintext password to check.

    Raises:
        ValueError: If the password is too short or contains no digit. The
            message is safe to surface directly to the user.
    """
    # Length check first so the user sees the most fundamental problem.
    if len(password) < _MIN_PASSWORD_LENGTH:
        raise ValueError("Password must be at least 8 characters and include a digit.")

    # Require at least one numeric character anywhere in the password.
    has_digit: bool = any(character.isdigit() for character in password)

    if not has_digit:
        raise ValueError("Password must be at least 8 characters and include a digit.")
