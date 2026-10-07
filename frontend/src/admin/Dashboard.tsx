import { Card, Col, Progress, Row, Statistic, Table, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { StatusTag } from "../components";
import { adminAuth } from "./ctx";

type DistrictStat = { id: number; name: string; total: number; complete: number; incomplete: number; pending: number; returned: number; missing: number };
type Dash = {
  totals: Omit<DistrictStat, "id" | "name"> & { pending_documents: number };
  districts: DistrictStat[];
  doc_types: { code: string; name: string; MISSING: number; PENDING: number; APPROVED: number; RETURNED: number }[];
};

export default function Dashboard() {
  const nav = useNavigate();
  const { data, loading } = adminAuth.useApi<Dash>("/api/admin/dashboard");
  const t = data?.totals;
  const cards: { title: string; value?: number; color?: string; to: string }[] = [
    { title: "Jami mentorlar", value: t?.total, to: "/admin/mentors" },
    { title: "Hujjatlari to'liq tasdiqlangan", value: t?.complete, color: "#389e0d", to: "/admin/mentors?overall=COMPLETE" },
    { title: "Hujjatlari to'liq emas", value: t?.incomplete, color: "#d48806", to: "/admin/mentors?overall=MISSING" },
    { title: "Tekshiruvda", value: t?.pending, color: "#1f6feb", to: "/admin/mentors?overall=PENDING" },
    { title: "Qayta yuklashi kerak", value: t?.returned, color: "#cf1322", to: "/admin/mentors?any_status=RETURNED" },
    { title: "Tekshirilmagan hujjatlar", value: t?.pending_documents, color: "#1f6feb", to: "/admin/queue" },
  ];
  return (
    <div>
      <Typography.Title level={3} className="page-title">
        Umumiy statistika
      </Typography.Title>
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={12} md={8} xl={4} key={c.title}>
            <Card className="stat-card district-card" loading={loading && !data} onClick={() => nav(c.to)}>
              <Statistic title={c.title} value={c.value ?? 0} valueStyle={{ color: c.color }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Typography.Title level={4} style={{ marginTop: 28 }}>
        Tumanlar (shaharlar)
      </Typography.Title>
      <Row gutter={[16, 16]}>
        {data?.districts.map((d) => {
          const pct = d.total ? Math.round((d.complete / d.total) * 100) : 0;
          return (
            <Col xs={24} sm={12} lg={8} xxl={6} key={d.id}>
              <Card className="district-card" size="small" onClick={() => nav(`/admin/mentors?district_id=${d.id}`)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <Typography.Text strong>{d.name}</Typography.Text>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {d.total} mentor · <span style={{ color: "#389e0d" }}>{d.complete} to'liq</span>
                      {d.pending > 0 && <span style={{ color: "#1f6feb" }}> · {d.pending} tekshiruvda</span>}
                      {d.returned > 0 && <span style={{ color: "#cf1322" }}> · {d.returned} qaytarilgan</span>}
                    </div>
                  </div>
                  <Progress type="circle" percent={pct} size={46} />
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 28 }}>
        <Col xs={24} xl={14}>
          <Card title="Tumanlar kesimida">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              loading={loading}
              dataSource={data?.districts}
              scroll={{ x: 600 }}
              onRow={(r) => ({ onClick: () => nav(`/admin/mentors?district_id=${r.id}`), style: { cursor: "pointer" } })}
              columns={[
                { title: "Tuman", dataIndex: "name" },
                { title: "Jami", dataIndex: "total", align: "right" },
                { title: "To'liq", dataIndex: "complete", align: "right" },
                { title: "To'liq emas", dataIndex: "incomplete", align: "right" },
                { title: "Tekshiruvda", dataIndex: "pending", align: "right" },
                { title: "Qaytarilgan", dataIndex: "returned", align: "right" },
              ]}
              summary={() =>
                t ? (
                  <Table.Summary.Row style={{ fontWeight: 600 }}>
                    <Table.Summary.Cell index={0}>Jami</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">{t.total}</Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">{t.complete}</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">{t.incomplete}</Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">{t.pending}</Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">{t.returned}</Table.Summary.Cell>
                  </Table.Summary.Row>
                ) : null
              }
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="Hujjat turlari bo'yicha">
            <Table
              size="small"
              rowKey="code"
              pagination={false}
              loading={loading}
              dataSource={data?.doc_types}
              scroll={{ x: 420 }}
              columns={[
                { title: "Hujjat", dataIndex: "name", width: 150 },
                ...(["APPROVED", "PENDING", "RETURNED", "MISSING"] as const).map((s) => ({
                  title: <span style={{ whiteSpace: "nowrap" }}><StatusTag status={s} /></span>,
                  dataIndex: s,
                  align: "right" as const,
                  render: (v: number, r: { code: string }) => (
                    <a onClick={() => nav(`/admin/mentors?doc_type=${r.code}&doc_status=${s}`)}>{v}</a>
                  ),
                })),
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
