import base64
import io
import zipfile
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Select, and_, case, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentAdmin, FullAdmin, SuperAdmin, district_scope, ensure_mentor_access
from app.documents import document_out, file_response, mentor_documents, review_version
from app.excel import build_workbook, import_template, parse_mentors_xlsx
from app.models import (
    Admin,
    AdminRole,
    AuditLog,
    District,
    DocStatus,
    Document,
    DocumentType,
    DocumentVersion,
    Mentor,
    Notification,
)
from app.security import generate_password, hash_password, verify_password
from app.services import (
    OVERALL_COMPLETE,
    OVERALL_LABEL,
    OVERALL_MISSING,
    OVERALL_PENDING,
    OVERALL_RETURNED,
    STATUS_LABEL,
    active_doc_types,
    audit,
    ensure_documents,
    normalize_phone,
    parse_date,
)
from app.storage import get_storage

router = APIRouter(prefix="/api/admin", tags=["admin"])


def admin_out(a: Admin) -> dict:
    return {
        "id": a.id,
        "username": a.username,
        "full_name": a.full_name,
        "role": a.role.value,
        "district": {"id": a.district.id, "name": a.district.name} if a.district else None,
        "telegram_chat_id": a.telegram_chat_id,
        "is_active": a.is_active,
    }


@router.get("/me")
async def me(admin: CurrentAdmin):
    return admin_out(admin)


class PasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


@router.post("/password")
async def change_password(body: PasswordIn, admin: CurrentAdmin, db: DB, request: Request):
    if not verify_password(body.old_password, admin.password_hash):
        raise HTTPException(400, "Joriy parol noto'g'ri")
    admin.password_hash = hash_password(body.new_password)
    audit(db, admin, "admin.password_change", request=request)
    await db.commit()
    return {"ok": True}


# ----------------------------- Mentor holatlari (SQL) -----------------------------


def _status_agg():
    """Har bir mentor bo'yicha majburiy hujjatlar holatlari soni."""
    s = Document.status
    return (
        select(
            Document.mentor_id.label("mentor_id"),
            func.count().filter(s == DocStatus.RETURNED).label("returned"),
            func.count().filter(s == DocStatus.MISSING).label("missing"),
            func.count().filter(s == DocStatus.PENDING).label("pending"),
            func.count().filter(s == DocStatus.APPROVED).label("approved"),
        )
        .join(DocumentType, DocumentType.id == Document.doc_type_id)
        .where(DocumentType.is_active.is_(True), DocumentType.is_required.is_(True))
        .group_by(Document.mentor_id)
        .subquery()
    )


def _overall_expr(agg):
    returned, missing, pending = (func.coalesce(agg.c[k], 0) for k in ("returned", "missing", "pending"))
    return case(
        (returned > 0, OVERALL_RETURNED),
        (missing > 0, OVERALL_MISSING),
        (pending > 0, OVERALL_PENDING),
        else_=OVERALL_COMPLETE,
    )


class MentorFilter(BaseModel):
    district_id: int | None = None
    q: str | None = None
    direction: str | None = None
    overall: str | None = None
    doc_type: str | None = None
    doc_status: DocStatus | None = None
    any_status: DocStatus | None = None
    active: bool | None = True


def _filtered(admin: Admin, f: MentorFilter) -> tuple[Select, object]:
    agg = _status_agg()
    overall = _overall_expr(agg).label("overall")
    q = select(Mentor, overall).outerjoin(agg, agg.c.mentor_id == Mentor.id)
    scope = district_scope(admin)
    if scope is not None:
        q = q.where(Mentor.district_id == scope)
    if f.district_id:
        q = q.where(Mentor.district_id == f.district_id)
    if f.active is not None:
        q = q.where(Mentor.is_active.is_(f.active))
    if f.q:
        like = f"%{f.q.strip()}%"
        q = q.where(
            or_(Mentor.full_name.ilike(like), Mentor.phone.ilike(like), Mentor.pinfl.ilike(like), Mentor.passport.ilike(like))
        )
    if f.direction:
        q = q.where(Mentor.direction == f.direction)
    if f.overall:
        q = q.where(overall == f.overall)
    if f.doc_type and f.doc_status:
        q = q.where(
            exists().where(
                Document.mentor_id == Mentor.id,
                Document.status == f.doc_status,
                Document.doc_type_id == select(DocumentType.id).where(DocumentType.code == f.doc_type).scalar_subquery(),
            )
        )
    if f.any_status:
        q = q.where(
            exists()
            .where(Document.mentor_id == Mentor.id, Document.status == f.any_status)
            .where(Document.doc_type_id == DocumentType.id, DocumentType.is_active.is_(True))
        )
    return q, overall


