// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Reads a recorded Stryker report.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  caseInventory,
  classifyTests,
  decodeStrykerReport,
  directImports,
  mutateEntries,
  reportMutants,
  reportTests,
  settleTimeouts,
  stringifiedNames,
  testKey,
  timeoutPlan,
} from "./mutation-cull.ts";

// Recorded by scripts/mutation-cull.ts on packages/shared/src at a91a2ebf97 ($provenance in each file).
const recorded = (name: string) =>
  decodeStrykerReport(
    JSON.parse(
      NodeFS.readFileSync(new URL(`./fixtures/mutation-cull/${name}`, import.meta.url), "utf8"),
    ),
  );
const recording = recorded("dpopCommon.stryker.json");
const recordedTests = Object.values(recording.testFiles ?? {}).flatMap((file) => file.tests);
const mutatedFile = Object.keys(recording.files)[0]!;
const recordedMutants = recording.files[mutatedFile]!.mutants;
// reportTests keeps the report's test order, so a recorded test's key sits at its own index.
const keyOf = (id: string) =>
  testKey(reportTests(recording)[recordedTests.findIndex((test) => test.id === id)]!);
/** What each recorded test kills, read straight from the report's killedBy ids. */
const killsOf = new Map(
  recordedTests.map((test) => [
    keyOf(test.id),
    new Set(
      recordedMutants.flatMap((mutant, index) =>
        mutant.killedBy?.includes(test.id) ? [index] : [],
      ),
    ),
  ]),
);
const rows = classifyTests(reportTests(recording), reportMutants(recording));
const verdictOf = (verdict: string) => rows.filter((row) => row.verdict === verdict);

