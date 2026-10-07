import { DatePicker, Form, Input, Modal, Select, Switch } from "antd";
import dayjs from "dayjs";
import { useEffect } from "react";
import { adminAuth, District } from "./ctx";

export type MentorValues = {
  full_name?: string;
  district_id?: number;
  birth_date?: string | null;
  phone?: string | null;
  login?: string | null;
  passport?: string | null;
  pinfl?: string | null;
  direction?: string | null;
  activity?: string | null;
  telegram_chat_id?: number | null;
  is_active?: boolean;
};

export default function MentorForm(props: {
  open: boolean;
  title: string;
  initial?: MentorValues;
  onCancel: () => void;
  onSubmit: (v: MentorValues) => Promise<void>;
  edit?: boolean;
}) {
  const [form] = Form.useForm();
  const { data: districts } = adminAuth.useApi<District[]>(props.open ? "/api/admin/districts" : null);
  const { data: directions } = adminAuth.useApi<string[]>(props.open ? "/api/admin/directions" : null);

  useEffect(() => {
    if (props.open) {
      form.resetFields();
      const i = props.initial || {};
      form.setFieldsValue({ ...i, birth_date: i.birth_date ? dayjs(i.birth_date) : null, is_active: i.is_active ?? true });
    }
  }, [props.open, props.initial, form]);

  return (
    <Modal
      open={props.open}
      title={props.title}
      onCancel={props.onCancel}
      okText="Saqlash"
      cancelText="Bekor qilish"
      width={640}
      destroyOnClose
      onOk={async () => {
        const v = await form.validateFields();
        const out: MentorValues = { ...v, birth_date: v.birth_date ? v.birth_date.format("YYYY-MM-DD") : null };
        for (const k of ["phone", "login", "passport", "pinfl", "direction", "activity"] as const) out[k] = out[k] ? out[k] : null;
        await props.onSubmit(out);
      }}
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="full_name" label="F.I.Sh." rules={[{ required: true, message: "F.I.Sh. kiriting" }, { min: 3 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="district_id" label="Tuman / shahar" rules={[{ required: true, message: "Hududni tanlang" }]}>
          <Select showSearch optionFilterProp="label" options={districts?.map((d) => ({ value: d.id, label: d.name }))} />
        </Form.Item>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", columnGap: 16 }}>
          <Form.Item name="phone" label="Telefon raqami" extra="Mentor shu raqam bilan tizimga kiradi">
            <Input placeholder="+998 90 123 45 67" />
          </Form.Item>
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
            <Select
              showSearch
              allowClear
              mode={undefined}
              options={directions?.map((d) => ({ value: d, label: d }))}
              dropdownRender={(menu) => menu}
              onSearch={(s) => s && form.setFieldValue("direction", s)}
              filterOption={(i, o) => String(o?.label).toLowerCase().includes(i.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="login" label="Login (ixtiyoriy)" rules={[{ pattern: /^[A-Za-z0-9_.-]{3,64}$/, message: "Lotin harflari, raqamlar" }]}>
            <Input />
          </Form.Item>
        </div>
        <Form.Item name="activity" label="Mentorlik faoliyati">
          <Input.TextArea rows={3} />
        </Form.Item>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", columnGap: 16 }}>
          <Form.Item name="telegram_chat_id" label="Telegram chat ID (ixtiyoriy)" normalize={(v) => (v ? Number(v) || null : null)}>
            <Input />
          </Form.Item>
          {props.edit && (
            <Form.Item name="is_active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </div>
      </Form>
    </Modal>
  );
}
