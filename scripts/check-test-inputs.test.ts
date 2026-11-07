// @effect-diagnostics nodeBuiltinImport:off -- Real Git base and working tree.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkTestInputs, findContractInputs } from "./check-test-inputs.ts";
import { testInputFile } from "./gate-input-scopes.ts";

const forms = (source: string) =>
  findContractInputs(source, "a.test.ts").map((input) => input.form);

const hqStream = 'import type { HqNavigationProject } from "@t3tools/shared/hqStream";\n';

describe("Test input guard", () => {
  // witness: scripts/check-test-inputs.ts | if (!names.size && !namespaces.size) return []; → return [];
  it.each([
    [`${hqStream}const p = value as HqNavigationProject;`, ["as"]],
    [`${hqStream}const p = value as unknown as HqNavigationProject;`, ["as"]],
    [`${hqStream}const p = { name: "a" } satisfies Partial<HqNavigationProject>;`, ["satisfies"]],
    [`${hqStream}const p: HqNavigationProject = ({ name: "a" });`, ["annotation"]],
    [
      'import * as Contracts from "@t3tools/contracts";\nconst r = row as Contracts.ThreadId[];',
      ["as"],
    ],
    [
      'import { type ServerSettings } from "@t3tools/contracts/settings";\nconst s = {} as ServerSettings["a"];',
      ["as"],
    ],
  ])("Test input typed as a contract it imports is flagged: %s", (source, expected) => {
    expect(forms(source)).toEqual(expected);
  });

  // witness: scripts/check-test-inputs.ts | contractModule(statement.source.value) → true
  // witness: scripts/check-test-inputs.ts | init.type === "ObjectExpression" && →
  it.each([
    'import type { HqNavigationProject } from "./local.ts";\nconst p = value as HqNavigationProject;',
    'import type { HqWire } from "@t3tools/shared/hqStreamWire";\nconst w = value as HqWire;',
    `${hqStream}const p: HqNavigationProject = recorded("navigation-project.signed-in");`,
    `${hqStream}const ids = ["a"] as const;\nconst n = value as string;`,
  ])("Test input typed as anything else is not flagged: %s", (source) => {
    expect(forms(source)).toEqual([]);
  });

  // witness: scripts/gate-input-scopes.ts | (retainedTestFile.test(path) || /(?:^|\/)__fixtures__\//u.test(path)) → retainedTestFile.test(path)
  it.each([
    ["apps/web/src/components/zerops/SidebarZeropsTree.test.tsx", true],
    ["apps/web/test/scenarios/areas/c-mate/engine-page.scenario.ts", true],
    ["packages/client-runtime/src/data/__fixtures__/hqProjectPeople.ts", true],
    ["packages/client-runtime/src/data/projections/hqProjectPeople.ts", false],
    ["packages/test-recordings/mate-hq/navigation-project.signed-in.json", false],
    [".repos/effect-smol/packages/effect/test/Schema.test.ts", false],
  ])("Only test and fixture sources are scanned: %s", (path, scanned) => {
    expect(testInputFile(path)).toBe(scanned);
  });

  describe("against its base", () => {
    let root: string;
    const write = (path: string, text: string) => {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, path), text);
    };
    const cast = `${hqStream}export const p = value as HqNavigationProject;\n`;
    const plain = `${hqStream}export const p = recorded("navigation-project.signed-in");\n`;
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" });

    beforeAll(() => {
      root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-inputs-"));
      write("a.test.ts", cast);
      write("b.test.ts", plain);
      git("init", "-q");
      git("add", ".");
      git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "base");
      git("branch", "base");
    });
    beforeEach(() => {
      write("a.test.ts", cast);
      write("b.test.ts", plain);
    });
    afterAll(() => NodeFS.rmSync(root, { recursive: true, force: true }));

    // witness: scripts/check-test-inputs.ts | if (after <= before) return []; → return [];
    it("a new contract cast in a test file fails against the base, naming where", () => {
      write("b.test.ts", cast);
      expect(checkTestInputs(root, { base: "base" })).toEqual([
        "Test input typed as a contract grew from 0 to 1 in the changed files; build it with recorded(schema, name, edit?) from @t3tools/test-recordings instead.",
        "  b.test.ts:2:18 (as)",
      ]);
    });

    // witness: scripts/check-test-inputs.ts | if (after <= before) return []; → if (!grown.length) return [];
    it("a contract cast moved from one test file to another passes: only the count may not grow", () => {
      write("a.test.ts", plain);
      write("b.test.ts", cast);
      expect(checkTestInputs(root, { base: "base" })).toEqual([]);
    });
  });
});
