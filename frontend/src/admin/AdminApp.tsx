import {
  AuditOutlined,
  BellOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  ImportOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Badge, Button, Card, Drawer, Empty, Form, Input, Layout, List, Menu, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { request } from "../api";
import { fmtDate } from "../components";
import { ROLE } from "../labels";
import Audit from "./Audit";
import { AdminCtx, adminAuth, AdminMe } from "./ctx";
import Dashboard from "./Dashboard";
import ImportPage from "./ImportPage";
import MentorDetail from "./MentorDetail";
import Mentors from "./Mentors";
import Queue from "./Queue";
import Settings from "./Settings";

function Login() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const onFinish = async (v: { login: string; password: string }) => {
    setLoading(true);
    try {
      const r = await request<{ token: string }>("/api/admin/login", { body: v });
      adminAuth.setToken(r.token);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="auth-wrap">
      <Card style={{ width: 380, maxWidth: "100%" }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Administrator paneli
        </Typography.Title>
        <Typography.Paragraph type="secondary">Mentorlar hujjatlarini yig'ish va tasdiqlash tizimi</Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="login" label="Login" rules={[{ required: true, message: "Loginni kiriting" }]}>
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Parol" rules={[{ required: true, message: "Parolni kiriting" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Kirish
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
          Mentormisiz? <a href="/kabinet/">Mentor kabinetiga kirish</a>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}

type Notif = { id: number; title: string; body: string; link: string | null; is_read: boolean; created_at: string };

function Shell({ me }: { me: AdminMe }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [notifs, setNotifs] = useState<{ unread: number; items: Notif[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);

  const loadNotifs = () => adminAuth.api("/api/admin/notifications").then(setNotifs).catch(() => {});
  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 30000);
    return () => clearInterval(t);
  }, []);

  const full = me.role !== "DISTRICT";
  const items = [
    { key: "/admin/", icon: <DashboardOutlined />, label: "Statistika" },
    { key: "/admin/mentors", icon: <TeamOutlined />, label: "Mentorlar" },
    { key: "/admin/queue", icon: <FileSearchOutlined />, label: "Tekshirish navbati" },
    { key: "/admin/import", icon: <ImportOutlined />, label: "Excel import" },
    ...(full ? [{ key: "/admin/audit", icon: <AuditOutlined />, label: "Amallar tarixi" }] : []),
    { key: "/admin/settings", icon: <SettingOutlined />, label: "Sozlamalar" },
  ];
  const selected =
    items
      .map((i) => i.key)
      .filter((k) => k !== "/admin/" && loc.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] || "/admin/";

  return (
    <AdminCtx.Provider value={{ me, reloadNotifications: loadNotifs }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Layout.Sider breakpoint="lg" collapsedWidth={0} theme="light" width={230} style={{ borderRight: "1px solid #eee" }}>
          <div style={{ padding: "18px 20px 10px" }}>
            <Typography.Text strong style={{ fontSize: 15 }}>
              Muhammad al-Xorazmiy vorislari
            </Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Mentorlar hujjatlari
              </Typography.Text>
            </div>
          </div>
          <Menu mode="inline" selectedKeys={[selected]} items={items} onClick={(e) => nav(e.key)} style={{ border: 0 }} />
        </Layout.Sider>
        <Layout>
          <Layout.Header
            style={{ background: "#fff", padding: "0 20px", display: "flex", justifyContent: "flex-end", alignItems: "center", borderBottom: "1px solid #eee" }}
          >
            <Space size="middle">
              <Badge count={notifs.unread} size="small">
                <Button shape="circle" icon={<BellOutlined />} onClick={() => setOpen(true)} aria-label="Bildirishnomalar" />
              </Badge>
              <span className="hide-sm">
                <b>{me.full_name || me.username}</b>{" "}
                <Typography.Text type="secondary">
                  ({ROLE[me.role]}
                  {me.district ? `, ${me.district.name}` : ""})
                </Typography.Text>
              </span>
              <Button icon={<LogoutOutlined />} onClick={() => adminAuth.setToken(null)}>
                Chiqish
              </Button>
            </Space>
          </Layout.Header>
          <Layout.Content style={{ padding: 20 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/mentors" element={<Mentors />} />
              <Route path="/mentors/:id" element={<MentorDetail />} />
              <Route path="/queue" element={<Queue />} />
              <Route path="/import" element={<ImportPage />} />
              {full && <Route path="/audit" element={<Audit />} />}
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/admin/" replace />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </Layout>
      <Drawer
        title="Bildirishnomalar"
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button size="small" onClick={() => adminAuth.api("/api/admin/notifications/read", { method: "POST" }).then(loadNotifs)}>
            Hammasini o'qildi
          </Button>
        }
      >
        {notifs.items.length ? (
          <List
            dataSource={notifs.items}
            renderItem={(n) => (
              <List.Item
                style={{ cursor: n.link ? "pointer" : undefined, background: n.is_read ? undefined : "#f0f6ff", padding: "10px 8px" }}
                onClick={() => {
                  if (n.link) {
                    nav(n.link);
                    setOpen(false);
                  }
                }}
              >
                <List.Item.Meta title={n.title} description={<>{n.body}<div style={{ fontSize: 12 }}>{fmtDate(n.created_at)}</div></>} />
              </List.Item>
            )}
          />
        ) : (
          <Empty description="Bildirishnoma yo'q" />
        )}
      </Drawer>
    </AdminCtx.Provider>
  );
}

export default function AdminApp() {
  const token = adminAuth.useToken();
  const [me, setMe] = useState<AdminMe | null>(null);
  useEffect(() => {
    setMe(null);
    if (token) adminAuth.api<AdminMe>("/api/admin/me").then(setMe).catch(() => {});
  }, [token]);
  if (!token) return <Login />;
  if (!me)
    return (
      <div className="auth-wrap">
        <Spin />
      </div>
    );
  return <Shell me={me} />;
}
