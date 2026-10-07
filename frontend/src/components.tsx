import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Space, Spin, Tag, Timeline, Typography } from "antd";
import dayjs from "dayjs";
import { ReactNode, useEffect, useState } from "react";
import type { Auth } from "./api";
import { DOC_STATUS, DocStatus, fmtSize, Overall, OVERALL } from "./labels";

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, verticalAlign: "middle" }} />;
}

export function StatusTag({ status }: { status: string }) {
  const s = DOC_STATUS[status as DocStatus] ?? DOC_STATUS.MISSING;
  return (
    <Tag color={s.color}>
      <Dot color={s.dot} size={8} /> {s.label}
    </Tag>
  );
}

export function OverallTag({ overall }: { overall: string }) {
  const s = OVERALL[overall as Overall] ?? OVERALL.MISSING;
  return (
    <Tag color={s.color}>
      <Dot color={s.dot} size={8} /> {s.label}
    </Tag>
  );
}

export const fmtDate = (d?: string | null) => (d ? dayjs(d).format("DD.MM.YYYY HH:mm") : "—");

export type Version = {
  id: number;
  version_no: number;
  original_name: string;
  content_type: string;
  size: number;
  status: DocStatus;
  comment: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export type Doc = {
  id: number;
  type: { id: number; code: string; name: string; required: boolean };
  status: DocStatus;
  status_label: string;
  updated_at: string | null;
  latest: Version | null;
  return_comment: string | null;
  upload_count: number;
  versions: Version[];
};

/** Faylni token bilan yuklab, brauzer ichida ko'rsatadi (ochiq URL yo'q). */
export function FileViewer(props: {
  auth: Auth;
  url: string | null;
  contentType?: string;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  downloadName?: string;
}) {
  const { auth, url, contentType, title, onClose, footer, downloadName } = props;
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [type, setType] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let revoked = false;
    let created: string | null = null;
    setObjUrl(null);
    setError(null);
    fetch(url, { headers: { Authorization: `Bearer ${auth.getToken()}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Xato: ${r.status}`);
        const blob = await r.blob();
        if (revoked) return;
        created = URL.createObjectURL(blob);
        setType(contentType || blob.type);
        setObjUrl(created);
      })
      .catch((e) => setError(e.message));
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, auth, contentType]);

  return (
    <Modal
      open={!!url}
      onCancel={onClose}
      title={title}
      width={960}
      style={{ top: 20 }}
      destroyOnClose
      footer={
        <Space wrap style={{ justifyContent: "flex-end", width: "100%" }}>
          {url && (
            <Button
              icon={<DownloadOutlined />}
              onClick={() => auth.download(`${url}${url.includes("?") ? "&" : "?"}download=true`, downloadName || "hujjat")}
            >
              Yuklab olish
            </Button>
          )}
          {footer}
        </Space>
      }
    >
      {error && <Alert type="error" message={error} />}
      {!error && !objUrl && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin />
        </div>
      )}
      {objUrl &&
        (type.includes("pdf") ? (
          <iframe className="viewer-frame" src={objUrl} title="hujjat" />
        ) : (
          <img className="viewer-img" src={objUrl} alt="hujjat" />
        ))}
    </Modal>
  );
}

export function VersionHistory({ versions, onOpen }: { versions: Version[]; onOpen: (v: Version) => void }) {
  if (!versions.length) return <Typography.Text type="secondary">Hali fayl yuklanmagan</Typography.Text>;
  return (
    <Timeline
      style={{ marginTop: 8, marginBottom: -24 }}
      items={versions.map((v) => ({
        color: DOC_STATUS[v.status].color === "gold" ? "orange" : DOC_STATUS[v.status].color === "default" ? "gray" : DOC_STATUS[v.status].color,
        children: (
          <div>
            <Space wrap size={4}>
              <b>{v.version_no}-versiya</b>
              <StatusTag status={v.status} />
              <Typography.Link onClick={() => onOpen(v)}>{v.original_name}</Typography.Link>
              <Typography.Text type="secondary">({fmtSize(v.size)})</Typography.Text>
            </Space>
            <div>
              <Typography.Text type="secondary">Yuklangan: {fmtDate(v.uploaded_at)}</Typography.Text>
              {v.reviewed_at && (
                <Typography.Text type="secondary">
                  {" "}
                  · Ko'rib chiqildi: {fmtDate(v.reviewed_at)}
                  {v.reviewed_by ? ` (${v.reviewed_by})` : ""}
                </Typography.Text>
              )}
            </div>
            {v.comment && <div style={{ color: "#cf1322" }}>Izoh: {v.comment}</div>}
          </div>
        ),
      }))}
    />
  );
}

export function showCredentials(modal: { info: (c: any) => void }, title: string, login: string, password: string) {
  modal.info({
    title,
    width: 460,
    content: (
      <div>
        <p>Ushbu ma'lumotlarni mentorga yetkazing. Parol faqat hozir ko'rsatiladi.</p>
        <p>
          Login: <Typography.Text copyable strong>{login}</Typography.Text>
        </p>
        <p>
          Parol: <Typography.Text copyable strong code>{password}</Typography.Text>
        </p>
        <p>
          Kirish manzili: <Typography.Text copyable>{`${window.location.origin}/kabinet/`}</Typography.Text>
        </p>
      </div>
    ),
  });
}
