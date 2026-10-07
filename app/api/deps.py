from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Admin, AdminRole, Mentor
from app.security import decode_token

DB = Annotated[AsyncSession, Depends(get_db)]


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Avtorizatsiya talab qilinadi")
    return authorization[7:]


async def current_admin(db: DB, authorization: Annotated[str | None, Header()] = None) -> Admin:
    try:
        payload = decode_token(_bearer(authorization), "admin")
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessiya tugagan, qayta kiring")
    admin = await db.get(Admin, int(payload["sub"]))
    if admin is None or not admin.is_active:
        raise HTTPException(401, "Admin topilmadi yoki faol emas")
    return admin


async def current_mentor(db: DB, authorization: Annotated[str | None, Header()] = None) -> Mentor:
    try:
        payload = decode_token(_bearer(authorization), "mentor")
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessiya tugagan, qayta kiring")
    mentor = await db.get(Mentor, int(payload["sub"]))
    if mentor is None or not mentor.is_active:
        raise HTTPException(401, "Hisob faol emas")
    return mentor


async def super_admin(admin: Annotated[Admin, Depends(current_admin)]) -> Admin:
    if admin.role != AdminRole.SUPER:
        raise HTTPException(403, "Faqat super administrator uchun")
    return admin


async def full_admin(admin: Annotated[Admin, Depends(current_admin)]) -> Admin:
    if admin.role == AdminRole.DISTRICT:
        raise HTTPException(403, "Tuman administratori uchun ruxsat yo'q")
    return admin


CurrentAdmin = Annotated[Admin, Depends(current_admin)]
SuperAdmin = Annotated[Admin, Depends(super_admin)]
FullAdmin = Annotated[Admin, Depends(full_admin)]
CurrentMentor = Annotated[Mentor, Depends(current_mentor)]


def district_scope(admin: Admin) -> int | None:
    """Tuman administratori faqat o'z tumanini ko'radi."""
    return admin.district_id if admin.role == AdminRole.DISTRICT else None


def ensure_mentor_access(admin: Admin, mentor: Mentor | None) -> Mentor:
    if mentor is None:
        raise HTTPException(404, "Mentor topilmadi")
    scope = district_scope(admin)
    if scope is not None and mentor.district_id != scope:
        raise HTTPException(404, "Mentor topilmadi")
    return mentor
