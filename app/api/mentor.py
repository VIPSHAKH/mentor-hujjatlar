from datetime import date

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from app.api.deps import DB, CurrentMentor
from app.config import settings
from app.documents import document_out, file_response, mentor_documents, upload_version
from app.models import Document, DocumentVersion, Notification
from app.security import hash_password, verify_password
from app.services import OVERALL_LABEL, audit, overall_status

router = APIRouter(prefix="/api/mentor", tags=["mentor"])


def profile_out(m) -> dict:
    return {
        "id": m.id,
        "full_name": m.full_name,
        "birth_date": m.birth_date,
        "phone": m.phone,
        "login": m.login,
        "passport": m.passport,
        "pinfl": m.pinfl,
        "district": {"id": m.district.id, "name": m.district.name},
        "direction": m.direction,
        "activity": m.activity,
    }


@router.get("/me")
async def me(mentor: CurrentMentor, db: DB):
    docs = await mentor_documents(db, mentor.id)
    overall = overall_status(d.status for d in docs if d.doc_type.is_required)
    unread = len(
        (
            await db.scalars(select(Notification.id).where(Notification.mentor_id == mentor.id, Notification.is_read.is_(False)))
        ).all()
    )
    return {
        "profile": profile_out(mentor),
        "documents": [document_out(d) for d in docs],
        "overall": overall,
        "overall_label": OVERALL_LABEL[overall],
        "unread_notifications": unread,
        "max_upload_mb": settings.max_upload_mb,
    }


class ProfileIn(BaseModel):
    birth_date: date | None = None
    passport: str | None = Field(None, max_length=20)
    pinfl: str | None = Field(None, pattern=r"^\d{14}$")
    direction: str | None = Field(None, max_length=200)
    activity: str | None = Field(None, max_length=5000)


@router.patch("/me")
async def update_profile(body: ProfileIn, mentor: CurrentMentor, db: DB, request: Request):
    changes = body.model_dump(exclude_unset=True)
    if "passport" in changes and changes["passport"]:
        changes["passport"] = changes["passport"].replace(" ", "").upper()
    for k, v in changes.items():
        setattr(mentor, k, v)
    audit(db, mentor, "mentor.profile_update", mentor_id=mentor.id, request=request, details={"fields": list(changes)})
    await db.commit()
    await db.refresh(mentor)
    return profile_out(mentor)


class PasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


@router.post("/password")
async def change_password(body: PasswordIn, mentor: CurrentMentor, db: DB, request: Request):
    if not verify_password(body.old_password, mentor.password_hash):
        raise HTTPException(400, "Joriy parol noto'g'ri")
    mentor.password_hash = hash_password(body.new_password)
    audit(db, mentor, "mentor.password_change", mentor_id=mentor.id, request=request)
    await db.commit()
    return {"ok": True}


@router.post("/documents/{type_code}")
async def upload(type_code: str, mentor: CurrentMentor, db: DB, request: Request, file: UploadFile = File(...)):
    data = await file.read(settings.max_upload_bytes + 1)
    await upload_version(db, mentor, type_code, data, file.filename or "", request)
    return {"ok": True, "message": "Hujjat muvaffaqiyatli yuklandi. Administrator tekshiruvini kuting."}


@router.get("/files/{version_id}")
async def get_file(version_id: int, mentor: CurrentMentor, db: DB, download: bool = False):
    v = await db.scalar(
        select(DocumentVersion).join(Document).where(DocumentVersion.id == version_id, Document.mentor_id == mentor.id)
    )
    if v is None:
        raise HTTPException(404, "Fayl topilmadi")
    return await file_response(v, download)


@router.get("/notifications")
async def notifications(mentor: CurrentMentor, db: DB):
    rows = await db.scalars(
        select(Notification).where(Notification.mentor_id == mentor.id).order_by(Notification.id.desc()).limit(100)
    )
    return [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "is_read": n.is_read, "created_at": n.created_at}
        for n in rows
    ]


@router.post("/notifications/read")
async def mark_read(mentor: CurrentMentor, db: DB):
    await db.execute(update(Notification).where(Notification.mentor_id == mentor.id).values(is_read=True))
    await db.commit()
    return {"ok": True}
