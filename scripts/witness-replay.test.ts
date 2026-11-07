// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- host replay script over recorded Vitest reports.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, expect, it } from "vite-plus/test";
import {
  decodeVitestReport,
  judge,
  replayWitnesses,
  witnessedCases,
  type Runner,
  type VitestReport,
} from "./witness-replay.ts";

const repository = NodePath.resolve(import.meta.dirname, "..");

// Recorded from the real server suite; `$provenance.source` holds the command and mutation.
const recording = (name: string): VitestReport =>
  decodeVitestReport(
    JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(import.meta.dirname, "fixtures/witness-replay", `${name}.json`),
        "utf8",
      ),
    ).value,
  );

const serverTest = "apps/server/src/spi/serverCommandReadiness.test.ts";
const [serverCase] = witnessedCases(
  serverTest,
  NodeFS.readFileSync(NodePath.join(repository, serverTest), "utf8"),
);

// witness: scripts/witness-replay.ts | /^AssertionError\b/u → /^AssertError\b/u
it("an it.effect case its owner's mutation fails on an assertion replays as witnessed", () => {
  expect(judge(serverCase!, recording("passed"), recording("effect-assertion"))).toEqual({
    witnessed: true,
  });
});

// witness: scripts/witness-replay.ts | after.kind === "assertion" → after.kind !== "passed"
it("a mutation that only breaks the owner's import is reported as not witnessed", () => {
  expect(judge(serverCase!, recording("passed"), recording("import-error")).witnessed).toBe(false);
});

// witness: scripts/witness-replay.ts | if (after.kind === "assertion") return { witnessed: true }; → return { witnessed: true };
it("a witness on a case that stays green under its mutation fails", () => {
  expect(judge(serverCase!, recording("passed"), recording("passed")).witnessed).toBe(false);
});

// witness: scripts/witness-replay.ts | !before.has(key(testCase.titles[0], witness)) → true
it("a lane replays only the witnesses new or changed against its base", () => {
  const base = [
    "// witness: src/a.ts | one → two",
    'it("keeps its witness", () => {});',
    "// witness: src/b.ts | three → four",
    'it("changes its witness", () => {});',
  ].join("\n");
  const head = [
    "// witness: src/a.ts | one → two",
    'it("keeps its witness", () => {});',
    "// witness: src/b.ts | three → five",
    'it("changes its witness", () => {});',
    "// witness: src/c.ts | six → seven",
    'it("is a new case", () => {});',
  ].join("\n");
  expect(
    witnessedCases("lane.test.ts", head, base).map(({ titles, witness }) => [titles[0], witness]),
  ).toEqual([
    ["changes its witness", "src/b.ts | three → five"],
    ["is a new case", "src/c.ts | six → seven"],
  ]);
});

// A product file with a BOM and CRLF lines, so a text round trip could not pass for a restore.
const original = Buffer.from("﻿export const limit = 1;\r\nexport const mode = 'a';\r\n", "utf8");
const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-witness-replay-"));
afterAll(() => NodeFS.rmSync(scratch, { recursive: true, force: true }));
const owner = NodePath.join(scratch, "scripts/owner.ts");
NodeFS.mkdirSync(NodePath.dirname(owner), { recursive: true });
NodeFS.writeFileSync(NodePath.join(scratch, "scripts/owner.test.ts"), "export {};\n");
const ownerReplay = (witness: string) => ({
  file: "scripts/owner.test.ts",
  line: 1,
  titles: ["owner case"],
  witness,
});

// witness: scripts/witness-replay.ts | NodeFS.writeFileSync(absolute, original); →
it("the owner file is byte-identical after a replay interrupted by a thrown error", async () => {
  NodeFS.writeFileSync(owner, original);
  const run: Runner = async () => {
    if (!NodeFS.readFileSync(owner).equals(original)) throw new Error("interrupted");
    return recording("passed");
  };
  await expect(
    replayWitnesses(scratch, [ownerReplay("scripts/owner.ts | limit = 1 → limit = 2")], {
      workspace: [],
      run,
      jobs: 1,
      print: () => {},
    }),
  ).rejects.toThrow("interrupted");
  expect(NodeFS.readFileSync(owner).equals(original)).toBe(true);
});

// witness: scripts/witness-replay.ts | left.owner === right.owner || →
it("replays of one owner run one at a time, each over the original bytes", async () => {
  NodeFS.writeFileSync(owner, original);
  const seen: string[] = [];
  const run: Runner = async () => {
    const current = NodeFS.readFileSync(owner);
    if (current.equals(original)) return recording("passed");
    seen.push(current.toString("utf8"));
    return recording("effect-assertion");
  };
  await replayWitnesses(
    scratch,
    [
      ownerReplay("scripts/owner.ts | limit = 1 → limit = 2"),
      ownerReplay("scripts/owner.ts | mode = 'a' → mode = 'b'"),
    ],
    { workspace: [], run, jobs: 2, print: () => {} },
  );
  expect(seen.sort()).toEqual(
    [
      "﻿export const limit = 2;\r\nexport const mode = 'a';\r\n",
      "﻿export const limit = 1;\r\nexport const mode = 'b';\r\n",
    ].sort(),
  );
  expect(NodeFS.readFileSync(owner).equals(original)).toBe(true);
});
