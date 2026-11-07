// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Reads a recorded Stryker report.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  caseInventory,
  classifyTests,
  decodeStrykerReport,
  mutateEntries,
  reportMutants,
  reportTests,
  stringifiedNames,
  testKey,
} from "./mutation-cull.ts";

// Recorded by scripts/mutation-cull.ts on packages/shared/src at a91a2ebf97 ($provenance in the file).
const recording = decodeStrykerReport(
  JSON.parse(
    NodeFS.readFileSync(
      new URL("./fixtures/mutation-cull/dpopCommon.stryker.json", import.meta.url),
      "utf8",
    ),
  ),
);
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
});
