import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// 有 DATABASE_URL 时连 Supabase（Postgres）；没有时用本地内嵌 PGlite 兜底，
// 数据存在 app/.data/，不进仓库。两者共用同一份 Drizzle schema 与迁移。
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbKind = "postgres" | "pglite";

const globalForDb = globalThis as unknown as { db?: Db; dbKind?: DbKind };

function create(): { db: Db; kind: DbKind } {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Supabase transaction pooler（6543）不支持预备语句，需关闭。
    const sql = postgres(url, { prepare: false });
    return { db: drizzlePostgres(sql, { schema }) as unknown as Db, kind: "postgres" };
  }
  // next build 会用多个 worker 加载模块；构建阶段用内存库，避免争用同一个数据目录。
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const dataDir = process.env.PGLITE_DIR ?? "./.data/pglite";
  if (!isBuild) mkdirSync(dataDir, { recursive: true });
  const client = isBuild ? new PGlite() : new PGlite(dataDir);
  // PGlite 只在正常关闭时把数据落盘；进程被结束时先关库，否则本地数据目录会损坏。
  if (!isBuild) {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.once(sig, () => {
        client.close().finally(() => process.exit(0));
      });
    }
  }
  return { db: drizzlePglite(client, { schema }) as unknown as Db, kind: "pglite" };
}

if (!globalForDb.db) {
  const created = create();
  globalForDb.db = created.db;
  globalForDb.dbKind = created.kind;
}

export const db = globalForDb.db;
export const dbKind = globalForDb.dbKind!;
export { schema };
