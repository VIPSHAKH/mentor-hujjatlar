import os
import tempfile

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/mentor_test"
)
os.environ["SECRET_KEY"] = "test-secret-0123456789abcdef0123456789abcdef"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "admin123"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="mentor-test-")
os.environ["MAX_UPLOAD_MB"] = "1"
os.environ["BOT_TOKEN"] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402

from app import models  # noqa: E402,F401
from app.bootstrap import bootstrap  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(scope="session", autouse=True)
async def db_schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await bootstrap()
    yield
    await engine.dispose()


@pytest.fixture(scope="session")
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(scope="session")
async def admin_headers(client):
    r = await client.post("/api/admin/login", json={"login": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def district_id(client, headers, name="Gurlan tumani") -> int:
    r = await client.get("/api/admin/districts", headers=headers)
    return next(d["id"] for d in r.json() if d["name"] == name)


async def make_mentor(client, headers, full_name, phone, district="Gurlan tumani"):
    did = await district_id(client, headers, district)
    r = await client.post(
        "/api/admin/mentors", headers=headers, json={"full_name": full_name, "district_id": did, "phone": phone}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    lr = await client.post("/api/mentor/login", json={"login": phone, "password": body["password"]})
    assert lr.status_code == 200, lr.text
    return body["mentor"], {"Authorization": f"Bearer {lr.json()['token']}"}
