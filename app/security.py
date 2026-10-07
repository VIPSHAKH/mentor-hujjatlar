import base64
import hashlib
import hmac
import secrets
import string
import time

import jwt

from app.config import settings

JWT_ALG = "HS256"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, salt_b64, dk_b64 = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), 310_000)
    return hmac.compare_digest(dk, base64.b64decode(dk_b64))


def generate_password(length: int = 8) -> str:
    # Chalkash belgilarsiz (0/O, 1/l/I)
    alphabet = "".join(c for c in string.ascii_lowercase + string.digits if c not in "0o1li")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_token(sub: str, kind: str, ttl_s: int, **extra) -> str:
    now = int(time.time())
    payload = {"sub": sub, "kind": kind, "iat": now, "exp": now + ttl_s, **extra}
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALG)


def decode_token(token: str, kind: str) -> dict:
    payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALG])
    if payload.get("kind") != kind:
        raise jwt.InvalidTokenError("wrong token kind")
    return payload


class LoginThrottle:
    """Bitta login uchun ketma-ket noto'g'ri urinishlarni cheklaydi (jarayon xotirasida)."""

    def __init__(self) -> None:
        self._fails: dict[str, list[float]] = {}

    def check(self, key: str) -> bool:
        now = time.time()
        fails = [t for t in self._fails.get(key, []) if now - t < settings.login_lock_s]
        self._fails[key] = fails
        return len(fails) < settings.max_login_attempts

    def fail(self, key: str) -> None:
        self._fails.setdefault(key, []).append(time.time())

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)


throttle = LoginThrottle()
