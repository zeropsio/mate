// node:sqlite reads V1's crew tables before the server opens its database.
// @effect-diagnostics nodeBuiltinImport:off
/**
 * The flip's crew gate (the owner's word, 2026-10-08): a Mate with an applied crew flips to the
 * engine only once its crew runs there. Until then the server keeps such a Mate on V1 whatever
 * `T3CODE_MATE_ENGINE` says, and its boot log names the crew, so the flip script (which reads
 * the descriptor and the boot lines) reports a refusal instead of a Mate without its crew.
 *
 * @module crew/engine/crewFlipGate
 */
import * as NodeSqlite from "node:sqlite";

/**
 * Crew runs on the engine: the crew owner is wired and imports V1's crew at the flip
 * (`importV1Crew.ts`). The wiring turns this on when it lands.
 */
export const CREW_ON_ENGINE: boolean = false;

/**
 * The crewmates of V1's applied crew in the server's database, read only; `null` when it has none
 * (no database yet, no crew tables, nothing applied).
 */
export const appliedV1Crew = (dbPath: string): ReadonlyArray<string> | null => {
  let database: NodeSqlite.DatabaseSync | undefined;
  try {
    database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    database.exec("PRAGMA busy_timeout = 1000");
    const rows = database
      .prepare(
        `SELECT m.handle AS handle FROM crew_definition d
         LEFT JOIN crew_member m ON m.crew = d.crew
         WHERE d.state = 'applied' ORDER BY m.rowid`,
      )
      .all();
    if (rows.length === 0) return null;
    return rows.flatMap((row) => (typeof row.handle === "string" ? [row.handle] : []));
  } catch {
    return null;
  } finally {
    database?.close();
  }
};

/** The boot line of a Mate the gate keeps on V1. */
export const crewHeldWords = (handles: ReadonlyArray<string>): string =>
  `Mate engine held: this Mate's crew (${handles.map((handle) => `@${handle}`).join(", ")}) stays on V1 until crew runs on the engine.`;

/** The engine a Mate runs: the one asked for, unless its crew would be left behind. */
export const gatedMateEngine = (
  asked: "v1" | "mate",
  dbPath: string,
  crewOnEngine: boolean = CREW_ON_ENGINE,
): { readonly engine: "v1" | "mate"; readonly held: ReadonlyArray<string> | null } => {
  if (asked !== "mate" || crewOnEngine) return { engine: asked, held: null };
  const held = appliedV1Crew(dbPath);
  return held === null ? { engine: "mate", held: null } : { engine: "v1", held };
};
