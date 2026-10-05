"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkPassword,
  clearFailures,
  createSessionToken,
  isRateLimited,
  recordFailure,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import {
  addAchievement,
  logRequest,
  logWeeklyUpdate,
  upsertProject,
  type Outcome,
  type Priority,
  type ProjectStatus,
  type Rag,
} from "@/lib/services";

/** Empty string -> null; missing field -> undefined (leave untouched). */
function opt(fd: FormData, key: string): string | null | undefined {
  const v = fd.get(key);
  if (v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function req(fd: FormData, key: string): string {
  const s = opt(fd, key);
  if (!s) throw new Error(`${key} is required`);
  return s;
}

export async function loginAction(fd: FormData) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) redirect("/login?error=locked");
  if (!checkPassword(String(fd.get("password") ?? ""))) {
    recordFailure(ip);
    redirect("/login?error=invalid");
  }
  clearFailures(ip);
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function saveProjectAction(fd: FormData) {
  const pct = opt(fd, "progressPct");
  await upsertProject({
    name: req(fd, "name"),
    description: opt(fd, "description"),
    priority: (opt(fd, "priority") ?? undefined) as Priority | undefined,
    status: (opt(fd, "status") ?? undefined) as ProjectStatus | undefined,
    progressPct: pct ? Number(pct) : undefined,
    dueDate: opt(fd, "dueDate"),
    requester: opt(fd, "requester"),
    archived: fd.has("archivedPresent") ? fd.get("archived") === "on" : undefined,
  });
  revalidatePath("/", "layout");
}

export async function saveUpdateAction(fd: FormData) {
  await logWeeklyUpdate({
    project: req(fd, "projectId"),
    weekStart: opt(fd, "weekStart") ?? undefined,
    wins: opt(fd, "wins"),
    progress: opt(fd, "progress"),
    nextSteps: opt(fd, "nextSteps"),
    blockers: opt(fd, "blockers"),
    supportNeeded: opt(fd, "supportNeeded"),
    rag: (opt(fd, "rag") ?? undefined) as Rag | undefined,
  });
  revalidatePath("/", "layout");
}

export async function logRequestAction(fd: FormData) {
  await logRequest({
    fromPerson: req(fd, "fromPerson"),
    summary: req(fd, "summary"),
    outcome: req(fd, "outcome") as Outcome,
    redirectedTo: opt(fd, "redirectedTo"),
    project: opt(fd, "projectId"),
  });
  revalidatePath("/", "layout");
}

export async function addAchievementAction(fd: FormData) {
  await addAchievement({
    title: req(fd, "title"),
    whatWasDone: req(fd, "whatWasDone"),
    metric: opt(fd, "metric"),
    cvBullet: opt(fd, "cvBullet"),
    project: opt(fd, "projectId"),
  });
  revalidatePath("/", "layout");
}
