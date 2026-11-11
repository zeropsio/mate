// @effect-diagnostics nodeBuiltinImport:off -- a scenario tree on disk, as the gate reads it.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { scenarioCapProblems } from "./check-scenario-caps.ts";
import { scenarioAreasRoot, scenarioCapsFile } from "./gate-input-scopes.ts";

// One tree for the file, emptied before each case.
const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-caps-"));
afterAll(() => NodeFS.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  NodeFS.rmSync(NodePath.join(root, "apps"), { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.join(root, scenarioAreasRoot), { recursive: true });
});

const tree = (caps: Record<string, unknown>, files: Record<string, string>) => {
  NodeFS.writeFileSync(NodePath.join(root, scenarioCapsFile), JSON.stringify(caps));
  for (const [path, source] of Object.entries(files)) {
    const file = NodePath.join(root, scenarioAreasRoot, path);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, source);
  }
};

const journey = `describe("B: menu", () => {
  scenarioSuite((it) => {
    it.effect("the menu shows the Mate's row", () => Effect.void);
    it.effect("a reload keeps the Mate's row", () => Effect.void);
  });
});
`;

describe("scenario area caps", () => {
  // witness: scripts/check-scenario-caps.ts | else if (count > (cap as number)) → else if (count > (cap as number) + 1)
  it("a lane adding a case beyond its area's cap fails, naming the area, its count and its cap", () => {
    tree({ "b-menu": 1 }, { "b-menu/rows.scenario.ts": journey });
    expect(scenarioCapProblems(root)).toEqual([
      "b-menu: 2 cases, cap 1; only the owner raises a cap",
    ]);
    tree({ "b-menu": 2 }, {});
    expect(scenarioCapProblems(root)).toEqual([]);
  });

  // witness: scripts/check-scenario-caps.ts | if (cap === undefined) problems.push(`${area}: no cap in ${scenarioCapsFile}`); → if (cap === undefined) continue;
  it("every directory under the areas needs a cap, and every cap names an area", () => {
    tree({ "b-menu": 2, "z-gone": 3 }, { "b-menu/rows.scenario.ts": journey, "c-mate/dsl.ts": "" });
    expect(scenarioCapProblems(root)).toEqual([
      `c-mate: no cap in ${scenarioCapsFile}`,
      `z-gone: capped in ${scenarioCapsFile}, no such area`,
    ]);
  });

  // witness: scripts/check-scenario-caps.ts | if (!testCase.suite && !testCase.within.includes(uncounted)) → if (!testCase.suite)
  it("cases under the owner-reported layout regressions suite do not count, and a table case counts each row", () => {
    tree(
      { "c-mate": 3 },
      {
        "c-mate/nested/layout.scenario.ts": `describe("owner-reported layout regressions", () => {
  describe("Decision: geometry relations only", () => {
    it.effect("the composer keeps its place", () => Effect.void);
    it.effect("the row keeps its height", () => Effect.void);
  });
});
it.effect.each(["absent", "building", "failed"])("a %s stage shows its state", () => Effect.void);
`,
      },
    );
    expect(scenarioCapProblems(root)).toEqual([]);
    tree({ "c-mate": 2 }, {});
    expect(scenarioCapProblems(root)).toEqual([
      "c-mate: 3 cases, cap 2; only the owner raises a cap",
    ]);
  });
});
