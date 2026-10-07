import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, auth, mentor
from app.bootstrap import bootstrap
from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bootstrap()
    yield


app = FastAPI(title="Mentorlar hujjatlari tizimi", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(mentor.router)
app.include_router(admin.router)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.get("/healthz")
async def healthz():
    return {"ok": True}


# ----------------------- Frontend (bitta React SPA) -----------------------
dist = settings.frontend_dist
if (dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/kabinet/")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    file = (dist / path).resolve()
    if path and file.is_file() and dist.resolve() in file.parents:
        return FileResponse(file)
    index = dist / "index.html"
    if not index.exists():
        raise HTTPException(404, "Frontend build qilinmagan (npm run build)")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
