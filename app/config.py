from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Heroku beradi: postgres://user:pass@host:5432/db
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/mentor"
    secret_key: str = "dev-secret-change-me"

    admin_username: str = "admin"
    admin_password: str = "admin123"

    timezone: str = "Asia/Tashkent"

    # Fayllar: "local" (disk) yoki "s3" (S3-mos xotira: AWS, Cloudflare R2, MinIO ...)
    storage_backend: str = "local"
    storage_dir: Path = BASE_DIR / "storage"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""

    max_upload_mb: int = 20

    admin_token_ttl_s: int = 12 * 3600
    mentor_token_ttl_s: int = 7 * 24 * 3600
    max_login_attempts: int = 10
    login_lock_s: int = 15 * 60

    # Ixtiyoriy: Telegram orqali bildirishnoma (mentorning telegram_chat_id si bo'lsa)
    bot_token: str = ""

    frontend_dist: Path = BASE_DIR / "frontend" / "dist"

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://") :]
        # Heroku `?sslmode=require` qo'shadi, asyncpg buni `ssl` deb tushunadi
        return v.replace("sslmode=", "ssl=")

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