async def _doc_matrix(db, mentor_ids: list[int]) -> dict[int, dict[str, str]]:
    if not mentor_ids:
        return {}
    rows = await db.execute(
        select(Document.mentor_id, DocumentType.code, Document.status)
        .join(DocumentType)
        .where(Document.mentor_id.in_(mentor_ids), DocumentType.is_active.is_(True))
    )
    out: dict[int, dict[str, str]] = {}
    for mid, code, status in rows:
        out.setdefault(mid, {})[code] = status.value
    return out


def _mentor_row(m: Mentor, overall: str, docs: dict[str, str]) -> dict:
    return {
        "id": m.id,
        "full_name": m.full_name,
        "district": {"id": m.district.id, "name": m.district.name},
        "phone": m.phone,
        "direction": m.direction,
        "is_active": m.is_active,
        "docs": docs,
        "overall": overall,
        "overall_label": OVERALL_LABEL[overall],
    }


def _filter_params(
    district_id: int | None = None,
    q: str | None = None,
    direction: str | None = None,
    overall: str | None = None,
    doc_type: str | None = None,
    doc_status: DocStatus | None = None,
    any_status: DocStatus | None = None,
    active: bool | None = True,
) -> MentorFilter:
    return MentorFilter(
        district_id=district_id,
        q=q,
        direction=direction,
        overall=overall,
        doc_type=doc_type,
        doc_status=doc_status,
        any_status=any_status,
        active=active,
    )


@router.get("/mentors")
async def list_mentors(
    admin: CurrentAdmin,
    db: DB,
    district_id: int | None = None,
    q: str | None = None,
    direction: str | None = None,
    overall: str | None = None,
    doc_type: str | None = None,
    doc_status: DocStatus | None = None,
    any_status: DocStatus | None = None,
    active: bool | None = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    await ensure_documents(db)
    await db.commit()
    f = _filter_params(district_id, q, direction, overall, doc_type, doc_status, any_status, active)
    query, _ = _filtered(admin, f)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query.order_by(Mentor.full_name).offset((page - 1) * page_size).limit(page_size))).all()
    matrix = await _doc_matrix(db, [m.id for m, _ in rows])
    types = await active_doc_types(db)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "doc_types": [{"code": t.code, "name": t.name, "required": t.is_required} for t in types],
        "items": [_mentor_row(m, ov, matrix.get(m.id, {})) for m, ov in rows],
    }


@router.get("/mentors/export.xlsx")
async def export_mentors(
    admin: CurrentAdmin,
    db: DB,
    request: Request,
    district_id: int | None = None,
    q: str | None = None,
    direction: str | None = None,
    overall: str | None = None,
    doc_type: str | None = None,
    doc_status: DocStatus | None = None,
    any_status: DocStatus | None = None,
    active: bool | None = True,
):
    await ensure_documents(db)
    f = _filter_params(district_id, q, direction, overall, doc_type, doc_status, any_status, active)
    query, _ = _filtered(admin, f)
    query = query.join(District, District.id == Mentor.district_id).order_by(District.sort_order, District.name, Mentor.full_name)
    rows = (await db.execute(query)).all()
    matrix = await _doc_matrix(db, [m.id for m, _ in rows])
    types = await active_doc_types(db)
    headers = ["№", "Tuman", "F.I.Sh.", "Telefon"] + [f"{t.name} holati" for t in types] + ["Umumiy holat"]
    data, status_cols = [], {i + 4: [] for i in range(len(types) + 1)}
    for n, (m, ov) in enumerate(rows, start=1):
        docs = matrix.get(m.id, {})
        line = [n, m.district.name, m.full_name, m.phone or ""]
        for i, t in enumerate(types):
            st = docs.get(t.code, "MISSING")
            line.append(STATUS_LABEL[DocStatus(st)])
            status_cols[i + 4].append(st)
        line.append(OVERALL_LABEL[ov])
        status_cols[len(types) + 4].append(ov)
        data.append(line)
    content = build_workbook("Mentorlar", headers, data, status_cols)
    audit(
        db, admin, "export.mentors", request=request, details={"count": len(rows), **f.model_dump(exclude_none=True, mode="json")}
    )
    await db.commit()
    fname = f"mentorlar-{date.today().isoformat()}.xlsx"
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ----------------------------- Statistika -----------------------------


