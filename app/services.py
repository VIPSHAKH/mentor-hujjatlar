import asyncio
import hashlib
import logging
import re
from collections.abc import Iterable
from datetime import date, datetime

import httpx
from fastapi import HTTPException, Request
from sqlalchemy import and_, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    Admin,
    AdminRole,
    AuditLog,
    DocStatus,
    Document,
    DocumentType,
    Mentor,
    Notification,
)

log = logging.getLogger("app.services")

STATUS_LABEL = {
    DocStatus.MISSING: "Yuklanmagan",
    DocStatus.PENDING: "Tekshirilmoqda",
    DocStatus.APPROVED: "Tasdiqlangan",
    DocStatus.RETURNED: "Qayta yuklash kerak",
    DocStatus.REPLACED: "Almashtirilgan",
}
STATUS_ICON = {
    DocStatus.MISSING: "🟡",
    DocStatus.PENDING: "🔵",
    DocStatus.APPROVED: "🟢",
    DocStatus.RETURNED: "🔴",
    DocStatus.REPLACED: "⚪",
}

# Mentorning umumiy holati
OVERALL_COMPLETE = "COMPLETE"  # ✅ Hujjatlari to'liq tasdiqlangan
OVERALL_RETURNED = "RETURNED"  # 🔴 Qayta yuklashi kerak
OVERALL_MISSING = "MISSING"  # ⚠️ Hujjatlari to'liq emas
OVERALL_PENDING = "PENDING"  # 🔵 Tekshiruvda
OVERALL_LABEL = {
    OVERALL_COMPLETE: "To'liq tasdiqlangan",
    OVERALL_RETURNED: "Qayta yuklashi kerak",
    OVERALL_MISSING: "Hujjatlari to'liq emas",
    OVERALL_PENDING: "Tekshiruvda",
}


def overall_status(statuses: Iterable[DocStatus]) -> str:
    s = set(statuses)
    if not s or s == {DocStatus.APPROVED}:
        return OVERALL_COMPLETE
    if DocStatus.RETURNED in s:
        return OVERALL_RETURNED
    if DocStatus.MISSING in s:
        return OVERALL_MISSING
    return OVERALL_PENDING


# ----------------------------- Hujjat turlari -----------------------------

DEFAULT_DOC_TYPES = [
    ("passport", "Pasport yoki ID karta"),
    ("diploma", "Diplom"),
    ("certificate", "Xalqaro sertifikat"),
    ("objectivka", "Obektivka"),
]

DEFAULT_DISTRICTS = [
    "Bog‘ot tumani",
    "Gurlan tumani",
    "Hazorasp tumani",
    "Xonqa tumani",
    "Qo‘shko‘pir tumani",
    "Shovot tumani",
    "Tuproqqal’a tumani",
    "Urganch tumani",
    "Yangiariq tumani",
    "Yangibozor tumani",
    "Xiva tumani",
    "Urganch shahri",
    "Xiva shahri",
]


async def active_doc_types(db: AsyncSession, required_only: bool = False) -> list[DocumentType]:
    q = select(DocumentType).where(DocumentType.is_active.is_(True))
    if required_only:
        q = q.where(DocumentType.is_required.is_(True))
    return list((await db.scalars(q.order_by(DocumentType.sort_order, DocumentType.id))).all())


async def ensure_documents(db: AsyncSession, mentor_ids: list[int] | None = None) -> None:
    """Har bir mentor x faol hujjat turi uchun `documents` qatori bo'lishini ta'minlaydi (holati MISSING)."""
    sql = """
        INSERT INTO documents (mentor_id, doc_type_id, status)
        SELECT m.id, t.id, 'MISSING' FROM mentors m CROSS JOIN document_types t
        WHERE t.is_active {mentor_filter}
        ON CONFLICT (mentor_id, doc_type_id) DO NOTHING
    """
    params = {}
    if mentor_ids is not None:
        if not mentor_ids:
            return
        sql = sql.format(mentor_filter="AND m.id = ANY(:ids)")
        params["ids"] = mentor_ids
    else:
        sql = sql.format(mentor_filter="")
    await db.execute(text(sql), params)


