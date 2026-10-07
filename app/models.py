from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class AdminRole(str, enum.Enum):
    SUPER = "SUPER"  # hammasi + adminlarni boshqarish
    ADMIN = "ADMIN"  # barcha hududlar
    DISTRICT = "DISTRICT"  # faqat o'z tumani


class DocStatus(str, enum.Enum):
    MISSING = "MISSING"  # 🟡 Yuklanmagan
    PENDING = "PENDING"  # 🔵 Tekshirilmoqda
    APPROVED = "APPROVED"  # 🟢 Tasdiqlangan
    RETURNED = "RETURNED"  # 🔴 Qayta yuklash kerak
    REPLACED = "REPLACED"  # faqat versiya uchun: tekshiruvdan oldin mentor yangisini yukladi


def _enum(e: type[enum.Enum]) -> Enum:
    return Enum(e, name=e.__name__.lower(), native_enum=False, length=20)


class District(Base):
    __tablename__ = "districts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[AdminRole] = mapped_column(_enum(AdminRole), default=AdminRole.ADMIN)
    district_id: Mapped[int | None] = mapped_column(ForeignKey("districts.id", ondelete="SET NULL"))
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    district: Mapped[District | None] = relationship(lazy="joined")


class Mentor(Base):
    __tablename__ = "mentors"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200), index=True)
    birth_date: Mapped[date | None] = mapped_column(Date)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    login: Mapped[str | None] = mapped_column(String(64), unique=True)
    passport: Mapped[str | None] = mapped_column(String(20))
    pinfl: Mapped[str | None] = mapped_column(String(14))
    district_id: Mapped[int] = mapped_column(ForeignKey("districts.id", ondelete="RESTRICT"), index=True)
    direction: Mapped[str | None] = mapped_column(String(200))
    activity: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    district: Mapped[District] = relationship(lazy="joined")
    documents: Mapped[list[Document]] = relationship(back_populates="mentor", cascade="all, delete-orphan")


class DocumentType(Base):
    """Hujjat turlari jadvalda: keyin yangi tur (shartnoma, CV ...) kod yozmasdan qo'shiladi."""

    __tablename__ = "document_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Document(Base):
    """Mentorning bitta hujjat turi bo'yicha holati. Fayllar versiyalarda saqlanadi."""

    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("mentor_id", "doc_type_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    mentor_id: Mapped[int] = mapped_column(ForeignKey("mentors.id", ondelete="CASCADE"), index=True)
    doc_type_id: Mapped[int] = mapped_column(ForeignKey("document_types.id", ondelete="RESTRICT"))
    status: Mapped[DocStatus] = mapped_column(_enum(DocStatus), default=DocStatus.MISSING, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    mentor: Mapped[Mentor] = relationship(back_populates="documents")
    doc_type: Mapped[DocumentType] = relationship(lazy="joined")
    versions: Mapped[list[DocumentVersion]] = relationship(
        back_populates="document", order_by="DocumentVersion.version_no", cascade="all, delete-orphan"
    )


class DocumentVersion(Base):
    """Har bir yuklangan fayl. Eski versiyalar o'chirilmaydi (tarix)."""

    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(300))
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[DocStatus] = mapped_column(_enum(DocStatus), default=DocStatus.PENDING)
    comment: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    reviewed_by_name: Mapped[str | None] = mapped_column(String(200))

    document: Mapped[Document] = relationship(back_populates="versions")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    mentor_id: Mapped[int | None] = mapped_column(ForeignKey("mentors.id", ondelete="CASCADE"), index=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(255))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AuditLog(Base):
    """Har bir amal tarixi."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_type: Mapped[str] = mapped_column(String(20))  # admin | mentor | system
    actor_id: Mapped[int | None] = mapped_column(Integer)
    actor_name: Mapped[str | None] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(60), index=True)
    mentor_id: Mapped[int | None] = mapped_column(ForeignKey("mentors.id", ondelete="SET NULL"), index=True)
    details: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
