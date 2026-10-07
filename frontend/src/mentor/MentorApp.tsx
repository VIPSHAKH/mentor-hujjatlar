import { BellOutlined, CloudUploadOutlined, EyeOutlined, LogoutOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  Layout,
  List,
  Progress,
  Result,
  Row,
  Space,
  Spin,
  Tabs,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { makeAuth, request } from "../api";
import { Doc, FileViewer, fmtDate, OverallTag, StatusTag, Version, VersionHistory } from "../components";
import { fmtSize } from "../labels";

const auth = makeAuth("mh_mentor_token");

type Profile = {
  id: number;
  full_name: string;
  birth_date: string | null;
  phone: string | null;
  login: string | null;
  passport: string | null;
  pinfl: string | null;
  district: { id: number; name: string };
  direction: string | null;
  activity: string | null;
};
type Me = { profile: Profile; documents: Doc[]; overall: string; unread_notifications: number; max_upload_mb: number };
type Notif = { id: number; title: string; body: string; is_read: boolean; created_at: string };

function Login() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  return (
    <div className="auth-wrap">
      <Card style={{ width: 400, maxWidth: "100%" }}>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
          Mentor kabineti
        </Typography.Title>
        <Typography.Paragraph type="secondary">«Muhammad al-Xorazmiy vorislari» loyihasi</Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setLoading(true);
            try {
              const r = await request<{ token: string }>("/api/mentor/login", { body: v });
              auth.setToken(r.token);
            } catch (e: any) {
              message.error(e.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item name="login" label="Telefon raqami yoki login" rules={[{ required: true, message: "Kiriting" }]}>
            <Input autoFocus placeholder="+998 90 123 45 67" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Parol" rules={[{ required: true, message: "Parolni kiriting" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Kirish
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
          Login va parolni tuman mas'ulidan oling.
        </Typography.Paragraph>
      </Card>
    </div>
  );
}

function DocCard({ d, maxMb, onChange, onOpen }: { d: Doc; maxMb: number; onChange: () => void; onOpen: (v: Version, d: Doc) => void }) {
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const canUpload = d.status === "MISSING" || d.status === "RETURNED" || d.status === "PENDING";
  const upload = async (file: File) => {
    if (file.size > maxMb * 1024 * 1024) {
      message.error(`Fayl hajmi ${maxMb} MB dan oshmasligi kerak`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await auth.api(`/api/mentor/documents/${d.type.code}`, { form: fd });
      message.success(r.message);
      onChange();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setUploading(false);
    }
  };
  const label = d.status === "RETURNED" ? "Qayta yuklash" : d.status === "PENDING" ? "Boshqa fayl bilan almashtirish" : "Fayl yuklash";
  return (
    <Card className="doc-card" title={d.type.name} extra={<StatusTag status={d.status} />} style={{ height: "100%" }}>
      {d.status === "RETURNED" && d.return_comment && (
        <Alert type="error" showIcon message="Hujjat qaytarildi" description={d.return_comment} style={{ marginBottom: 12 }} />
      )}
      {d.status === "APPROVED" && <Alert type="success" showIcon message="Hujjat tasdiqlangan" style={{ marginBottom: 12 }} />}
      {d.status === "PENDING" && <Alert type="info" showIcon message="Administrator tekshiruvini kuting" style={{ marginBottom: 12 }} />}
      {d.latest && (
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          <Typography.Link onClick={() => onOpen(d.latest!, d)}>
            <EyeOutlined /> {d.latest.original_name}
          </Typography.Link>{" "}
          <Typography.Text type="secondary">
            ({fmtSize(d.latest.size)}, {fmtDate(d.latest.uploaded_at)})
          </Typography.Text>
        </div>
      )}
      {canUpload && (
        <Upload
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          showUploadList={false}
          beforeUpload={(f) => {
            upload(f);
            return false;
          }}
        >
          <Button type={d.status === "PENDING" ? "default" : "primary"} danger={d.status === "RETURNED"} icon={<CloudUploadOutlined />} loading={uploading}>
            {label}
          </Button>
        </Upload>
      )}
      <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>PDF, JPG yoki PNG, {maxMb} MB gacha</div>
      {d.versions.length > 1 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#1f6feb" }}>Yuklashlar tarixi ({d.versions.length})</summary>
          <div style={{ marginTop: 12 }}>
            <VersionHistory versions={d.versions} onOpen={(v) => onOpen(v, d)} />
          </div>
        </details>
      )}
    </Card>
  );
}

function ProfileTab({ p, onSaved }: { p: Profile; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [pw] = Form.useForm();
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <Card title="Shaxsiy ma'lumotlar">
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="F.I.Sh.">{p.full_name}</Descriptions.Item>
            <Descriptions.Item label="Tuman / shahar">{p.district.name}</Descriptions.Item>
            <Descriptions.Item label="Telefon">{p.phone || "—"}</Descriptions.Item>
          </Descriptions>
          <Form
            form={form}
            layout="vertical"
            initialValues={{ ...p, birth_date: p.birth_date ? dayjs(p.birth_date) : null }}
            onFinish={async (v) => {
              try {
                await auth.api("/api/mentor/me", {
                  method: "PATCH",
                  body: {
                    birth_date: v.birth_date ? v.birth_date.format("YYYY-MM-DD") : null,
                    passport: v.passport || null,
                    pinfl: v.pinfl || null,
                    direction: v.direction || null,
                    activity: v.activity || null,
                  },
                });
                message.success("Ma'lumotlar saqlandi");
                onSaved();
              } catch (e: any) {
                message.error(e.message);
              }
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", columnGap: 16 }}>
              <Form.Item name="birth_date" label="Tug'ilgan sana">
                <DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="passport" label="Pasport seriya va raqami">
                <Input placeholder="AA1234567" />
              </Form.Item>
              <Form.Item name="pinfl" label="JSHSHIR" rules={[{ pattern: /^\d{14}$/, message: "14 ta raqam" }]}>
                <Input maxLength={14} />
              </Form.Item>
              <Form.Item name="direction" label="Yo'nalishi">
                <Input />
              </Form.Item>
            </div>
            <Form.Item name="activity" label="Mentorlik faoliyati">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Saqlash
            </Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card title="Parolni o'zgartirish">
          <Form
            form={pw}
            layout="vertical"
            onFinish={async (v) => {
              try {
                await auth.api("/api/mentor/password", { body: { old_password: v.old_password, new_password: v.new_password } });
                message.success("Parol o'zgartirildi");
                pw.resetFields();
              } catch (e: any) {
                message.error(e.message);
              }
            }}
          >
            <Form.Item name="old_password" label="Joriy parol" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="new_password" label="Yangi parol" rules={[{ required: true, min: 6, message: "Kamida 6 ta belgi" }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button htmlType="submit">O'zgartirish</Button>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}

function Cabinet() {
  const { data, reload } = auth.useApi<Me>("/api/mentor/me");
  const [tab, setTab] = useState("docs");
  const notifs = auth.useApi<Notif[]>(tab === "notifs" ? "/api/mentor/notifications" : null, [data]);
  const [view, setView] = useState<{ v: Version; d: Doc } | null>(null);

  if (!data)
    return (
      <div className="auth-wrap">
        <Spin />
      </div>
    );
  const p = data.profile;
  const required = data.documents.filter((d) => d.type.required);
  const approved = required.filter((d) => d.status === "APPROVED").length;
  const uploaded = required.filter((d) => d.status !== "MISSING").length;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ background: "#fff", padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #eee" }}>
        <Typography.Text strong className="hide-sm">
          Mentor kabineti
        </Typography.Text>
        <Space>
          <span>{p.full_name}</span>
          <Button icon={<LogoutOutlined />} onClick={() => auth.setToken(null)}>
            Chiqish
          </Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 20, maxWidth: 1200, width: "100%", margin: "0 auto" }}>
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={[16, 16]} align="middle">
            <Col flex="auto">
              <Typography.Title level={4} style={{ margin: 0 }}>
                {p.full_name}
              </Typography.Title>
              <Space wrap style={{ marginTop: 6 }}>
                <Typography.Text type="secondary">{p.district.name}</Typography.Text>
                {p.direction && <Typography.Text type="secondary">· {p.direction}</Typography.Text>}
                <OverallTag overall={data.overall} />
              </Space>
            </Col>
            <Col>
              <Space size="large">
                <Progress type="circle" size={64} percent={Math.round((approved / Math.max(required.length, 1)) * 100)} format={() => `${approved}/${required.length}`} />
                <div style={{ fontSize: 13 }}>
                  <div>Yuklangan: {uploaded}/{required.length}</div>
                  <div>Tasdiqlangan: {approved}/{required.length}</div>
                </div>
              </Space>
            </Col>
          </Row>
        </Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => {
            setTab(k);
            if (k === "notifs" && data.unread_notifications) auth.api("/api/mentor/notifications/read", { method: "POST" }).then(reload);
          }}
          items={[
            {
              key: "docs",
              label: "Hujjatlarim",
              children: (
                <>
                  {data.overall === "COMPLETE" && (
                    <Result status="success" title="Barcha hujjatlaringiz tasdiqlandi!" style={{ padding: "12px 0 24px" }} />
                  )}
                  {data.overall === "RETURNED" && (
                    <Alert type="error" showIcon message="Ba'zi hujjatlaringiz qaytarildi. Izohni o'qib, to'g'ri faylni qayta yuklang." style={{ marginBottom: 16 }} />
                  )}
                  <Row gutter={[16, 16]}>
                    {data.documents.map((d) => (
                      <Col xs={24} md={12} key={d.id}>
                        <DocCard d={d} maxMb={data.max_upload_mb} onChange={reload} onOpen={(v, doc) => setView({ v, d: doc })} />
                      </Col>
                    ))}
                  </Row>
                </>
              ),
            },
            { key: "profile", label: "Profil", children: <ProfileTab p={p} onSaved={reload} /> },
            {
              key: "notifs",
              label: (
                <Badge count={data.unread_notifications} size="small" offset={[8, 0]}>
                  <BellOutlined /> Bildirishnomalar
                </Badge>
              ),
              children: (
                <Card>
                  {notifs.data?.length ? (
                    <List
                      dataSource={notifs.data}
                      renderItem={(n) => (
                        <List.Item style={{ background: n.is_read ? undefined : "#f0f6ff", padding: "10px 8px" }}>
                          <List.Item.Meta title={n.title} description={<>{n.body}<div style={{ fontSize: 12 }}>{fmtDate(n.created_at)}</div></>} />
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty description="Bildirishnoma yo'q" />
                  )}
                </Card>
              ),
            },
          ]}
        />
      </Layout.Content>
      <FileViewer
        auth={auth}
        url={view ? `/api/mentor/files/${view.v.id}` : null}
        contentType={view?.v.content_type}
        downloadName={view ? view.d.type.name : undefined}
        title={view && `${view.d.type.name} — ${view.v.version_no}-versiya`}
        onClose={() => setView(null)}
      />
    </Layout>
  );
}

export default function MentorApp() {
  const token = auth.useToken();
  return token ? <Cabinet /> : <Login />;
}
