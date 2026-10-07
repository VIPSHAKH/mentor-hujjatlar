import { DownloadOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Card, Input, Select, Space, Table, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { qs } from "../api";
import { Dot, OverallTag, showCredentials } from "../components";
import { DOC_STATUS, DocStatus, OVERALL } from "../labels";
import { adminAuth, District, useAdmin } from "./ctx";
import MentorForm, { MentorValues } from "./MentorForm";

type Row = {
  id: number;
  full_name: string;
  district: { id: number; name: string };
  phone: string | null;
  direction: string | null;
  docs: Record<string, DocStatus>;
  overall: string;
};
type ListResp = { total: number; page: number; page_size: number; doc_types: { code: string; name: string }[]; items: Row[] };

const FILTER_KEYS = ["district_id", "q", "direction", "overall", "doc_type", "doc_status", "any_status", "active"] as const;

export default function Mentors() {
  const { me } = useAdmin();
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const page = Number(sp.get("page") || 1);
  const pageSize = Number(sp.get("page_size") || 50);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    FILTER_KEYS.forEach((k) => {
      const v = sp.get(k);
      if (v) f[k] = v;
    });
    return f;
  }, [sp]);

  const { data, loading, reload } = adminAuth.useApi<ListResp>(`/api/admin/mentors${qs({ ...filters, page, page_size: pageSize })}`);
  const { data: districts } = adminAuth.useApi<District[]>("/api/admin/districts");
  const { data: directions } = adminAuth.useApi<string[]>("/api/admin/directions");

  const set = (patch: Record<string, string | undefined | null>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in patch)) next.delete("page");
    setSp(next, { replace: true });
  };

  const docTypes = data?.doc_types || [];
  const districtName = districts?.find((d) => String(d.id) === filters.district_id)?.name;
  const isDistrictAdmin = me.role === "DISTRICT";

  const quick = [
    { label: <>Barchasi</>, f: {} as Record<string, string> },
    { label: <><Dot color={DOC_STATUS.RETURNED.dot} size={8} /> Qaytarilganlar</>, f: { any_status: "RETURNED" } },
    { label: <><Dot color={DOC_STATUS.PENDING.dot} size={8} /> Tekshiruvdagilar</>, f: { any_status: "PENDING" } },
    { label: <><Dot color={DOC_STATUS.MISSING.dot} size={8} /> Hujjat yuklamaganlar</>, f: { any_status: "MISSING" } },
    { label: <><Dot color={OVERALL.COMPLETE.dot} size={8} /> To'liq tasdiqlanganlar</>, f: { overall: "COMPLETE" } },
  ];

  const create = async (v: MentorValues) => {
    try {
      const r = await adminAuth.api("/api/admin/mentors", { body: v });
      setAdding(false);
      reload();
      showCredentials(modal, "Mentor qo'shildi", r.mentor.phone || r.mentor.login, r.password);
    } catch (e: any) {
      message.error(e.message);
      throw e;
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {districtName ? `${districtName} mentorlari` : "Mentorlar"}
          {data && <Typography.Text type="secondary" style={{ fontSize: 15, fontWeight: 400 }}> · {data.total} ta</Typography.Text>}
        </Typography.Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={reload} />
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await adminAuth.download(`/api/admin/mentors/export.xlsx${qs(filters)}`, "mentorlar.xlsx");
              } catch (e: any) {
                message.error(e.message);
              } finally {
                setExporting(false);
              }
            }}
          >
            Excel'ga yuklab olish
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            Mentor qo'shish
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          {quick.map((q, i) => {
            const active =
              Object.entries(q.f).every(([k, v]) => filters[k] === v) &&
              (Object.keys(q.f).length > 0 || (!filters.any_status && !filters.overall));
            return (
              <Button
                key={i}
                size="small"
                type={active ? "primary" : "default"}
                onClick={() => set({ any_status: undefined, overall: undefined, ...q.f })}
              >
                {q.label}
              </Button>
            );
          })}
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="F.I.Sh., telefon, JSHSHIR"
            defaultValue={filters.q}
            onSearch={(v) => set({ q: v })}
            style={{ width: 260 }}
          />
          {!isDistrictAdmin && (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Tuman / shahar"
              style={{ width: 200 }}
              value={filters.district_id ? Number(filters.district_id) : undefined}
              onChange={(v) => set({ district_id: v ? String(v) : undefined })}
              options={districts?.map((d) => ({ value: d.id, label: `${d.name} (${d.mentors})` }))}
            />
          )}
          <Select
            allowClear
            showSearch
            placeholder="Yo'nalish"
            style={{ width: 180 }}
            value={filters.direction}
            onChange={(v) => set({ direction: v })}
            options={directions?.map((d) => ({ value: d, label: d }))}
          />
          <Select
            allowClear
            placeholder="Umumiy holat"
            style={{ width: 210 }}
            value={filters.overall}
            onChange={(v) => set({ overall: v })}
            options={Object.entries(OVERALL).map(([k, v]) => ({ value: k, label: <><Dot color={v.dot} size={8} /> {v.label}</> }))}
          />
          <Space.Compact>
            <Select
              allowClear
              placeholder="Hujjat turi"
              style={{ width: 190 }}
              value={filters.doc_type}
              onChange={(v) => set({ doc_type: v, doc_status: v ? filters.doc_status || "MISSING" : undefined })}
              options={docTypes.map((t) => ({ value: t.code, label: t.name }))}
            />
            <Select
              placeholder="holati"
              style={{ width: 190 }}
              disabled={!filters.doc_type}
              value={filters.doc_status}
              onChange={(v) => set({ doc_status: v })}
              options={(["MISSING", "PENDING", "APPROVED", "RETURNED"] as DocStatus[]).map((s) => ({
                value: s,
                label: <><Dot color={DOC_STATUS[s].dot} size={8} /> {DOC_STATUS[s].label}</>,
              }))}
            />
          </Space.Compact>
          <Select
            style={{ width: 150 }}
            value={filters.active ?? "true"}
            onChange={(v) => set({ active: v === "true" ? undefined : v })}
            options={[
              { value: "true", label: "Faol mentorlar" },
              { value: "false", label: "Nofaol mentorlar" },
            ]}
          />
          {Object.keys(filters).length > 0 && <Button onClick={() => setSp({}, { replace: true })}>Tozalash</Button>}
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items}
          scroll={{ x: 900 }}
          onRow={(r) => ({ onClick: () => nav(`/admin/mentors/${r.id}`), style: { cursor: "pointer" } })}
          pagination={{
            current: page,
            pageSize,
            total: data?.total,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (t) => `Jami: ${t}`,
            onChange: (p, s) => set({ page: String(p), page_size: String(s) }),
          }}
          columns={[
            { title: "№", width: 56, render: (_, __, i) => (page - 1) * pageSize + i + 1 },
            ...(filters.district_id || isDistrictAdmin ? [] : [{ title: "Tuman", width: 160, render: (_: unknown, r: Row) => r.district.name }]),
            {
              title: "F.I.Sh.",
              dataIndex: "full_name",
              render: (v: string, r: Row) => (
                <div>
                  <a>{v}</a>
                  {(r.phone || r.direction) && (
                    <div style={{ fontSize: 12, color: "#888" }}>{[r.phone, r.direction].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
              ),
            },
            ...docTypes.map((t) => ({
              title: t.name,
              width: 120,
              align: "center" as const,
              render: (_: unknown, r: Row) => {
                const s = DOC_STATUS[r.docs[t.code] || "MISSING"];
                return (
                  <Tooltip title={s.label}>
                    <span className="doc-cell"><Dot color={s.dot} size={14} /></span>
                  </Tooltip>
                );
              },
            })),
            { title: "Umumiy holat", width: 210, render: (_, r) => <OverallTag overall={r.overall} /> },
          ]}
        />
      </Card>
      <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
        {(["APPROVED", "PENDING", "MISSING", "RETURNED"] as DocStatus[]).map((s) => (
          <span key={s} style={{ marginRight: 16 }}>
            <Dot color={DOC_STATUS[s].dot} size={8} /> {DOC_STATUS[s].label}
          </span>
        ))}
      </div>
      <MentorForm
        open={adding}
        title="Yangi mentor"
        initial={filters.district_id ? { district_id: Number(filters.district_id) } : me.district ? { district_id: me.district.id } : undefined}
        onCancel={() => setAdding(false)}
        onSubmit={create}
      />
    </div>
  );
}