async def mentor_overall(db: AsyncSession, mentor_id: int) -> str:
    rows = await db.scalars(
        select(Document.status)
        .join(DocumentType)
        .where(Document.mentor_id == mentor_id, DocumentType.is_active, DocumentType.is_required)
    )
    return overall_status(rows.all())


# ----------------------------- Fayllar -----------------------------

ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}


def sniff_file(data: bytes) -> str:
    """Kengaytmaga emas, fayl tarkibiga qarab turini aniqlaydi."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    raise HTTPException(400, "Faqat PDF, JPG, JPEG yoki PNG fayl yuklash mumkin")


def check_upload(data: bytes) -> tuple[str, str]:
    if not data:
        raise HTTPException(400, "Fayl bo'sh")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"Fayl hajmi {settings.max_upload_mb} MB dan oshmasligi kerak")
    return sniff_file(data), hashlib.sha256(data).hexdigest()


_SAFE = re.compile(r"[^\w\s.\-‘’'()]+", re.UNICODE)


def safe_filename(name: str) -> str:
    name = _SAFE.sub("", name).strip().replace("/", "_")
    return name[:150] or "fayl"


# ----------------------------- Telefon -----------------------------


def normalize_phone(raw: str | None) -> str | None:
    if raw is None:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if not digits:
        return None
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) != 12 or not digits.startswith("998"):
        raise ValueError(f"Telefon raqami noto'g'ri: {raw}")
    return "+" + digits


def parse_date(raw) -> date | None:
    if raw in (None, ""):
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Sana noto'g'ri: {raw}")


# ----------------------------- Bildirishnomalar -----------------------------

_bg_tasks: set[asyncio.Task] = set()


async def _send_telegram(chat_id: int, text_: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text_},
            )
    except Exception:
        log.exception("Telegram xabarini yuborib bo'lmadi")


def _telegram(chat_id: int | None, title: str, body: str | None) -> None:
    if not settings.bot_token or not chat_id:
        return
    task = asyncio.create_task(_send_telegram(chat_id, f"{title}\n{body}" if body else title))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


def notify_mentor(db: AsyncSession, mentor: Mentor, kind: str, title: str, body: str | None = None) -> None:
    db.add(Notification(mentor_id=mentor.id, kind=kind, title=title, body=body, link="/kabinet"))
    _telegram(mentor.telegram_chat_id, title, body)


async def notify_admins(
    db: AsyncSession, district_id: int, kind: str, title: str, body: str | None = None, link: str | None = None
) -> None:
    admins = await db.scalars(
        select(Admin).where(
            Admin.is_active.is_(True),
            or_(Admin.role != AdminRole.DISTRICT, and_(Admin.role == AdminRole.DISTRICT, Admin.district_id == district_id)),
        )
    )
    for a in admins:
        db.add(Notification(admin_id=a.id, kind=kind, title=title, body=body, link=link))
        _telegram(a.telegram_chat_id, title, body)


# ----------------------------- Amallar tarixi -----------------------------


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def audit(
    db: AsyncSession,
    actor: Admin | Mentor | None,
    action: str,
    *,
    mentor_id: int | None = None,
    details: dict | None = None,
    request: Request | None = None,
) -> None:
    if isinstance(actor, Admin):
        actor_type, name = "admin", actor.full_name or actor.username
    elif isinstance(actor, Mentor):
        actor_type, name = "mentor", actor.full_name
    else:
        actor_type, name = "system", None
    db.add(
        AuditLog(
            actor_type=actor_type,
            actor_id=getattr(actor, "id", None),
            actor_name=name,
            action=action,
            mentor_id=mentor_id,
            details=details,
            ip=client_ip(request),
        )
    )
