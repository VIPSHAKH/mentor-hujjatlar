import { ConfigProvider, App as AntApp } from "antd";
import uzUZ from "antd/locale/uz_UZ";
import dayjs from "dayjs";
import "dayjs/locale/uz-latn";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";

dayjs.locale("uz-latn");

const AdminApp = lazy(() => import("./admin/AdminApp"));
const MentorApp = lazy(() => import("./mentor/MentorApp"));

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    locale={uzUZ}
    theme={{ token: { colorPrimary: "#1f6feb", borderRadius: 10, fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif" } }}
  >
    <AntApp>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="/kabinet/*" element={<MentorApp />} />
            <Route path="*" element={<Navigate to="/kabinet/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AntApp>
  </ConfigProvider>,
);
