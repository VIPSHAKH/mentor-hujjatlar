export type DocStatus = "MISSING" | "PENDING" | "APPROVED" | "RETURNED" | "REPLACED";
export type Overall = "COMPLETE" | "MISSING" | "PENDING" | "RETURNED";

export const DOC_STATUS: Record<DocStatus, { label: string; dot: string; color: string }> = {
  MISSING: { label: "Yuklanmagan", dot: "#faad14", color: "gold" },
  PENDING: { label: "Tekshirilmoqda", dot: "#1677ff", color: "blue" },
  APPROVED: { label: "Tasdiqlangan", dot: "#52c41a", color: "green" },
  RETURNED: { label: "Qayta yuklash kerak", dot: "#f5222d", color: "red" },
  REPLACED: { label: "Almashtirilgan", dot: "#bfbfbf", color: "default" },
};

export const OVERALL: Record<Overall, { label: string; dot: string; color: string }> = {
  COMPLETE: { label: "To'liq tasdiqlangan", dot: "#52c41a", color: "green" },
  PENDING: { label: "Tekshiruvda", dot: "#1677ff", color: "blue" },
  MISSING: { label: "Hujjatlari to'liq emas", dot: "#faad14", color: "gold" },
  RETURNED: { label: "Qayta yuklashi kerak", dot: "#f5222d", color: "red" },
};

export const ROLE: Record<string, string> = {
  SUPER: "Super administrator",
  ADMIN: "Administrator",
  DISTRICT: "Tuman administratori",
};

export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const RETURN_TEMPLATES = [
  "Hujjatning to'liq nusxasi yuklanmagan. Iltimos, barcha sahifalarini bitta PDF fayl ko'rinishida qayta yuklang.",
  "Nusxa sifatsiz, matn o'qilmayapti. Sifatli nusxasini qayta yuklang.",
  "Hujjatning amal qilish muddati ko'rinmayapti. Sifatli nusxasini qayta yuklang.",
  "Noto'g'ri hujjat yuklangan. Iltimos, to'g'ri hujjatni yuklang.",
];