@router.get("/dashboard")
async def dashboard(admin: CurrentAdmin, db: DB):
    await ensure_documents(db)
    await db.commit()
    agg = _status_agg()
    overall = _overall_expr(agg)
    base = (
        select(
            District.id,
            District.name,
            func.count(Mentor.id).label("total"),
            func.count(Mentor.id).filter(overall == OVERALL_COMPLETE).label("complete"),
            func.count(Mentor.id).filter(overall != OVERALL_COMPLETE).label("incomplete"),
            func.count(Mentor.id).filter(overall == OVERALL_PENDING).label("pending"),
            func.count(Mentor.id).filter(func.coalesce(agg.c.returned, 0) > 0).label("returned"),
            func.count(Mentor.id).filter(func.coalesce(agg.c.missing, 0) > 0).label("missing"),
        )
        .select_from(District)
        .outerjoin(Mentor, and_(Mentor.district_id == District.id, Mentor.is_active.is_(True)))
        .outerjoin(agg, agg.c.mentor_id == Mentor.id)
        .group_by(District.id)
        .order_by(District.sort_order, District.name)
    )
    scope = district_scope(admin)
    if scope is not None:
        base = base.where(District.id == scope)
    districts = [dict(r._mapping) for r in (await db.execute(base)).all()]
    keys = ("total", "complete", "incomplete", "pending", "returned", "missing")
    totals = {k: sum(d[k] for d in districts) for k in keys}

    pv = (
        select(func.count(DocumentVersion.id))
        .join(Document)
        .join(Mentor)
        .where(DocumentVersion.status == DocStatus.PENDING, Mentor.is_active.is_(True))
    )
    if scope is not None:
        pv = pv.where(Mentor.district_id == scope)
    totals["pending_documents"] = await db.scalar(pv)

    by_type = (
        select(DocumentType.code, DocumentType.name, Document.status, func.count())
        .select_from(Document)
        .join(DocumentType)
        .join(Mentor)
        .where(DocumentType.is_active.is_(True), Mentor.is_active.is_(True))
        .group_by(DocumentType.code, DocumentType.name, DocumentType.sort_order, Document.status)
        .order_by(DocumentType.sort_order)
    )
    if scope is not None:
        by_type = by_type.where(Mentor.district_id == scope)
    types: dict[str, dict] = {}
    for code, name, status, cnt in (await db.execute(by_type)).all():
        t = types.setdefault(code, {"code": code, "name": name, **{s.value: 0 for s in DocStatus if s != DocStatus.REPLACED}})
        t[status.value] = cnt
    return {"totals": totals, "districts": districts, "doc_types": list(types.values())}


@router.get("/review-queue")
async def review_queue(admin: CurrentAdmin, db: DB, district_id: int | None = None, limit: int = Query(200, le=500)):
    q = (
        select(DocumentVersion, Document, Mentor)
        .join(Document, Document.id == DocumentVersion.document_id)
        .join(Mentor, Mentor.id == Document.mentor_id)
        .where(DocumentVersion.status == DocStatus.PENDING, Mentor.is_active.is_(True))
        .order_by(DocumentVersion.uploaded_at)
        .limit(limit)
    )
    scope = district_scope(admin)
    if scope is not None:
        q = q.where(Mentor.district_id == scope)
    if district_id:
        q = q.where(Mentor.district_id == district_id)
    out = []
    for v, d, m in (await db.execute(q)).all():
        out.append(
            {
                "version_id": v.id,
                "version_no": v.version_no,
                "uploaded_at": v.uploaded_at,
                "original_name": v.original_name,
                "content_type": v.content_type,
                "size": v.size,
                "doc_type": {"code": d.doc_type.code, "name": d.doc_type.name},
                "mentor": {"id": m.id, "full_name": m.full_name, "district": m.district.name},
            }
        )
    return out


# ----------------------------- Hududlar -----------------------------


@router.get("/districts")
async def list_districts(admin: CurrentAdmin, db: DB):
    q = (
        select(District, func.count(Mentor.id))
        .outerjoin(Mentor, and_(Mentor.district_id == District.id, Mentor.is_active.is_(True)))
        .group_by(District.id)
        .order_by(District.sort_order, District.name)
    )
    scope = district_scope(admin)
    if scope is not None:
        q = q.where(District.id == scope)
    return [{"id": d.id, "name": d.name, "sort_order": d.sort_order, "mentors": cnt} for d, cnt in (await db.execute(q)).all()]


class DistrictIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sort_order: int = 0


@router.post("/districts")
async def create_district(body: DistrictIn, admin: FullAdmin, db: DB, request: Request):
    d = District(name=body.name.strip(), sort_order=body.sort_order)
    db.add(d)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, "Bunday hudud mavjud")
    audit(db, admin, "district.create", request=request, details={"name": d.name})
    await db.commit()
    return {"id": d.id, "name": d.name, "sort_order": d.sort_order}


