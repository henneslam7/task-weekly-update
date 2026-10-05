import type { ReactNode } from "react";

const ragStyles: Record<string, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  done: "bg-slate-200 text-slate-700",
};

export function Rag({ value }: { value: string | null | undefined }) {
  const v = value ?? "none";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase ${ragStyles[v] ?? "bg-slate-100 text-slate-500"}`}>
      {value ?? "n/a"}
    </span>
  );
}

export const inputCls = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm";
export const btnCls = "rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border bg-white p-4 ${className}`}>{children}</section>;
}
