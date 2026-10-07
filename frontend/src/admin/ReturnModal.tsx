import { Form, Input, Modal, Space, Tag } from "antd";
import { useEffect } from "react";
import { RETURN_TEMPLATES } from "../labels";

export default function ReturnModal(props: { open: boolean; docName?: string; onCancel: () => void; onSubmit: (comment: string) => Promise<void> }) {
  const [form] = Form.useForm<{ comment: string }>();
  useEffect(() => {
    if (props.open) form.resetFields();
  }, [props.open, form]);
  return (
    <Modal
      open={props.open}
      title={`Qayta yuklashga qaytarish${props.docName ? `: ${props.docName}` : ""}`}
      okText="Qaytarish"
      okButtonProps={{ danger: true }}
      cancelText="Bekor qilish"
      onCancel={props.onCancel}
      onOk={async () => {
        const v = await form.validateFields();
        await props.onSubmit(v.comment.trim());
      }}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="comment"
          label="Qaytarish sababi (mentorga ko'rsatiladi)"
          rules={[
            { required: true, message: "Sababni yozish majburiy" },
            { min: 3, message: "Kamida 3 ta belgi" },
          ]}
        >
          <Input.TextArea rows={4} autoFocus maxLength={2000} showCount />
        </Form.Item>
      </Form>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>Tayyor izohlar:</div>
      <Space wrap size={[4, 6]}>
        {RETURN_TEMPLATES.map((t) => (
          <Tag key={t} style={{ cursor: "pointer", whiteSpace: "normal" }} onClick={() => form.setFieldValue("comment", t)}>
            {t}
          </Tag>
        ))}
      </Space>
    </Modal>
  );
}