describe("mutation cull", () => {
  // witness: scripts/mutation-cull.ts | kills.get(key)?.add(id); → kills.get(key);
  it("calls exactly the tests no mutant fails KILLS-NONE", () => {
    const killNone = new Set(verdictOf("KILLS-NONE").map((row) => testKey(row.test)));
    const expected = new Set(
      [...killsOf].filter(([, kills]) => kills.size === 0).map(([key]) => key),
    );
    expect(expected.size).toBeGreaterThan(0);
    expect(killNone).toEqual(expected);
  });

  // witness: scripts/mutation-cull.ts | [...own].every((id) => kills.get(other)!.has(id)) → [...own].some((id) => kills.get(other)!.has(id))
  it("calls a test DUPLICATE only when the test it names kills every mutant it kills", () => {
    const duplicates = verdictOf("DUPLICATE");
    expect(duplicates.length).toBeGreaterThan(0);
    for (const row of duplicates) {
      const of = row.reason.split("duplicate-of=")[1]!;
      const [line, ...name] = of.split(" ");
      const coveringKey = `${line}\t${name.join(" ")}`;
      expect(coveringKey).not.toBe(testKey(row.test));
      for (const mutant of killsOf.get(testKey(row.test))!)
        expect(killsOf.get(coveringKey)!.has(mutant)).toBe(true);
    }
  });

  // witness: scripts/mutation-cull.ts | .map((id) => mutantById.get(id)!) → .map(() => [...mutantById.values()][0]!)
  it("names as a KILLS test's witness a mutant that test kills", () => {
    const kills = verdictOf("KILLS");
    expect(kills.length).toBeGreaterThan(0);
    for (const row of kills) {
      const killed = [...killsOf.get(testKey(row.test))!].map((index) => recordedMutants[index]!);
      expect(
        killed.some(
          (mutant) =>
            row.mutation.startsWith(`${mutatedFile}:${mutant.location.start.line} |`) &&
            row.mutation.endsWith(`→ ${mutant.replacement}`),
        ),
      ).toBe(true);
    }
  });

  // witness: scripts/mutation-cull.ts | if (!ranFiles.has(test.file)) cases.set(testKey(test), test); → cases.set(testKey(test), test);
  it("lists an it.each table by its run rows, not by the template vitest list prints", () => {
    const listed = [
      { file: "a.test.ts", line: 3, name: "draws $state" },
      { file: "b.test.ts", line: 9, name: "never ran" },
    ];
    const ran = [
      { file: "a.test.ts", line: 3, name: "draws idle" },
      { file: "a.test.ts", line: 3, name: "draws sleep" },
    ];
    expect(caseInventory(listed, ran).map((test) => test.name)).toEqual([
      "draws idle",
      "draws sleep",
      "never ran",
    ]);
  });

  // witness: scripts/mutation-cull.ts | next = end + 1; → next = end;
  it("leaves a function a test rebuilds from its text unmutated and mutates the rest of its file", () => {
    const source = [
      "const a = 1;",
      "",
      "export function check(v) {",
      "  return v > a;",
      "}",
      "export const b = 2;",
    ].join("\n");
    const names = stringifiedNames(["const text = check.toString();"]);
    expect(mutateEntries("src/check.ts", source, names)).toEqual([
      "src/check.ts:1-2",
      "src/check.ts:6-6",
    ]);
    expect(mutateEntries("src/check.ts", source, new Set())).toEqual(["src/check.ts"]);
  });

  // relaySigning.ts's isRecord guard loops past Stryker's hit limit in dpop.test.ts and fails an assertion in
  // relaySigning.test.ts; the main run saw only the limit.
  const timedOut = recorded("relaySigning.stryker.json");
  const reruns = [
    ...reportMutants(recorded("relaySigning.rerun-dpop.stryker.json")),
    ...reportMutants(recorded("relaySigning.rerun-relaySigning.stryker.json")),
  ];

  // witness: scripts/mutation-cull.ts | for (const testFile of testFiles.size === 0 ? [""] : testFiles) { → for (const testFile of [""]) {
  it("re-runs a Timeout mutant once per test file that covers it, at its own source range", () => {
    const plan = timeoutPlan(timedOut);
    expect([...plan.keys()].sort()).toEqual([
      "packages/shared/src/dpop.test.ts",
      "packages/shared/src/relaySigning.test.ts",
    ]);
    // Stryker ranges take 1-based lines and 0-based inclusive columns; the report's columns are 1-based.
    for (const ranges of plan.values())
      expect(ranges).toEqual(
        expect.arrayContaining([
          "packages/shared/src/relaySigning.ts:2:9-2:77",
          "packages/shared/src/relaySigning.ts:9:6-9:21",
        ]),
      );
  });

  // witness: scripts/mutation-cull.ts | const killedBy = [...new Set(runs.flatMap((run) => run.killedBy))].sort(); → const killedBy = [...runs[0]!.killedBy];
  it("counts a Timeout mutant as killed by a test whose file's re-run fails it, though another file's re-run hits the limit", () => {
    const settled = settleTimeouts(reportMutants(timedOut), reruns);
    const guard = settled.find((mutant) => mutant.line === 9 && mutant.column === 7)!;
    expect(guard.status).toBe("Killed");
    expect(guard.killedBy).toEqual([
      "packages/shared/src/relaySigning.test.ts:6\trelaySigning > canonicalizes object keys recursively",
    ]);
  });

  // witness: scripts/mutation-cull.ts | : alias → : undefined
  it("scopes a test file to the files it imports by a relative or a tsconfig paths specifier", () => {
    const scope = "scripts/fixtures/mutation-cull/scope";
    const tracked = new Set(
      [
        "tsconfig.json",
        "src/feature/a.case.mts",
        "src/feature/a.ts",
        "src/feature/d.ts",
        "src/lib/b.ts",
      ].map((file) => `${scope}/${file}`),
    );
    const root = new URL("..", import.meta.url).pathname;
    expect(directImports(root, `${scope}/src/feature/a.case.mts`, tracked)).toEqual([
      `${scope}/src/feature/a.ts`,
      `${scope}/src/lib/b.ts`,
      `${scope}/src/feature/d.ts`,
    ]);
  });
});