@router.patch("/districts/{district_id}")
async def update_district(district_id: int, body: DistrictIn, admin: FullAdmin, db: DB, request: Request):
    d = await db.get(District, district_id)
    if d is None:
        raise HTTPException(404, "Hudud topilmadi")
    d.name, d.sort_order = body.name.strip(), body.sort_order
    try:
        audit(db, admin, "district.update", request=request, details={"id": d.id, "name": d.name})
        await db.commit()
    except IntegrityError:
        raise HTTPException(409, "Bunday hudud mavjud")
    return {"id": d.id, "name": d.name, "sort_order": d.sort_order}


@router.delete("/districts/{district_id}")
async def delete_district(district_id: int, admin: FullAdmin, db: DB, request: Request):
    d = await db.get(District, district_id)
    if d is None:
        raise HTTPException(404, "Hudud topilmadi")
    if await db.scalar(select(func.count(Mentor.id)).where(Mentor.district_id == district_id)):
        raise HTTPException(409, "Hududda mentorlar bor, avval ularni boshqa hududga o'tkazing")
    await db.delete(d)
    audit(db, admin, "district.delete", request=request, details={"name": d.name})
    await db.commit()
    return {"ok": True}


@router.get("/directions")
async def directions(admin: CurrentAdmin, db: DB):
    rows = await db.scalars(select(Mentor.direction).where(Mentor.direction.is_not(None)).distinct().order_by(Mentor.direction))
    return [r for r in rows if r]


# ----------------------------- Hujjat turlari -----------------------------


def doc_type_out(t: DocumentType) -> dict:
    return {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "description": t.description,
        "is_required": t.is_required,
        "is_active": t.is_active,
        "sort_order": t.sort_order,
    }


@router.get("/document-types")
async def list_doc_types(admin: CurrentAdmin, db: DB):
    return [doc_type_out(t) for t in await db.scalars(select(DocumentType).order_by(DocumentType.sort_order, DocumentType.id))]


class DocTypeIn(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,39}$")
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    is_required: bool = True
    is_active: bool = True
    sort_order: int = 0


@router.post("/document-types")
async def create_doc_type(body: DocTypeIn, admin: SuperAdmin, db: DB, request: Request):
    t = DocumentType(**body.model_dump())
    db.add(t)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, "Bunday kodli hujjat turi mavjud")
    await ensure_documents(db)
    audit(db, admin, "doc_type.create", request=request, details=body.model_dump())
    await db.commit()
    return doc_type_out(t)


class DocTypeUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    description: str | None = None
    is_required: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


@router.patch("/document-types/{type_id}")
async def update_doc_type(type_id: int, body: DocTypeUpdate, admin: SuperAdmin, db: DB, request: Request):
    t = await db.get(DocumentType, type_id)
    if t is None:
        raise HTTPException(404, "Hujjat turi topilmadi")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    await db.flush()
    await ensure_documents(db)
    audit(db, admin, "doc_type.update", request=request, details={"id": t.id, **body.model_dump(exclude_unset=True)})
    await db.commit()
    return doc_type_out(t)


# ----------------------------- Mentorlar -----------------------------


class MentorIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=200)
    district_id: int
    birth_date: date | None = None
    phone: str | None = None
    login: str | None = Field(None, pattern=r"^[A-Za-z0-9_.\-]{3,64}$")
    passport: str | None = Field(None, max_length=20)
    pinfl: str | None = Field(None, pattern=r"^\d{14}$")
    direction: str | None = Field(None, max_length=200)
    activity: str | None = Field(None, max_length=5000)
    telegram_chat_id: int | None = None
    is_active: bool = True

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return normalize_phone(v) if v else None

    @field_validator("passport")
    @classmethod
    def _passport(cls, v):
        return v.replace(" ", "").upper() if v else None

    @field_validator("login", "pinfl", "direction", "activity", mode="before")
    @classmethod
    def _empty(cls, v):
        return v.strip() or None if isinstance(v, str) else v


class MentorUpdate(MentorIn):
    full_name: str | None = Field(None, min_length=3, max_length=200)
    district_id: int | None = None
    is_active: bool | None = None


