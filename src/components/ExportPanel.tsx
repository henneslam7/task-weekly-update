"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnCls } from "./ui";

type Result = {
  dryRun: boolean;
  slideText?: string;
  /** Sheet exports return the rows as a text table. */
  text?: string;
  warnings: string[];
  downloadUrl?: string;
  downloadPath?: string;
  expiresAt?: string;
  error?: string;
};

export function ExportPanel({ weekStart }: { weekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"dry" | "export" | "sheetDry" | "sheet" | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(dryRun: boolean, sheet = false) {
    setBusy(sheet ? (dryRun ? "sheetDry" : "sheet") : dryRun ? "dry" : "export");
    setErr(null);
    setRes(null);
    try {
      const r = await fetch(sheet ? "/api/export/sheet" : "/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart, dryRun }),
      });
      const j = (await r.json().catch(() => ({}))) as Result & { error?: string };
      if (!r.ok) setErr(j.error ?? `Request failed (${r.status})`);
      else setRes(j);
      if (!dryRun) router.refresh();
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnCls} disabled={busy !== null} onClick={() => run(true)}>
          {busy === "dry" ? "Planning..." : "Preview slide text"}
        </button>
        <button type="button" className={btnCls} disabled={busy !== null} onClick={() => run(false)}>
          {busy === "export" ? "Exporting..." : "Export deck"}
        </button>
        <span className="mx-1 text-slate-300">|</span>
        <button type="button" className={btnCls} disabled={busy !== null} onClick={() => run(true, true)}>
          {busy === "sheetDry" ? "Planning..." : "Preview Excel rows"}
        </button>
        <button type="button" className={btnCls} disabled={busy !== null} onClick={() => run(false, true)}>
          {busy === "sheet" ? "Exporting..." : "Export Excel (.xlsx)"}
        </button>
      </div>
      {err && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      {res?.warnings?.length ? (
        <ul className="list-disc pl-5 text-sm text-amber-800">{res.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      ) : null}
      {(res?.downloadUrl || res?.downloadPath) && (
        <p className="text-sm">
          <a className="font-medium underline" href={res.downloadUrl ?? res.downloadPath}>Download file</a>
          <span className="text-slate-500"> link valid for 10 minutes</span>
        </p>
      )}
      {res?.dryRun && <pre className="overflow-x-auto whitespace-pre-wrap rounded border bg-slate-50 p-3 text-xs">{res.slideText ?? res.text}</pre>}
    </div>
  );
}
