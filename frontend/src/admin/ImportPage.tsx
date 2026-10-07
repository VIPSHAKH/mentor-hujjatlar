import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, List, Space, Typography, Upload } from "antd";
import { useState } from "react";
import { base64ToBlob, saveBlob } from "../api";
import { adminAuth } from "./ctx";

type Result = { created: number; updated: number; new_districts: string[]; errors: string[]; dry_run: boolean; credentials_xlsx: string | null };

export default function ImportPage() {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dry: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await adminAuth.api<Result>(`/api/admin/import?dry_run=${dry}`, { form: fd });
      setResult(r);
      if (!dry) {
        message.success(`Import tugadi: ${r.created} ta yangi, ${r.updated} ta yangilandi`);
        if (r.credentials_xlsx) saveCreds(r.credentials_xlsx);
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const saveCreds = (b64: string) =>
    saveBlob(base64ToBlob(b64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "mentorlar-kirish-malumotlari.xlsx");

  return (
    <div style={{ maxWidth: 860 }}>
      <Typography.Title level={3} className="page-title">
        Mentorlarni Excel'dan import qilish
      </Typography.Title>
      <Card style={{ marginBottom: 16 }}>
        <Typography.Paragraph>
          Ikki xil formatdagi fayl qabul qilinadi:
        </Typography.Paragraph>
        <ul style={{ marginTop: 0 }}>
          <li>
            <b>Jadval</b>: ustunlar — <i>Tuman, F.I.Sh., Tug'ilgan sana, Telefon, Pasport, JSHSHIR, Yo'nalish, Faoliyat</i> (namunani yuklab oling).
          </li>
          <li>
            <b>Ro'yxat</b>: tuman nomi alohida qatorda (masalan, «Shovot tumani»), ostida mentorlarning F.I.Sh.lari.
          </li>
        </ul>
        <Typography.Paragraph type="secondary">
          Mavjud mentorlar (telefon, JSHSHIR yoki tuman + F.I.Sh. bo'yicha) yangilanadi, yangilariga login va parol yaratiladi.
        </Typography.Paragraph>
        <Button icon={<DownloadOutlined />} onClick={() => adminAuth.download("/api/admin/import/template.xlsx", "mentorlar-namuna.xlsx")}>
          Namuna faylni yuklab olish
        </Button>
      </Card>
      <Card>
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          beforeUpload={(f) => {
            setFile(f);
            setResult(null);
            return false;
          }}
          onRemove={() => {
            setFile(null);
            setResult(null);
          }}
          fileList={file ? [{ uid: "1", name: file.name, status: "done" }] : []}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>Excel faylni (.xlsx) shu yerga tashlang yoki tanlang</p>
        </Upload.Dragger>
        <Space style={{ marginTop: 16 }}>
          <Button disabled={!file} loading={busy} onClick={() => run(true)}>
            Tekshirib ko'rish
          </Button>
          <Button type="primary" disabled={!file} loading={busy} onClick={() => run(false)}>
            Import qilish
          </Button>
        </Space>
        {result && (
          <div style={{ marginTop: 20 }}>
            <Alert
              type={result.errors.length ? "warning" : "success"}
              showIcon
              message={
                result.dry_run
                  ? `Tekshiruv natijasi: ${result.created} ta yangi mentor qo'shiladi, ${result.updated} ta yangilanadi`
                  : `${result.created} ta yangi mentor qo'shildi, ${result.updated} ta yangilandi`
              }
              description={
                <>
                  {result.new_districts.length > 0 && <div>Yangi hududlar: {result.new_districts.join(", ")}</div>}
                  {!result.dry_run && result.credentials_xlsx && (
                    <Button size="small" style={{ marginTop: 8 }} icon={<DownloadOutlined />} onClick={() => saveCreds(result.credentials_xlsx!)}>
                      Login va parollar (Excel)
                    </Button>
                  )}
                </>
              }
            />
            {result.errors.length > 0 && (
              <List
                size="small"
                style={{ marginTop: 12 }}
                header={<b>Xatolar ({result.errors.length})</b>}
                bordered
                dataSource={result.errors}
                renderItem={(e) => <List.Item style={{ color: "#cf1322" }}>{e}</List.Item>}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