def mentor_detail(m: Mentor) -> dict:
    return {
        "id": m.id,
        "full_name": m.full_name,
        "district": {"id": m.district.id, "name": m.district.name},
        "birth_date": m.birth_date,
        "phone": m.phone,
        "login": m.login,
        "passport": m.passport,
        "pinfl": m.pinfl,
        "direction": m.direction,
        "activity": m.activity,
        "telegram_chat_id": m.telegram_chat_id,
        "is_active": m.is_active,
        "has_password": bool(m.password_hash),
        "last_login_at": m.last_login_at,
        "created_at": m.created_at,
    }


async def _check_district(db, admin: Admin, district_id: int) -> District:
    d = await db.get(District, district_id)
    scope = district_scope(admin)
    if d is None or (scope is not None and d.id != scope):
        raise HTTPException(400, "Hudud topilmadi")
    return d


async def _commit_unique(db) -> None:
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        msg = str(e.orig)
        if "phone" in msg:
            raise HTTPException(409, "Bu telefon raqami boshqa mentorda bor")
        if "login" in msg:
            raise HTTPException(409, "Bu login band")
        raise HTTPException(409, "Ma'lumotlar takrorlanmoqda")


@router.post("/mentors")
async def create_mentor(body: MentorIn, admin: CurrentAdmin, db: DB, request: Request):
    await _check_district(db, admin, body.district_id)
    password = generate_password()
    m = Mentor(**body.model_dump(), password_hash=hash_password(password))
    db.add(m)
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            409, "Bu telefon raqami yoki login band" if "phone" in str(e.orig) or "login" in str(e.orig) else "Xato"
        )
    if not m.login and not m.phone:
        m.login = f"mentor{m.id}"
    await ensure_documents(db, [m.id])
    audit(db, admin, "mentor.create", mentor_id=m.id, request=request, details={"full_name": m.full_name})
    await _commit_unique(db)
    await db.refresh(m)
    return {"mentor": mentor_detail(m), "password": password}


@router.get("/mentors/{mentor_id}")
async def get_mentor(mentor_id: int, admin: CurrentAdmin, db: DB):
    m = ensure_mentor_access(admin, await db.get(Mentor, mentor_id))
    docs = await mentor_documents(db, m.id)
    from app.services import overall_status

    ov = overall_status(d.status for d in docs if d.doc_type.is_required)
    return {
        "mentor": mentor_detail(m),
        "documents": [document_out(d) for d in docs],
        "overall": ov,
        "overall_label": OVERALL_LABEL[ov],
    }


@router.patch("/mentors/{mentor_id}")
async def update_mentor(mentor_id: int, body: MentorUpdate, admin: CurrentAdmin, db: DB, request: Request):
    m = ensure_mentor_access(admin, await db.get(Mentor, mentor_id))
    changes = body.model_dump(exclude_unset=True)
    if changes.get("district_id"):
        await _check_district(db, admin, changes["district_id"])
    for k, v in changes.items():
        if k in ("full_name", "district_id", "is_active") and v is None:
            continue
        setattr(m, k, v)
    audit(db, admin, "mentor.update", mentor_id=m.id, request=request, details={"fields": list(changes)})
    await _commit_unique(db)
    await db.refresh(m)
    return mentor_detail(m)


@router.post("/mentors/{mentor_id}/reset-password")
async def reset_password(mentor_id: int, admin: CurrentAdmin, db: DB, request: Request):
    m = ensure_mentor_access(admin, await db.get(Mentor, mentor_id))
    password = generate_password()
    m.password_hash = hash_password(password)
    audit(db, admin, "mentor.password_reset", mentor_id=m.id, request=request)
    await db.commit()
    return {"login": m.phone or m.login, "password": password}


@router.delete("/mentors/{mentor_id}")
async def delete_mentor(mentor_id: int, admin: SuperAdmin, db: DB, request: Request):
    m = ensure_mentor_access(admin, await db.get(Mentor, mentor_id))
    keys = (await db.scalars(select(DocumentVersion.storage_key).join(Document).where(Document.mentor_id == m.id))).all()
    name = m.full_name
    await db.delete(m)
    audit(db, admin, "mentor.delete", request=request, details={"id": mentor_id, "full_name": name, "files": len(keys)})
    await db.commit()
    storage = get_storage()
    for k in keys:
        await storage.delete(k)
    return {"ok": True}


@router.get("/mentors/{mentor_id}/audit")
async def mentor_audit(mentor_id: int, admin: CurrentAdmin, db: DB):
    ensure_mentor_access(admin, await db.get(Mentor, mentor_id))
    rows = await db.scalars(select(AuditLog).where(AuditLog.mentor_id == mentor_id).order_by(AuditLog.id.desc()).limit(300))
    return [audit_out(a) for a in rows]


