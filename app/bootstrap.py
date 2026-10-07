import logging

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Admin, AdminRole, District, DocumentType
from app.security import hash_password
from app.services import DEFAULT_DISTRICTS, DEFAULT_DOC_TYPES

log = logging.getLogger("app")


async def bootstrap() -> None:
    """Birinchi ishga tushishda: super admin, hududlar va 4 ta majburiy hujjat turi."""
    async with SessionLocal() as db:
        if (await db.execute(select(Admin.id))).first() is None:
            db.add(
                Admin(
                    username=settings.admin_username,
                    full_name="Super administrator",
                    password_hash=hash_password(settings.admin_password),
                    role=AdminRole.SUPER,
                )
            )
            log.info("Boshlang'ich admin yaratildi: %s", settings.admin_username)
        if (await db.execute(select(District.id))).first() is None:
            db.add_all(District(name=n, sort_order=i) for i, n in enumerate(DEFAULT_DISTRICTS, start=1))
        if (await db.execute(select(DocumentType.id))).first() is None:
            db.add_all(
                DocumentType(code=c, name=n, is_required=True, sort_order=i)
                for i, (c, n) in enumerate(DEFAULT_DOC_TYPES, start=1)
            )
        await db.commit()
