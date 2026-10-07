import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; token?: string | null };

export async function request<T = any>(url: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  if (!res.ok) {
    let msg = `Xato: ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
      else if (Array.isArray(data.detail)) msg = data.detail.map((d: any) => d.msg).join("; ");
    } catch {
      /* JSON emas */
    }
    throw new ApiError(res.status, msg);
  }
  const type = res.headers.get("content-type") || "";
  return (type.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

export type Auth = ReturnType<typeof makeAuth>;

/** Admin va mentor tokenlari alohida saqlanadi. */
export function makeAuth(key: string) {
  const event = `auth-change:${key}`;
  const getToken = (): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const setToken = (t: string | null) => {
    try {
      if (t) localStorage.setItem(key, t);
      else localStorage.removeItem(key);
    } catch {
      /* private rejim */
    }
    window.dispatchEvent(new Event(event));
  };
  async function api<T = any>(url: string, opts: Omit<Opts, "token"> = {}): Promise<T> {
    try {
      return await request<T>(url, { ...opts, token: getToken() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken(null);
      throw e;
    }
  }
  function useToken() {
    const [token, setTok] = useState(getToken());
    useEffect(() => {
      const h = () => setTok(getToken());
      window.addEventListener(event, h);
      return () => window.removeEventListener(event, h);
    }, []);
    return token;
  }
  function useApi<T>(url: string | null, deps: unknown[] = []) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reload = useCallback(async () => {
      if (!url) return;
      setLoading(true);
      try {
        setData(await api<T>(url));
        setError(null);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, ...deps]);
    useEffect(() => {
      reload();
    }, [reload]);
    return { data, loading, error, reload, setData };
  }
  async function download(url: string, fallbackName: string) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) {
      let msg = `Xato: ${res.status}`;
      try {
        msg = (await res.json()).detail || msg;
      } catch {
        /* */
      }
      throw new Error(msg);
    }
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
    saveBlob(await res.blob(), m ? decodeURIComponent(m[1]) : fallbackName);
  }
  return { getToken, setToken, api, useToken, useApi, download };
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function base64ToBlob(b64: string, type: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

export function qs(params: Record<string, unknown>) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}
