// @effect-diagnostics nodeBuiltinImport:off — a one-shot boot-time CLI script
// reading local migration files before any Effect runtime/service exists;
// mirrors the precedent in apps/server/src/entrypoint.ts.
/**
 * Applies `migrations/postgres/**` against `DATABASE_URL`, in directory
 * order, tracking what already ran in a `relay_migrations` table keyed by
 * migration directory name (e.g. `20260527044716_baseline`).
 *
 * Each `migration.sql` is drizzle-kit output: one or more DDL statements
 * separated by a `--> statement-breakpoint` marker. A migration's statements
 * and its tracking row are applied in one transaction, so a mid-migration
 * failure never leaves it half-applied-but-unrecorded.
 *
 * Run via `pnpm run migrate` (wired to `node scripts/migrate.ts`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { eq, sql as drizzleSql } from "drizzle-orm";
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

import * as RelayDb from "../src/db.ts";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

// Tracking table only migrate.ts touches — not part of persistence/schema.ts
// since no application code ever reads it.
const relayMigrations = pgTable("relay_migrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface MigrationEntry {
  readonly name: string;
  readonly sqlPath: string;
}

/** Every migration directory under `migrationsDir`, in application order. */
export function listMigrations(migrationsDir: string): ReadonlyArray<MigrationEntry> {
  if (!NodeFS.existsSync(migrationsDir)) {
    return [];
  }
  return NodeFS.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, sqlPath: NodePath.join(migrationsDir, name, "migration.sql") }));
}

/** Splits a drizzle-kit `migration.sql` file into individually-runnable statements. */
export function splitStatements(migrationSql: string): ReadonlyArray<string> {
  return migrationSql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const defaultMigrationsDir = () =>
  NodePath.join(
    NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
    "..",
    "migrations",
    "postgres",
  );

export const runMigrations = (migrationsDir: string) =>
  Effect.gen(function* () {
    const db = yield* RelayDb.RelayDb;
    const transactions = yield* RelayDb.RelayTransactions;

    yield* db.execute(
      drizzleSql.raw(
        `CREATE TABLE IF NOT EXISTS relay_migrations (
          id serial PRIMARY KEY,
          name text NOT NULL UNIQUE,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      ),
    );

    const migrations = listMigrations(migrationsDir);
    for (const migration of migrations) {
      const existing = yield* db
        .select({ name: relayMigrations.name })
        .from(relayMigrations)
        .where(eq(relayMigrations.name, migration.name))
        .limit(1);
      if (existing.length > 0) {
        yield* Effect.log(`migrate: skip ${migration.name} (already applied)`);
        continue;
      }
      const migrationSql = NodeFS.readFileSync(migration.sqlPath, "utf8");
      const statements = splitStatements(migrationSql);
      yield* transactions.withTransaction(
        Effect.gen(function* () {
          for (const statement of statements) {
            yield* db.execute(drizzleSql.raw(statement));
          }
          yield* db.insert(relayMigrations).values({ name: migration.name });
        }),
      );
      yield* Effect.log(`migrate: applied ${migration.name} (${statements.length} statement(s))`);
    }
  });

if (import.meta.main) {
  const dbLayer = RelayDb.RelayTransactions.layer.pipe(Layer.provideMerge(RelayDb.layer));
  runMigrations(defaultMigrationsDir()).pipe(
    Effect.provide(dbLayer),
    Effect.scoped,
    NodeRuntime.runMain,
  );
}
