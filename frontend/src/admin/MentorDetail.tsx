import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Card, Col, Descriptions, Popconfirm, Row, Space, Table, Tabs, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Doc, FileViewer, fmtDate, OverallTag, showCredentials, StatusTag, Version, VersionHistory } from "../components";
import { fmtSize } from "../labels";
import { adminAuth, useAdmin } from "./ctx";
import MentorForm, { MentorValues } from "./MentorForm";
import ReturnModal from "./ReturnModal";

type Mentor = MentorValues & {
  id: number;
  full_name: string;
  district: { id: number; name: string };
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};
type Detail = { mentor: Mentor; documents: Doc[]; overall: string };
type AuditRow = { id: number; actor_name: string; action_label: string; details: Record<string, unknown> | null; ip: string | null; created_at: string };

export default function MentorDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, reloadNotifications } = useAdmin();
  const { message, modal } = App.useApp();
  const { data, loading, reload } = adminAuth.useApi<Detail>(`/api/admin/mentors/${id}`);
  const [tab, setTab] = useState("docs");
  const auditApi = adminAuth.useApi<AuditRow[]>(tab === "audit" ? `/api/admin/mentors/${id}/audit` : null, [data]);
  const [view, setView] = useState<{ v: Version; doc: Doc } | null>(null);
  const [returning, setReturning] = useState<{ v: Version; doc: Doc } | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!data) return <Card loading={loading} />;
  const m = data.mentor;

  const approve = async (v: Version) => {
    setBusy(true);
    try {
      await adminAuth.api(`/api/admin/versions/${v.id}/approve`, { method: "POST" });
      message.success("Hujjat tasdiqlandi");
      setView(null);
      reload();
      reloadNotifications();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const doReturn = async (comment: string) => {
    try {
      await adminAuth.api(`/api/admin/versions/${returning!.v.id}/return`, { body: { comment } });
      message.success("Hujjat mentorga qaytarildi");
      setReturning(null);
      setView(null);
      reload();
      reloadNotifications();
    } catch (e: any) {
      message.error(e.message);
      throw e;
    }
  };
  const reviewButtons = (v: Version, doc: Doc) =>
    v.status === "PENDING" ? (
      <>
        <Button danger icon={<RollbackOutlined />} onClick={() => setReturning({ v, doc })}>
          Qaytarish
        </Button>
        <Button type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => approve(v)} style={{ background: "#389e0d" }}>
          Tasdiqlash
        </Button>
      </>
    ) : null;

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav(-1)}>
          Orqaga
        </Button>
      </Space>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {m.full_name} {!m.is_active && <Tag>Nofaol</Tag>}
            </Typography.Title>
            <Space style={{ marginTop: 6 }} wrap>
              <Typography.Text type="secondary">{m.district.name}</Typography.Text>
              <OverallTag overall={data.overall} />
            </Space>
          </div>
          <Space wrap>
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              Tahrirlash
            </Button>
            <Popconfirm
              title="Yangi parol yaratilsinmi?"
              description="Eski parol ishlamay qoladi."
              okText="Ha"
              cancelText="Yo'q"
              onConfirm={async () => {
                try {
                  const r = await adminAuth.api(`/api/admin/mentors/${m.id}/reset-password`, { method: "POST" });
                  showCredentials(modal, "Yangi parol", r.login, r.password);
                } catch (e: any) {
                  message.error(e.message);
                }
              }}
            >
              <Button icon={<KeyOutlined />}>Parolni yangilash</Button>
            </Popconfirm>
            <Button
              icon={<FolderOpenOutlined />}
              onClick={() => adminAuth.download(`/api/admin/mentors/${m.id}/archive.zip`, `${m.full_name}.zip`).catch((e) => message.error(e.message))}
            >
              Papkani yuklab olish (ZIP)
            </Button>
            {me.role === "SUPER" && (
              <Popconfirm
                title="Mentor va uning barcha fayllari o'chirilsinmi?"
                okText="O'chirish"
                okButtonProps={{ danger: true }}
                cancelText="Yo'q"
                onConfirm={async () => {
                  await adminAuth.api(`/api/admin/mentors/${m.id}`, { method: "DELETE" });
                  message.success("O'chirildi");
                  nav("/admin/mentors");
                }}
              >
                <Button danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        </div>
      </Card>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "docs",
            label: "Hujjatlar",
            children: (
              <Row gutter={[16, 16]}>
                {data.documents.map((d) => (
                  <Col xs={24} lg={12} key={d.id}>
                    <Card
                      className="doc-card"
                      title={
                        <Space wrap>
                          {d.type.name}
                          {!d.type.required && <Tag>ixtiyoriy</Tag>}
                        </Space>
                      }
                      extra={<StatusTag status={d.status} />}
                    >
                      {d.latest ? (
                        <>
                          <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
                            <Descriptions.Item label="Oxirgi fayl">
                              {d.latest.original_name} ({fmtSize(d.latest.size)})
                            </Descriptions.Item>
                            <Descriptions.Item label="Yuklangan sana">{fmtDate(d.latest.uploaded_at)}</Descriptions.Item>
                            <Descriptions.Item label="Yuklashlar soni">{d.upload_count}</Descriptions.Item>
                          </Descriptions>
                          {d.return_comment && <Alert type="error" showIcon message="Qaytarish sababi" description={d.return_comment} style={{ marginBottom: 12 }} />}
                          <Space wrap>
                            <Button icon={<EyeOutlined />} onClick={() => setView({ v: d.latest!, doc: d })}>
                              Ko'rish
                            </Button>
                            {reviewButtons(d.latest, d)}
                          </Space>
                          {d.versions.length > 1 && (
                            <details style={{ marginTop: 14 }}>
                              <summary style={{ cursor: "pointer", color: "#1f6feb" }}>Versiyalar tarixi ({d.versions.length})</summary>
                              <div style={{ marginTop: 12 }}>
                                <VersionHistory versions={d.versions} onOpen={(v) => setView({ v, doc: d })} />
                              </div>
                            </details>
                          )}
                        </>
                      ) : (
                        <Typography.Text type="secondary">Mentor bu hujjatni hali yuklamagan</Typography.Text>
                      )}
                    </Card>
                  </Col>
                ))}
              </Row>
            ),
          },
          {
            key: "profile",
            label: "Shaxsiy ma'lumotlar",
            children: (
              <Card>
                <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
                  <Descriptions.Item label="F.I.Sh.">{m.full_name}</Descriptions.Item>
                  <Descriptions.Item label="Tuman / shahar">{m.district.name}</Descriptions.Item>
                  <Descriptions.Item label="Tug'ilgan sana">{m.birth_date ? dayjs(m.birth_date).format("DD.MM.YYYY") : "—"}</Descriptions.Item>
                  <Descriptions.Item label="Telefon">{m.phone || "—"}</Descriptions.Item>
                  <Descriptions.Item label="Pasport">{m.passport || "—"}</Descriptions.Item>
                  <Descriptions.Item label="JSHSHIR">{m.pinfl || "—"}</Descriptions.Item>
                  <Descriptions.Item label="Yo'nalishi">{m.direction || "—"}</Descriptions.Item>
                  <Descriptions.Item label="Login">{m.phone || m.login || "—"}</Descriptions.Item>
                  <Descriptions.Item label="Mentorlik faoliyati" span={2}>
                    <span style={{ whiteSpace: "pre-wrap" }}>{m.activity || "—"}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Oxirgi kirish">{fmtDate(m.last_login_at)}</Descriptions.Item>
                  <Descriptions.Item label="Qo'shilgan">{fmtDate(m.created_at)}</Descriptions.Item>
                </Descriptions>
              </Card>
            ),
          },
          {
            key: "audit",
            label: "Amallar tarixi",
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <Table<AuditRow>
                  rowKey="id"
                  size="small"
                  loading={auditApi.loading}
                  dataSource={auditApi.data || []}
                  pagination={{ pageSize: 30 }}
                  scroll={{ x: 700 }}
                  columns={[
                    { title: "Sana", width: 150, render: (_, r) => fmtDate(r.created_at) },
                    { title: "Kim", dataIndex: "actor_name", width: 180 },
                    { title: "Amal", dataIndex: "action_label" },
                    {
                      title: "Tafsilot",
                      render: (_, r) =>
                        r.details
                          ? Object.entries(r.details)
                              .filter(([k]) => !["version_id"].includes(k))
                              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
                              .join("; ")
                          : "",
                    },
                    { title: "IP", dataIndex: "ip", width: 120 },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />

      <FileViewer
        auth={adminAuth}
        url={view ? `/api/admin/files/${view.v.id}` : null}
        contentType={view?.v.content_type}
        downloadName={view ? `${m.full_name} - ${view.doc.type.name}` : undefined}
        title={
          view && (
            <Space wrap>
              {view.doc.type.name} — {view.v.version_no}-versiya <StatusTag status={view.v.status} />
            </Space>
          )
        }
        onClose={() => setView(null)}
        footer={view && reviewButtons(view.v, view.doc)}
      />
      <ReturnModal open={!!returning} docName={returning?.doc.type.name} onCancel={() => setReturning(null)} onSubmit={doReturn} />
      <MentorForm
        open={editing}
        edit
        title="Mentor ma'lumotlarini tahrirlash"
        initial={{ ...m, district_id: m.district.id }}
        onCancel={() => setEditing(false)}
        onSubmit={async (v) => {
          try {
            await adminAuth.api(`/api/admin/mentors/${m.id}`, { method: "PATCH", body: v });
            message.success("Saqlandi");
            setEditing(false);
            reload();
          } catch (e: any) {
            message.error(e.message);
            throw e;
          }
        }}
      />
    </div>
  );
}
