import { PlusOutlined } from "@ant-design/icons";
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { useState } from "react";
import { ROLE } from "../labels";
import { adminAuth, AdminMe, District, useAdmin } from "./ctx";

function PasswordTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  return (
    <Card style={{ maxWidth: 420 }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (v) => {
          try {
            await adminAuth.api("/api/admin/password", { body: { old_password: v.old_password, new_password: v.new_password } });
            message.success("Parol o'zgartirildi");
            form.resetFields();
          } catch (e: any) {
            message.error(e.message);
          }
        }}
      >
        <Form.Item name="old_password" label="Joriy parol" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="new_password" label="Yangi parol" rules={[{ required: true, min: 6, message: "Kamida 6 ta belgi" }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Yangi parolni takrorlang"
          dependencies={["new_password"]}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator: (_, v) => (v === getFieldValue("new_password") ? Promise.resolve() : Promise.reject("Parollar mos emas")),
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Saqlash
        </Button>
      </Form>
    </Card>
  );
}

function DistrictsTab({ canEdit }: { canEdit: boolean }) {
  const { message } = App.useApp();
  const { data, loading, reload } = adminAuth.useApi<District[]>("/api/admin/districts");
  const [edit, setEdit] = useState<Partial<District> | null>(null);
  const [form] = Form.useForm();
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (edit?.id) await adminAuth.api(`/api/admin/districts/${edit.id}`, { method: "PATCH", body: v });
      else await adminAuth.api("/api/admin/districts", { body: v });
      setEdit(null);
      reload();
    } catch (e: any) {
      message.error(e.message);
    }
  };
  return (
    <Card
      title="Tumanlar va shaharlar"
      extra={
        canEdit && (
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              form.setFieldsValue({ name: "", sort_order: (data?.length || 0) + 1 });
              setEdit({});
            }}
          >
            Qo'shish
          </Button>
        )
      }
      styles={{ body: { padding: 0 } }}
    >
      <Table<District>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data || []}
        pagination={false}
        columns={[
          { title: "Tartib", dataIndex: "sort_order", width: 80 },
          { title: "Nomi", dataIndex: "name" },
          { title: "Mentorlar", dataIndex: "mentors", width: 110 },
          ...(canEdit
            ? [
                {
                  title: "",
                  width: 200,
                  render: (_: unknown, r: District) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          form.setFieldsValue(r);
                          setEdit(r);
                        }}
                      >
                        Tahrirlash
                      </Button>
                      <Button
                        size="small"
                        danger
                        disabled={r.mentors > 0}
                        onClick={async () => {
                          try {
                            await adminAuth.api(`/api/admin/districts/${r.id}`, { method: "DELETE" });
                            reload();
                          } catch (e: any) {
                            message.error(e.message);
                          }
                        }}
                      >
                        O'chirish
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal open={!!edit} title={edit?.id ? "Hududni tahrirlash" : "Yangi hudud"} onCancel={() => setEdit(null)} onOk={save} okText="Saqlash" cancelText="Bekor qilish">
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Nomi" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sort_order" label="Tartib raqami">
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

type DocType = { id: number; code: string; name: string; description: string | null; is_required: boolean; is_active: boolean; sort_order: number };

function DocTypesTab() {
  const { message } = App.useApp();
  const { data, loading, reload } = adminAuth.useApi<DocType[]>("/api/admin/document-types");
  const [edit, setEdit] = useState<Partial<DocType> | null>(null);
  const [form] = Form.useForm();
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (edit?.id) {
        const { code: _code, ...rest } = v;
        void _code;
        await adminAuth.api(`/api/admin/document-types/${edit.id}`, { method: "PATCH", body: rest });
      } else await adminAuth.api("/api/admin/document-types", { body: v });
      setEdit(null);
      reload();
    } catch (e: any) {
      message.error(e.message);
    }
  };
  return (
    <Card
      title="Hujjat turlari"
      extra={
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            form.setFieldsValue({ code: "", name: "", description: "", is_required: true, is_active: true, sort_order: (data?.length || 0) + 1 });
            setEdit({});
          }}
        >
          Yangi hujjat turi
        </Button>
      }
      styles={{ body: { padding: 0 } }}
    >
      <Table<DocType>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data || []}
        pagination={false}
        columns={[
          { title: "Tartib", dataIndex: "sort_order", width: 80 },
          { title: "Kod", dataIndex: "code", width: 140 },
          { title: "Nomi", dataIndex: "name" },
          { title: "Majburiy", width: 100, render: (_, r) => (r.is_required ? <Tag color="blue">Ha</Tag> : <Tag>Yo'q</Tag>) },
          { title: "Holati", width: 100, render: (_, r) => (r.is_active ? <Tag color="green">Faol</Tag> : <Tag>O'chirilgan</Tag>) },
          {
            title: "",
            width: 120,
            render: (_, r) => (
              <Button
                size="small"
                onClick={() => {
                  form.setFieldsValue(r);
                  setEdit(r);
                }}
              >
                Tahrirlash
              </Button>
            ),
          },
        ]}
      />
      <Modal open={!!edit} title={edit?.id ? "Hujjat turini tahrirlash" : "Yangi hujjat turi"} onCancel={() => setEdit(null)} onOk={save} okText="Saqlash" cancelText="Bekor qilish">
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Kod (lotin, kichik harf)" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]{1,39}$/, message: "Masalan: contract" }]}>
            <Input disabled={!!edit?.id} />
          </Form.Item>
          <Form.Item name="name" label="Nomi" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Mentorga izoh">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="is_required" label="Majburiy" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="is_active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="sort_order" label="Tartib">
              <InputNumber min={0} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

function AdminsTab() {
  const { message } = App.useApp();
  const { me } = useAdmin();
  const { data, loading, reload } = adminAuth.useApi<AdminMe[]>("/api/admin/admins");
  const { data: districts } = adminAuth.useApi<District[]>("/api/admin/districts");
  const [edit, setEdit] = useState<Partial<AdminMe> | null>(null);
  const [form] = Form.useForm();
  const role = Form.useWatch("role", form);
  const save = async () => {
    const v = await form.validateFields();
    const body = { ...v, password: v.password || undefined, telegram_chat_id: v.telegram_chat_id ? Number(v.telegram_chat_id) : null };
    try {
      if (edit?.id) {
        delete body.username;
        await adminAuth.api(`/api/admin/admins/${edit.id}`, { method: "PATCH", body });
      } else await adminAuth.api("/api/admin/admins", { body });
      setEdit(null);
      reload();
    } catch (e: any) {
      message.error(e.message);
    }
  };
  return (
    <Card
      title="Administratorlar"
      extra={
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ role: "DISTRICT", is_active: true });
            setEdit({});
          }}
        >
          Admin qo'shish
        </Button>
      }
      styles={{ body: { padding: 0 } }}
    >
      <Table<AdminMe>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data || []}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: "Login", dataIndex: "username" },
          { title: "F.I.Sh.", dataIndex: "full_name" },
          { title: "Rol", render: (_, r) => ROLE[r.role] },
          { title: "Hudud", render: (_, r) => r.district?.name || "Barchasi" },
          { title: "Holati", render: (_, r) => (r.is_active ? <Tag color="green">Faol</Tag> : <Tag>Bloklangan</Tag>) },
          {
            title: "",
            width: 120,
            render: (_, r) => (
              <Button
                size="small"
                onClick={() => {
                  form.resetFields();
                  form.setFieldsValue({ ...r, district_id: r.district?.id });
                  setEdit(r);
                }}
              >
                Tahrirlash
              </Button>
            ),
          },
        ]}
      />
      <Modal open={!!edit} title={edit?.id ? "Adminni tahrirlash" : "Yangi admin"} onCancel={() => setEdit(null)} onOk={save} okText="Saqlash" cancelText="Bekor qilish">
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="Login" rules={[{ required: !edit?.id, pattern: /^[A-Za-z0-9_.-]{3,64}$/, message: "Lotin harflari, kamida 3 ta" }]}>
            <Input disabled={!!edit?.id} />
          </Form.Item>
          <Form.Item name="full_name" label="F.I.Sh.">
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={edit?.id ? "Yangi parol (o'zgartirish uchun)" : "Parol"}
            rules={[{ required: !edit?.id, message: "Parolni kiriting" }, { min: 6, message: "Kamida 6 ta belgi" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="Rol" rules={[{ required: true }]}>
            <Select disabled={edit?.id === me.id} options={Object.entries(ROLE).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          {role === "DISTRICT" && (
            <Form.Item name="district_id" label="Hudud" rules={[{ required: true, message: "Hududni tanlang" }]}>
              <Select options={districts?.map((d) => ({ value: d.id, label: d.name }))} />
            </Form.Item>
          )}
          <Form.Item name="telegram_chat_id" label="Telegram chat ID (bildirishnomalar uchun)">
            <Input />
          </Form.Item>
          {edit?.id && edit.id !== me.id && (
            <Form.Item name="is_active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}

export default function Settings() {
  const { me } = useAdmin();
  const items = [
    { key: "password", label: "Parolni o'zgartirish", children: <PasswordTab /> },
    { key: "districts", label: "Hududlar", children: <DistrictsTab canEdit={me.role !== "DISTRICT"} /> },
    ...(me.role === "SUPER"
      ? [
          { key: "doctypes", label: "Hujjat turlari", children: <DocTypesTab /> },
          { key: "admins", label: "Administratorlar", children: <AdminsTab /> },
        ]
      : []),
  ];
  return <Tabs items={items} />;
}
