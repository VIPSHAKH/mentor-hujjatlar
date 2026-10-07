import { CheckOutlined, EyeOutlined, RollbackOutlined } from "@ant-design/icons";
import { App, Button, Card, Select, Space, Table, Typography } from "antd";
import { useState } from "react";
import { Link } from "react-router-dom";
import { qs } from "../api";
import { FileViewer, fmtDate } from "../components";
import { fmtSize } from "../labels";
import { adminAuth, District, useAdmin } from "./ctx";
import ReturnModal from "./ReturnModal";

type Item = {
  version_id: number;
  version_no: number;
  uploaded_at: string;
  original_name: string;
  content_type: string;
  size: number;
  doc_type: { code: string; name: string };
  mentor: { id: number; full_name: string; district: string };
};

export default function Queue() {
  const { me, reloadNotifications } = useAdmin();
  const { message } = App.useApp();
  const [district, setDistrict] = useState<number | undefined>();
  const { data, loading, reload } = adminAuth.useApi<Item[]>(`/api/admin/review-queue${qs({ district_id: district })}`);
  const { data: districts } = adminAuth.useApi<District[]>("/api/admin/districts");
  const [view, setView] = useState<Item | null>(null);
  const [returning, setReturning] = useState<Item | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const next = (cur: Item) => {
    const list = data || [];
    const i = list.findIndex((x) => x.version_id === cur.version_id);
    return list[i + 1] || null;
  };
  const approve = async (it: Item) => {
    setBusy(it.version_id);
    try {
      await adminAuth.api(`/api/admin/versions/${it.version_id}/approve`, { method: "POST" });
      message.success(`${it.mentor.full_name}: ${it.doc_type.name} tasdiqlandi`);
      if (view) setView(next(it));
      reload();
      reloadNotifications();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const buttons = (it: Item) => (
    <>
      <Button danger icon={<RollbackOutlined />} onClick={() => setReturning(it)}>
        Qaytarish
      </Button>
      <Button type="primary" icon={<CheckOutlined />} loading={busy === it.version_id} onClick={() => approve(it)} style={{ background: "#389e0d" }}>
        Tasdiqlash
      </Button>
    </>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Tekshirish navbati {data && <Typography.Text type="secondary" style={{ fontSize: 15, fontWeight: 400 }}>· {data.length} ta hujjat</Typography.Text>}
        </Typography.Title>
        {me.role !== "DISTRICT" && (
          <Select
            allowClear
            placeholder="Barcha hududlar"
            style={{ width: 220 }}
            value={district}
            onChange={setDistrict}
            options={districts?.map((d) => ({ value: d.id, label: d.name }))}
          />
        )}
      </div>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<Item>
          rowKey="version_id"
          loading={loading}
          dataSource={data || []}
          pagination={{ pageSize: 50 }}
          scroll={{ x: 900 }}
          locale={{ emptyText: "Tekshirilishi kerak bo'lgan hujjat yo'q" }}
          columns={[
            { title: "Yuklangan", width: 150, render: (_, r) => fmtDate(r.uploaded_at) },
            { title: "Tuman", width: 160, render: (_, r) => r.mentor.district },
            { title: "Mentor", render: (_, r) => <Link to={`/admin/mentors/${r.mentor.id}`}>{r.mentor.full_name}</Link> },
            {
              title: "Hujjat",
              render: (_, r) => (
                <div>
                  {r.doc_type.name}
                  {r.version_no > 1 && <Typography.Text type="secondary"> ({r.version_no}-versiya)</Typography.Text>}
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {r.original_name} · {fmtSize(r.size)}
                  </div>
                </div>
              ),
            },
            {
              title: "",
              width: 330,
              render: (_, r) => (
                <Space wrap>
                  <Button icon={<EyeOutlined />} onClick={() => setView(r)}>
                    Ko'rish
                  </Button>
                  {buttons(r)}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <FileViewer
        auth={adminAuth}
        url={view ? `/api/admin/files/${view.version_id}` : null}
        contentType={view?.content_type}
        downloadName={view ? `${view.mentor.full_name} - ${view.doc_type.name}` : undefined}
        title={view && `${view.mentor.full_name} — ${view.doc_type.name} (${view.mentor.district})`}
        onClose={() => setView(null)}
        footer={view && buttons(view)}
      />
      <ReturnModal
        open={!!returning}
        docName={returning?.doc_type.name}
        onCancel={() => setReturning(null)}
        onSubmit={async (comment) => {
          try {
            await adminAuth.api(`/api/admin/versions/${returning!.version_id}/return`, { body: { comment } });
            message.success("Hujjat mentorga qaytarildi");
            if (view) setView(next(returning!));
            setReturning(null);
            reload();
            reloadNotifications();
          } catch (e: any) {
            message.error(e.message);
            throw e;
          }
        }}
      />
    </div>
  );
}