@router.get("/mentors/{mentor_id}/archive.zip")
async def mentor_archive(mentor_id: int, admin: CurrentAdmin, db: DB, request: Request, all_versions: bool = False):
    """Mentor papkasi: "Tuman/F.I.Sh./Pasport.pdf" ko'rinishidagi ZIP."""
    m = ensure_mentor_access(admin, await db.get(Mentor, mentor_id))
    docs = await mentor_documents(db, m.id)
    storage = get_storage()
    buf = io.BytesIO()
    folder = f"{m.district.name}/{m.full_name}"
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for d in docs:
            versions = d.versions if all_versions else d.versions[-1:]
            for v in versions:
                ext = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}[v.content_type]
                name = (
                    d.doc_type.name
                    if not all_versions
                    else f"{d.doc_type.name} ({v.version_no}-versiya, {STATUS_LABEL[v.status]})"
                )
                zf.writestr(f"{folder}/{name}{ext}", await storage.read(v.storage_key))
                count += 1
    audit(db, admin, "mentor.archive_download", mentor_id=m.id, request=request, details={"files": count})
    await db.commit()
    from urllib.parse import quote

    return Response(
        buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(m.full_name)}.zip",
            "Cache-Control": "private, no-store",
        },
    )


# ----------------------------- Hujjatlarni tekshirish -----------------------------


class ReturnIn(BaseModel):
    comment: str = Field(min_length=3, max_length=2000)


@router.post("/versions/{version_id}/approve")
async def approve(version_id: int, admin: CurrentAdmin, db: DB, request: Request):
    await review_version(db, admin, version_id, True, None, request)
    return {"ok": True}


@router.post("/versions/{version_id}/return")
async def return_doc(version_id: int, body: ReturnIn, admin: CurrentAdmin, db: DB, request: Request):
    await review_version(db, admin, version_id, False, body.comment, request)
    return {"ok": True}


@router.get("/files/{version_id}")
async def get_file(version_id: int, admin: CurrentAdmin, db: DB, request: Request, download: bool = False):
    v = await db.scalar(
        select(DocumentVersion)
        .where(DocumentVersion.id == version_id)
        .options(selectinload(DocumentVersion.document).selectinload(Document.mentor))
    )
    if v is None:
        raise HTTPException(404, "Fayl topilmadi")
    mentor = ensure_mentor_access(admin, v.document.mentor)
    if download:
        audit(db, admin, "document.download", mentor_id=mentor.id, request=request, details={"version_id": v.id})
        await db.commit()
    title = f"{mentor.full_name} - {v.document.doc_type.name}" if download else None
    return await file_response(v, download, title)


# ----------------------------- Excel import -----------------------------


@router.get("/import/template.xlsx")
async def template(admin: CurrentAdmin):
    return Response(
        import_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mentorlar-namuna.xlsx"'},
    )


def _district_key(name: str) -> str:
    import re

    n = name.lower().replace("‘", "'").replace("’", "'").replace("ʻ", "'").replace("`", "'")
    n = re.sub(r"\b(tumani|tuman)\b", "tumani", n)
    n = re.sub(r"\b(shahri|shahar)\b", "shahri", n)
    return re.sub(r"[^a-z0-9]", "", n)


