// @effect-diagnostics nodeBuiltinImport:off - the gate reads a database file before the server opens it.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";

import { gatedMateEngine } from "./crewFlipGate.ts";

/** A database holding V1's crew tables with a crew in `state`, or none. */
const database = (state: string | null): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "crew-flip-gate-"));
  const file = NodePath.join(dir, "state.sqlite");
  const db = new NodeSqlite.DatabaseSync(file);
  db.exec(`
    CREATE TABLE crew_definition (crew TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE crew_member (crew TEXT NOT NULL, handle TEXT NOT NULL);
  `);
  if (state !== null) {
    db.exec(`INSERT INTO crew_definition VALUES ('main', '${state}');
      INSERT INTO crew_member VALUES ('main', 'ana');`);
  }
  db.close();
  return file;
};

describe("the flip's crew gate", () => {
  it.each([
    ["holds a Mate with an applied crew on V1", "mate", "applied", false, "v1", ["ana"]],
    ["flips a crew Mate once crew runs on the engine", "mate", "applied", true, "mate", null],
    ["flips a Mate with no crew applied", "mate", null, false, "mate", null],
    ["leaves a Mate asked to run V1 on V1", "v1", "applied", false, "v1", null],
  ] as const)("%s", (_name, asked, crew, crewOnEngine, engine, held) => {
    expect(gatedMateEngine(asked, database(crew), crewOnEngine)).toEqual({ engine, held });
  });

  it("flips a Mate whose database is not there yet", () => {
    expect(
      gatedMateEngine("mate", NodePath.join(NodeOS.tmpdir(), "no-such", "state.sqlite"), false),
    ).toEqual({
      engine: "mate",
      held: null,
    });
  });
});
