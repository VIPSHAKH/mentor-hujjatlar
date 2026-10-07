# Mentorlar hujjatlarini yig'ish va tasdiqlash tizimi

«Muhammad al-Xorazmiy vorislari» loyihasi mentorlarining shaxsiy va malakaviy hujjatlarini elektron yig'ish, tekshirish va tasdiqlash uchun veb-tizim.

- **Mentor kabineti** (`/kabinet/`): telefon raqami yoki login bilan kirish, profil, 4 ta majburiy hujjatni yuklash (Pasport/ID, Diplom, Xalqaro sertifikat, Obektivka), holatlarni ko'rish, qaytarilgan hujjatni izoh bilan ko'rib qayta yuklash, bildirishnomalar.
- **Administrator paneli** (`/admin/`): statistika, tumanlar kesimida mentorlar jadvali (🟢🔵🟡🔴 holatlar), mentor papkasi, hujjatni ko'rish/yuklab olish, tasdiqlash yoki majburiy izoh bilan qaytarish, tekshirish navbati, versiyalar tarixi, qidiruv va filtrlar, Excel import/eksport, amallar tarixi (audit), hududlar, hujjat turlari va adminlarni boshqarish.

## Texnologiyalar

- Backend: Python 3.12, FastAPI, SQLAlchemy 2 (async), PostgreSQL, Alembic
- Frontend: React 18, TypeScript, Vite, Ant Design 5
- Fayllar: lokal disk (`storage/`) yoki S3-mos saqlash (`STORAGE_BACKEND=s3`)

## Rollar

| Rol | Imkoniyatlar |
|---|---|
| Super administrator | Hammasi + hujjat turlari, adminlar, mentorni o'chirish |
| Administrator | Barcha hududlar, hujjatlarni tekshirish, import/eksport, audit |
| Tuman administratori | Faqat o'z hududidagi mentorlar |
| Mentor | Faqat o'z profili va hujjatlari |

## Hujjat holatlari

`MISSING` (🟡 yuklanmagan) → `PENDING` (🔵 tekshirilmoqda) → `APPROVED` (🟢 tasdiqlangan) yoki `RETURNED` (🔴 qayta yuklash kerak). Har bir yuklash alohida versiya sifatida saqlanadi; eski versiyalar o'chirilmaydi. Tasdiqlanmasdan almashtirilgan versiya `REPLACED` holatini oladi.

Mentorning umumiy holati: biror hujjat qaytarilgan bo'lsa — «Qayta yuklashi kerak», yuklanmagan bo'lsa — «Hujjatlari to'liq emas», tekshiruvda bo'lsa — «Tekshiruvda», hammasi tasdiqlangan bo'lsa — «To'liq tasdiqlangan».

## Xavfsizlik

- Parollar PBKDF2-SHA256 (310 000 iteratsiya) bilan xeshlanadi; kirishda urinishlar cheklanadi.
- Admin va mentor tokenlari alohida (JWT), bir-birining API'siga kira olmaydi.
- Fayllarga ochiq URL yo'q: faqat `/api/.../files/{id}` orqali, rol va egalik tekshiruvidan keyin beriladi.
- Fayl turi kengaytma bo'yicha emas, ichki imzosi bo'yicha tekshiriladi (PDF/JPEG/PNG), hajmi `MAX_UPLOAD_MB` bilan cheklanadi.
- Har bir amal (kirish, yuklash, tasdiqlash, qaytarish, yuklab olish, import, eksport...) `audit_logs` jadvaliga yoziladi.

## Lokal ishga tushirish

```bash
# PostgreSQL bazasi: mentor
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # kerak bo'lsa DATABASE_URL va SECRET_KEY ni o'zgartiring
.venv/bin/alembic upgrade head

cd frontend && npm ci && npm run build && cd ..
.venv/bin/uvicorn app.main:app --reload --port 8000
```

- Admin panel: http://localhost:8000/admin/ (birinchi ishga tushishda `ADMIN_USERNAME`/`ADMIN_PASSWORD` bilan super admin yaratiladi, standart: `admin` / `admin123` — darhol o'zgartiring)
- Mentor kabineti: http://localhost:8000/kabinet/
- Frontendni dev rejimda: `cd frontend && npm run dev` (http://localhost:5173, `/api` 8000-portga proksi qilinadi)

Demo ma'lumotlar (10 ta mentor, turli holatdagi hujjatlar):

```bash
.venv/bin/python -m scripts.seed_demo --url http://localhost:8000
```

## Testlar

```bash
createdb mentor_test
.venv/bin/pytest -q
.venv/bin/ruff check . && .venv/bin/ruff format --check .
cd frontend && npm run typecheck
```

## Sozlamalar (`.env`)

| O'zgaruvchi | Tavsif |
|---|---|
| `DATABASE_URL` | PostgreSQL ulanish manzili |
| `SECRET_KEY` | JWT kaliti (kamida 32 belgi, ishlab chiqarishda majburiy) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Birinchi super admin |
| `STORAGE_BACKEND` | `local` yoki `s3` |
| `STORAGE_DIR` | Lokal fayllar papkasi (standart `storage/`) |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | S3 sozlamalari |
| `MAX_UPLOAD_MB` | Fayl hajmi chegarasi (standart 20) |
| `BOT_TOKEN` | Telegram bot tokeni (ixtiyoriy; admin/mentorda `telegram_chat_id` bo'lsa xabar yuboriladi) |

## Excel import

Admin panel → «Excel import». Ikki format qabul qilinadi:

1. Jadval: `Tuman | F.I.Sh. | Tug'ilgan sana | Telefon | Pasport | JSHSHIR | Yo'nalish | Faoliyat` (namuna faylni paneldan yuklab olish mumkin).
2. Ro'yxat: tuman nomi alohida qatorda («Shovot tumani»), ostida mentorlar F.I.Sh.lari.

Avval «Tekshirib ko'rish» bilan natijani ko'ring, so'ng import qiling. Yangi mentorlar uchun login/parollar Excel fayl sifatida yuklab beriladi.

## Kengaytirish

Yangi hujjat turi (shartnoma, malaka oshirish sertifikati, CV...) kod o'zgartirmasdan «Sozlamalar → Hujjat turlari» orqali qo'shiladi — barcha mentorlarga avtomatik qo'shiladi. Telegram xabarnomalari uchun `app/services.py` dagi `send_telegram` ishlatiladi; SMS va boshqa kanallarni shu joyga qo'shish mumkin.
