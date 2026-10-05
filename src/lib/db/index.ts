import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// Both neon-http (production) and pglite (tests) satisfy this type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

/** Single-user app: one constant workspace, seeded by the first migration. */
export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

let current: Db | undefined;

/** The one db helper. Services call getDb() and filter by DEFAULT_WORKSPACE_ID. */
export function getDb(): Db {
  if (!current) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    current = drizzle(neon(url), { schema }) as unknown as Db;
  }
  return current;
}

/** Test hook: inject a pglite-backed db. */
export function setDb(db: Db | undefined): void {
  current = db;
}

export { schema };
