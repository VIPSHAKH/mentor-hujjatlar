"""Demo ma'lumotlar: ishlab turgan serverga API orqali mentorlar va hujjatlar qo'shadi.

python -m scripts.seed_demo --url http://localhost:8000 --admin admin --password admin123
"""

import argparse
import random

import httpx

NAMES = [
    ("Shovot tumani", "Abdullayev Jasur Bahodirovich", "Matematika"),
    ("Shovot tumani", "Karimova Dilnoza Rustamovna", "Fizika"),
    ("Shovot tumani", "Yusupov Sardor Olimovich", "Informatika"),
    ("Urganch shahri", "Rahimova Malika Azizovna", "Matematika"),
    ("Urganch shahri", "Qurbonov Bekzod Shavkatovich", "Kimyo"),
    ("Xiva shahri", "Sobirova Gulnora Erkinovna", "Biologiya"),
    ("Xiva shahri", "Ismoilov Otabek Davronovich", "Informatika"),
    ("Gurlan tumani", "Matyoqubova Nodira Ilhomovna", "Fizika"),
    ("Hazorasp tumani", "Ro'zmetov Akmal Ulug'bekovich", "Matematika"),
    ("Xonqa tumani", "Atajonova Zarina Baxtiyorovna", "Ingliz tili"),
]


def pdf(title: str) -> bytes:
    text = title.encode("latin-1", "replace")
    stream = b"BT /F1 24 Tf 72 720 Td (" + text + b") Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--admin", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    rnd = random.Random(7)
    c = httpx.Client(base_url=args.url, timeout=30)
    tok = c.post("/api/admin/login", json={"login": args.admin, "password": args.password}).raise_for_status().json()["token"]
    ah = {"Authorization": f"Bearer {tok}"}
    districts = {d["name"]: d["id"] for d in c.get("/api/admin/districts", headers=ah).json()}
    codes = ["passport", "diploma", "certificate", "objectivka"]
    print(f"{'Tuman':<18} {'F.I.Sh.':<34} {'Login':<14} Parol")
    for i, (district, name, direction) in enumerate(NAMES):
        phone = f"+99890{1000000 + i * 1111:07d}"
        r = c.post(
            "/api/admin/mentors",
            headers=ah,
            json={"full_name": name, "district_id": districts[district], "phone": phone, "direction": direction},
        )
        if r.status_code == 409:
            continue
        r.raise_for_status()
        password = r.json()["password"]
        print(f"{district:<18} {name:<34} {phone:<14} {password}")
        mtok = c.post("/api/mentor/login", json={"login": phone, "password": password}).raise_for_status().json()["token"]
        mh = {"Authorization": f"Bearer {mtok}"}
        scenario = i % 5  # 0: hammasi tasdiqlangan, 1: qaytarilgan, 2: tekshiruvda, 3: qisman, 4: yuklanmagan
        upload = codes if scenario in (0, 1, 2) else codes[: rnd.randint(1, 3)] if scenario == 3 else []
        for code in upload:
            c.post(
                f"/api/mentor/documents/{code}",
                headers=mh,
                files={"file": (f"{code}.pdf", pdf(f"{code.upper()} - {name}"), "application/pdf")},
            ).raise_for_status()
        if scenario in (0, 1):
            m = c.get("/api/mentor/me", headers=mh).json()
            for d in m["documents"]:
                vid = d["latest"]["id"]
                if scenario == 1 and d["type"]["code"] == "diploma":
                    c.post(
                        f"/api/admin/versions/{vid}/return",
                        headers=ah,
                        json={
                            "comment": "Diplom ilovasi yuklanmagan. Iltimos, diplom va ilovasini bitta PDF faylda qayta yuklang."
                        },
                    ).raise_for_status()
                else:
                    c.post(f"/api/admin/versions/{vid}/approve", headers=ah).raise_for_status()


if __name__ == "__main__":
    main()
