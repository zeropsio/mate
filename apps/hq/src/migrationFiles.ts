// @effect-diagnostics nodeBuiltinImport:off -- read at build time (vite.config.ts embeds the files in
// the bundle) and by an unbundled run, both before any Effect runtime exists.
/**
 * The migration files, `src/migrations/*.sql`, as data. The deployed bundle has no `src/`, so the
 * build embeds them (`__HQ_MIGRATIONS__`); an unbundled run (the tests) reads the tree.
 *
 * @module migrationFiles
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { Migration } from "./migrations.ts";

/** Every `*.sql` in `dir`, by name. */
export const readMigrations = (dir: string): ReadonlyArray<Migration> =>
  NodeFS.readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => ({ name, sql: NodeFS.readFileSync(NodePath.join(dir, name), "utf8") }));

/** The files of the tree this module sits in. */
export const treeMigrations = (): ReadonlyArray<Migration> =>
  readMigrations(
    NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "migrations"),
  );

declare const __HQ_MIGRATIONS__: ReadonlyArray<Migration> | undefined;

/** The files this build runs: the bundle's embedded copy, else the tree's. */
export const bundledMigrations = (): ReadonlyArray<Migration> =>
  typeof __HQ_MIGRATIONS__ === "undefined" ? treeMigrations() : __HQ_MIGRATIONS__;