@router.post("/import")
async def import_mentors(admin: CurrentAdmin, db: DB, request: Request, file: UploadFile = File(...), dry_run: bool = False):
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Fayl juda katta (10 MB gacha)")
    parsed = parse_mentors_xlsx(content)
    errors = list(parsed.errors)
    if not parsed.rows and errors:
        raise HTTPException(400, errors[0])

    districts = {_district_key(d.name): d for d in await db.scalars(select(District))}
    scope = district_scope(admin)
    created, updated, credentials, new_districts = 0, 0, [], []
    max_order = max((d.sort_order for d in districts.values()), default=0)

    for pr in parsed.rows:
        data = pr.data
        try:
            phone = normalize_phone(data.get("phone")) if data.get("phone") else None
            birth = parse_date(data.get("birth_date"))
        except ValueError as e:
            errors.append(f"{pr.row}-qator: {e}")
            continue
        pinfl = str(data.get("pinfl") or "").strip().split(".")[0] or None
        if pinfl and not pinfl.isdigit():
            errors.append(f"{pr.row}-qator: JSHSHIR faqat raqamlardan iborat bo'lishi kerak")
            continue
        key = _district_key(data["district"])
        district = districts.get(key)
        if district is None and not key.endswith(("tumani", "shahri")):
            # "Shovot" -> "Shovot tumani" (tuman ustun, keyin shahar)
            district = districts.get(key + "tumani") or districts.get(key + "shahri")
        if district is None:
            if scope is not None:
                errors.append(f"{pr.row}-qator: «{data['district']}» hududiga ruxsatingiz yo'q")
                continue
            max_order += 1
            district = District(name=data["district"], sort_order=max_order)
            db.add(district)
            await db.flush()
            districts[key] = district
            new_districts.append(district.name)
        if scope is not None and district.id != scope:
            errors.append(f"{pr.row}-qator: «{district.name}» hududiga ruxsatingiz yo'q")
            continue

        conds = []
        if phone:
            conds.append(Mentor.phone == phone)
        if pinfl:
            conds.append(Mentor.pinfl == pinfl)
        conds.append(and_(func.lower(Mentor.full_name) == data["full_name"].lower(), Mentor.district_id == district.id))
        mentor = await db.scalar(select(Mentor).where(or_(*conds)).limit(1))
        fields = {
            "full_name": data["full_name"],
            "district_id": district.id,
            "birth_date": birth,
            "phone": phone,
            "passport": str(data.get("passport") or "").replace(" ", "").upper() or None,
            "pinfl": pinfl,
            "direction": str(data.get("direction") or "").strip() or None,
            "activity": str(data.get("activity") or "").strip() or None,
        }
        if mentor is None:
            password = generate_password()
            mentor = Mentor(**fields, password_hash=hash_password(password))
            db.add(mentor)
            try:
                async with db.begin_nested():
                    await db.flush()
            except IntegrityError:
                errors.append(f"{pr.row}-qator: telefon raqami boshqa mentorda bor")
                continue
            if not phone:
                mentor.login = f"mentor{mentor.id}"
            created += 1
            credentials.append([district.name, mentor.full_name, phone or mentor.login, password])
        else:
            for k, v in fields.items():
                if v is not None:
                    setattr(mentor, k, v)
            try:
                async with db.begin_nested():
                    await db.flush()
            except IntegrityError:
                errors.append(f"{pr.row}-qator: telefon raqami boshqa mentorda bor")
                continue
            updated += 1

    if dry_run:
        await db.rollback()
    else:
        await ensure_documents(db)
        audit(
            db,
            admin,
            "mentor.import",
            request=request,
            details={"file": file.filename, "created": created, "updated": updated, "errors": len(errors)},
        )
        await db.commit()
    creds_xlsx = None
    if credentials and not dry_run:
        creds_xlsx = base64.b64encode(
            build_workbook("Kirish ma'lumotlari", ["Tuman", "F.I.Sh.", "Login (telefon)", "Parol"], credentials)
        ).decode()
    return {
        "created": created,
        "updated": updated,
        "new_districts": new_districts,
        "errors": errors,
        "dry_run": dry_run,
        "credentials_xlsx": creds_xlsx,
    }


# ----------------------------- Bildirishnomalar -----------------------------


@router.get("/notifications")
async def notifications(admin: CurrentAdmin, db: DB, limit: int = Query(50, le=200)):
    rows = await db.scalars(
        select(Notification).where(Notification.admin_id == admin.id).order_by(Notification.id.desc()).limit(limit)
    )
    unread = await db.scalar(
        select(func.count(Notification.id)).where(Notification.admin_id == admin.id, Notification.is_read.is_(False))
    )
    return {
        "unread": unread,
        "items": [
            {
                "id": n.id,
                "kind": n.kind,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "is_read": n.is_read,
                "created_at": n.created_at,
            }
            for n in rows
        ],
    }


@router.post("/notifications/read")
async def mark_read(admin: CurrentAdmin, db: DB):
    await db.execute(update(Notification).where(Notification.admin_id == admin.id).values(is_read=True))
    await db.commit()
    return {"ok": True}


# ----------------------------- Amallar tarixi -----------------------------

ACTION_LABEL = {
    "admin.login": "Admin tizimga kirdi",
    "mentor.login": "Mentor tizimga kirdi",
    "document.upload": "Hujjat yuklandi",
    "document.approve": "Hujjat tasdiqlandi",
    "document.return": "Hujjat qaytarildi",
    "document.download": "Hujjat yuklab olindi",
    "mentor.create": "Mentor qo'shildi",
    "mentor.update": "Mentor ma'lumotlari o'zgartirildi",
    "mentor.delete": "Mentor o'chirildi",
    "mentor.import": "Excel'dan import",
    "mentor.password_reset": "Mentor paroli yangilandi",
    "mentor.password_change": "Mentor parolini o'zgartirdi",
    "mentor.profile_update": "Mentor profilini yangiladi",
    "mentor.complete": "Barcha hujjatlar tasdiqlandi",
    "mentor.archive_download": "Mentor papkasi yuklab olindi",
    "export.mentors": "Excel eksport",
    "district.create": "Hudud qo'shildi",
    "district.update": "Hudud o'zgartirildi",
    "district.delete": "Hudud o'chirildi",
    "doc_type.create": "Hujjat turi qo'shildi",
    "doc_type.update": "Hujjat turi o'zgartirildi",
    "admin.create": "Admin qo'shildi",
    "admin.update": "Admin o'zgartirildi",
    "admin.password_change": "Admin parolini o'zgartirdi",
}


