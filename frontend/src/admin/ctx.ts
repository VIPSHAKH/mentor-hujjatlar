import { createContext, useContext } from "react";
import { makeAuth } from "../api";

export const adminAuth = makeAuth("mh_admin_token");

export type AdminMe = {
  id: number;
  username: string;
  full_name: string | null;
  role: "SUPER" | "ADMIN" | "DISTRICT";
  district: { id: number; name: string } | null;
  telegram_chat_id: number | null;
  is_active: boolean;
};

export const AdminCtx = createContext<{ me: AdminMe; reloadNotifications: () => void } | null>(null);

export function useAdmin() {
  return useContext(AdminCtx)!;
}

export type District = { id: number; name: string; sort_order: number; mentors: number };
