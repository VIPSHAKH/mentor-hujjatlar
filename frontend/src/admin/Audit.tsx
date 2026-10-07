import { Card, DatePicker, Select, Space, Table, Typography } from "antd";
import { Dayjs } from "dayjs";
import { useState } from "react";
import { Link } from "react-router-dom";
import { qs } from "../api";
import { fmtDate } from "../components";
import { adminAuth } from "./ctx";

type Row = {
  id: number;
  actor_type: string;
  actor_name: string;
  action: string;
  action_label: string;
  mentor_id: number | null;
  mentor_name: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export default function Audit() {
  const [action, setAction] = useState<string>();
  const [actor, setActor] = useState<string>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);
  const url = `/api/admin/audit${qs({
    action,
    actor_type: actor,
    date_from: range?.[0]?.format("YYYY-MM-DD"),
    date_to: range?.[1]?.format("YYYY-MM-DD"),
    page,
    page_size: 50,
  })}`;
  const { data, loading } = adminAuth.useApi<{ total: number; items: Row[]; actions: Record<string, string> }>(url);
  return (
    <div>
      <Typography.Title level={3} className="page-title">
        Amallar tarixi
      </Typography.Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="Amal turi"
            style={{ width: 260 }}
            value={action}
            onChange={(v) => {
              setAction(v);
              setPage(1);
            }}
            options={Object.entries(data?.actions || {}).map(([k, v]) => ({ value: k, label: v }))}
          />
          <Select
            allowClear
            placeholder="Kim tomonidan"
            style={{ width: 160 }}
            value={actor}
            onChange={(v) => {
              setActor(v);
              setPage(1);
            }}
            options={[
              { value: "admin", label: "Administrator" },
              { value: "mentor", label: "Mentor" },
              { value: "system", label: "Tizim" },
            ]}
          />
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            value={range as any}
            onChange={(v) => {
              setRange(v as any);
              setPage(1);
            }}
          />
        </Space>
      </Card>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data?.items}
          scroll={{ x: 900 }}
          pagination={{ current: page, pageSize: 50, total: data?.total, showSizeChanger: false, onChange: setPage }}
          columns={[
            { title: "Sana", width: 150, render: (_, r) => fmtDate(r.created_at) },
            { title: "Kim", width: 200, render: (_, r) => `${r.actor_name}${r.actor_type === "mentor" ? " (mentor)" : ""}` },
            { title: "Amal", dataIndex: "action_label", width: 220 },
            { title: "Mentor", render: (_, r) => (r.mentor_id && r.mentor_name ? <Link to={`/admin/mentors/${r.mentor_id}`}>{r.mentor_name}</Link> : "") },
            {
              title: "Tafsilot",
              render: (_, r) =>
                r.details
                  ? Object.entries(r.details)
                      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                      .join("; ")
                  : "",
            },
            { title: "IP", dataIndex: "ip", width: 120 },
          ]}
        />
      </Card>
    </div>
  );
}