def audit_out(a: AuditLog) -> dict:
    return {
        "id": a.id,
        "actor_type": a.actor_type,
        "actor_name": a.actor_name,
        "action": a.action,
        "action_label": ACTION_LABEL.get(a.action, a.action),
        "mentor_id": a.mentor_id,
        "details": a.details,
        "ip": a.ip,
        "created_at": a.created_at,
    }


@router.get("/audit")
async def audit_log(
    admin: FullAdmin,
    db: DB,
    action: str | None = None,
    actor_type: Literal["admin", "mentor", "system"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action == action)
    if actor_type:
        q = q.where(AuditLog.actor_type == actor_type)
    if date_from:
        q = q.where(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(AuditLog.created_at < datetime.combine(date_to, datetime.max.time()))
    total = await db.scalar(select(func.count()).select_from(q.subquery()))
    rows = await db.scalars(q.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size))
    names = {}
    items = [audit_out(a) for a in rows]
    ids = {i["mentor_id"] for i in items if i["mentor_id"]}
    if ids:
        names = dict((await db.execute(select(Mentor.id, Mentor.full_name).where(Mentor.id.in_(ids)))).all())
    for i in items:
        i["mentor_name"] = names.get(i["mentor_id"])
    return {"total": total, "items": items, "actions": ACTION_LABEL}


# ----------------------------- Adminlar (super admin) -----------------------------


class AdminIn(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_.\-]{3,64}$")
    full_name: str | None = Field(None, max_length=200)
    password: str = Field(min_length=6, max_length=128)
    role: AdminRole = AdminRole.ADMIN
    district_id: int | None = None
    telegram_chat_id: int | None = None


class AdminUpdate(BaseModel):
    full_name: str | None = Field(None, max_length=200)
    password: str | None = Field(None, min_length=6, max_length=128)
    role: AdminRole | None = None
    district_id: int | None = None
    telegram_chat_id: int | None = None
    is_active: bool | None = None


@router.get("/admins")
async def list_admins(admin: SuperAdmin, db: DB):
    return [admin_out(a) for a in await db.scalars(select(Admin).order_by(Admin.id))]


@router.post("/admins")
async def create_admin(body: AdminIn, admin: SuperAdmin, db: DB, request: Request):
    if body.role == AdminRole.DISTRICT and not body.district_id:
        raise HTTPException(400, "Tuman administratori uchun hududni tanlang")
    a = Admin(
        username=body.username,
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role=body.role,
        district_id=body.district_id if body.role == AdminRole.DISTRICT else None,
        telegram_chat_id=body.telegram_chat_id,
    )
    db.add(a)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, "Bu login band")
    audit(db, admin, "admin.create", request=request, details={"username": a.username, "role": a.role.value})
    await db.commit()
    await db.refresh(a)
    return admin_out(a)


@router.patch("/admins/{admin_id}")
async def update_admin(admin_id: int, body: AdminUpdate, admin: SuperAdmin, db: DB, request: Request):
    a = await db.get(Admin, admin_id)
    if a is None:
        raise HTTPException(404, "Admin topilmadi")
    changes = body.model_dump(exclude_unset=True)
    if a.id == admin.id and (changes.get("is_active") is False or changes.get("role", AdminRole.SUPER) != AdminRole.SUPER):
        raise HTTPException(400, "O'zingizni o'chira yoki rolingizni pasaytira olmaysiz")
    if "password" in changes:
        pw = changes.pop("password")
        if pw:
            a.password_hash = hash_password(pw)
    for k, v in changes.items():
        setattr(a, k, v)
    if a.role == AdminRole.DISTRICT and not a.district_id:
        raise HTTPException(400, "Tuman administratori uchun hududni tanlang")
    if a.role != AdminRole.DISTRICT:
        a.district_id = None
    audit(db, admin, "admin.update", request=request, details={"id": a.id, "fields": list(body.model_dump(exclude_unset=True))})
    await db.commit()
    await db.refresh(a)
    return admin_out(a)
