import { eq } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";
import { assertDateFormat, sheetConfigFrom, type SheetConfig } from "../sheet/config";

const { workspace } = schema;

export type WorkspaceSettings = {
  name: string;
  ownerFullName: string | null;
  /** Effective Excel settings (defaults merged with stored overrides). */
  sheet: SheetConfig;
};

export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  const [w] = await getDb().select().from(workspace).where(eq(workspace.id, DEFAULT_WORKSPACE_ID));
  if (!w) throw new Error("Default workspace not found. Run the database migrations.");
  return { name: w.name, ownerFullName: w.ownerFullName, sheet: sheetConfigFrom(w.brandConfig) };
}

/** Update the owner's full name (Excel group row) and/or the Excel output settings. Omitted fields are unchanged. */
export async function updateWorkspaceSettings(input: {
  ownerFullName?: string | null;
  sheet?: Partial<SheetConfig>;
}): Promise<WorkspaceSettings> {
  const db = getDb();
  const [w] = await db.select().from(workspace).where(eq(workspace.id, DEFAULT_WORKSPACE_ID));
  if (!w) throw new Error("Default workspace not found. Run the database migrations.");
  const set: Partial<typeof workspace.$inferInsert> = {};
  if (input.ownerFullName !== undefined) set.ownerFullName = input.ownerFullName?.trim() || null;
  if (input.sheet) {
    for (const [k, v] of Object.entries(input.sheet)) {
      if (typeof v !== "string") continue;
      if (k.endsWith("Format")) assertDateFormat(k, v);
    }
    const next = { ...(w.brandConfig ?? {}), sheet: { ...((w.brandConfig?.sheet as object) ?? {}), ...input.sheet } };
    sheetConfigFrom(next); // validate the merged result before saving
    set.brandConfig = next;
  }
  if (Object.keys(set).length) await db.update(workspace).set(set).where(eq(workspace.id, DEFAULT_WORKSPACE_ID));
  return getWorkspaceSettings();
}
