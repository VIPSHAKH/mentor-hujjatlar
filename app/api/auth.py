from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.api.deps import DB
from app.config import settings
from app.models import Admin, Mentor
from app.security import create_token, throttle, verify_password
from app.services import audit, normalize_phone

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    login: str
    password: str


def _check_throttle(key: str) -> None:
    if not throttle.check(key):
        raise HTTPException(429, "Juda ko'p noto'g'ri urinish. Birozdan keyin qayta urinib ko'ring.")


@router.post("/admin/login")
async def admin_login(body: LoginIn, db: DB, request: Request):
    key = f"admin:{body.login.lower()}"
    _check_throttle(key)
    admin = await db.scalar(select(Admin).where(func.lower(Admin.username) == body.login.strip().lower()))
    if admin is None or not admin.is_active or not verify_password(body.password, admin.password_hash):
        throttle.fail(key)
        raise HTTPException(401, "Login yoki parol noto'g'ri")
    throttle.reset(key)
    audit(db, admin, "admin.login", request=request)
    await db.commit()
    return {"token": create_token(str(admin.id), "admin", settings.admin_token_ttl_s)}


@router.post("/mentor/login")
async def mentor_login(body: LoginIn, db: DB, request: Request):
    raw = body.login.strip()
    key = f"mentor:{raw.lower()}"
    _check_throttle(key)
    conds = [func.lower(Mentor.login) == raw.lower()]
    try:
        if phone := normalize_phone(raw):
            conds.append(Mentor.phone == phone)
    except ValueError:
        pass
    mentor = await db.scalar(select(Mentor).where(or_(*conds)))
    if mentor is None or not mentor.is_active or not verify_password(body.password, mentor.password_hash):
        throttle.fail(key)
        raise HTTPException(401, "Login (telefon) yoki parol noto'g'ri")
    throttle.reset(key)
    mentor.last_login_at = func.now()
    audit(db, mentor, "mentor.login", mentor_id=mentor.id, request=request)
    await db.commit()
    return {"token": create_token(str(mentor.id), "mentor", settings.mentor_token_ttl_s)}
