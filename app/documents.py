"""Hujjat yuklash, tekshirish va ko'rsatish (mentor va admin API'lari uchun umumiy)."""

import uuid
from urllib.parse import quote

from fastapi import HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload, selectinload

from app.models import Admin, DocStatus, Document, DocumentType, DocumentVersion, Mentor
from app.services import (
    ALLOWED_TYPES,
    OVERALL_COMPLETE,
    STATUS_LABEL,
    audit,
    check_upload,
    ensure_documents,
    mentor_overall,
    notify_admins,
    notify_mentor,
    safe_filename,
)
from app.storage import get_storage


def version_out(v: DocumentVersion) -> dict:
    return {
        "id": v.id,
        "version_no": v.version_no,
        "original_name": v.original_name,
        "content_type": v.content_type,
        "size": v.size,
        "status": v.status.value,
        "comment": v.comment,
        "uploaded_at": v.uploaded_at,
        "reviewed_at": v.reviewed_at,
        "reviewed_by": v.reviewed_by_name,
    }


def document_out(d: Document) -> dict:
    latest = d.versions[-1] if d.versions else None
    last_return = next((v for v in reversed(d.versions) if v.status == DocStatus.RETURNED), None)
    return {
        "id": d.id,
        "type": {"id": d.doc_type.id, "code": d.doc_type.code, "name": d.doc_type.name, "required": d.doc_type.is_required},
        "status": d.status.value,
        "status_label": STATUS_LABEL[d.status],
        "updated_at": d.updated_at,
        "latest": version_out(latest) if latest else None,
        "return_comment": last_return.comment if d.status == DocStatus.RETURNED and last_return else None,
        "upload_count": len(d.versions),
        "versions": [version_out(v) for v in reversed(d.versions)],
    }


async def mentor_documents(db: AsyncSession, mentor_id: int) -> list[Document]:
    await ensure_documents(db, [mentor_id])
    await db.commit()
    rows = await db.scalars(
        select(Document)
        .join(DocumentType)
        .where(Document.mentor_id == mentor_id, DocumentType.is_active.is_(True))
        .options(selectinload(Document.versions))
        .order_by(DocumentType.sort_order, DocumentType.id)
        .execution_options(populate_existing=True)
    )
    return list(rows.all())


async def upload_version(
    db: AsyncSession, mentor: Mentor, type_code: str, data: bytes, filename: str, request: Request | None
) -> Document:
    content_type, sha = check_upload(data)
    doc_type = await db.scalar(select(DocumentType).where(DocumentType.code == type_code, DocumentType.is_active.is_(True)))
    if doc_type is None:
        raise HTTPException(404, "Hujjat turi topilmadi")
    await ensure_documents(db, [mentor.id])
    doc = await db.scalar(
        select(Document)
        .where(Document.mentor_id == mentor.id, Document.doc_type_id == doc_type.id)
        .options(lazyload(Document.doc_type))
        .with_for_update(of=Document)
    )
    if doc.status == DocStatus.APPROVED:
        raise HTTPException(409, "Bu hujjat allaqachon tasdiqlangan")

    if doc.status == DocStatus.PENDING:
        pending = await db.scalars(
            select(DocumentVersion).where(DocumentVersion.document_id == doc.id, DocumentVersion.status == DocStatus.PENDING)
        )
        for v in pending:
            v.status = DocStatus.REPLACED

    version_no = (
        await db.scalar(
            select(func.coalesce(func.max(DocumentVersion.version_no), 0)).where(DocumentVersion.document_id == doc.id)
        )
    ) + 1
    ext = ALLOWED_TYPES[content_type]
    key = f"mentors/{mentor.id}/{doc_type.code}/v{version_no}-{uuid.uuid4().hex}{ext}"
    await get_storage().save(key, data, content_type)

    original = safe_filename(filename or f"{doc_type.name}{ext}")
    db.add(
        DocumentVersion(
            document_id=doc.id,
            version_no=version_no,
            storage_key=key,
            original_name=original,
            content_type=content_type,
            size=len(data),
            sha256=sha,
            status=DocStatus.PENDING,
        )
    )
    doc.status = DocStatus.PENDING
    audit(
        db,
        mentor,
        "document.upload",
        mentor_id=mentor.id,
        request=request,
        details={"type": doc_type.code, "version": version_no, "file": original, "size": len(data)},
    )
    notify_mentor(db, mentor, "uploaded", f"«{doc_type.name}» muvaffaqiyatli yuklandi", "Administrator tekshiruvini kuting.")
    await notify_admins(
        db,
        mentor.district_id,
        "new_upload",
        f"Yangi hujjat: {mentor.full_name}",
        f"{mentor.district.name} — «{doc_type.name}» ({version_no}-versiya)",
        f"/admin/mentors/{mentor.id}",
    )
    await db.commit()
    return doc


async def review_version(
    db: AsyncSession, admin: Admin, version_id: int, approve: bool, comment: str | None, request: Request | None
) -> DocumentVersion:
    v = await db.scalar(
        select(DocumentVersion)
        .where(DocumentVersion.id == version_id)
        .options(selectinload(DocumentVersion.document).selectinload(Document.mentor))
        .with_for_update(of=DocumentVersion)
    )
    if v is None:
        raise HTTPException(404, "Fayl topilmadi")
    from app.api.deps import ensure_mentor_access

    mentor = ensure_mentor_access(admin, v.document.mentor)
    if v.status != DocStatus.PENDING:
        raise HTTPException(409, "Bu versiya allaqachon ko'rib chiqilgan yoki almashtirilgan")
    comment = (comment or "").strip() or None
    if not approve and not comment:
        raise HTTPException(400, "Qaytarish sababini yozing")

    v.status = DocStatus.APPROVED if approve else DocStatus.RETURNED
    v.comment = comment
    v.reviewed_at = func.now()
    v.reviewed_by_id = admin.id
    v.reviewed_by_name = admin.full_name or admin.username
    doc = v.document
    doc.status = v.status
    type_name = doc.doc_type.name
    audit(
        db,
        admin,
        "document.approve" if approve else "document.return",
        mentor_id=mentor.id,
        request=request,
        details={"type": doc.doc_type.code, "version": v.version_no, "comment": comment},
    )
    if approve:
        notify_mentor(db, mentor, "approved", f"🟢 «{type_name}» hujjatingiz tasdiqlandi")
    else:
        notify_mentor(
            db,
            mentor,
            "returned",
            f"🔴 Sizning «{type_name}» hujjatingiz qayta yuklash uchun qaytarildi",
            f"Sabab: {comment}",
        )
    await db.flush()
    if approve and await mentor_overall(db, mentor.id) == OVERALL_COMPLETE:
        notify_mentor(
            db, mentor, "all_approved", "🟢 Hujjatlaringiz to'liq tasdiqlandi", "Barcha majburiy hujjatlar tasdiqlandi."
        )
        audit(db, None, "mentor.complete", mentor_id=mentor.id)
    await db.commit()
    return v


async def file_response(version: DocumentVersion, download: bool, title: str | None = None) -> Response:
    data = await get_storage().read(version.storage_key)
    name = version.original_name
    if title:
        name = f"{title}{ALLOWED_TYPES.get(version.content_type, '')}"
    disposition = "attachment" if download else "inline"
    return Response(
        data,
        media_type=version.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
