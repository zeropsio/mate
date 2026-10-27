// @effect-diagnostics nodeBuiltinImport:off -- Real Git ledger fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  checkTestClock,
  findClockReads,
  ledgerProblems,
  scannedFile,
  type ClockRead,
} from "./check-test-clock.ts";

const directories: string[] = [];
afterEach(() => {
  for (const root of directories.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const reads = (...forms: ClockRead["form"][]) =>
  forms.map((form, index) => ({ line: index + 1, column: 1, form }));

describe("Test clock guard", () => {
  it.each([
    ["Date.now();", ["Date.now()"]],
    ["performance.now();", ["performance.now()"]],
    ["new Date();", ["new Date()"]],
    ["new Date;", ["new Date()"]],
    [
      "const t = { at: Date.now(), d: new Date(), p: performance.now() };",
      ["Date.now()", "new Date()", "performance.now()"],
    ],
    ["new Date(0); new Date(at); Date.parse(text); clock.now(); NativeDate.now();", []],
    ['const text = "Date.now() new Date() performance.now()"; // Date.now()', []],
  ])("A test reading the live clock as %s is flagged", (source, forms) => {
    expect(findClockReads(source, "a.test.ts").map((read) => read.form)).toEqual(forms);
  });

  it("A flagged read names its line and column", () => {
    expect(findClockReads("const a = 1;\n  await wait(Date.now());", "a.test.ts")).toEqual([
      { line: 2, column: 14, form: "Date.now()" },
    ]);
  });

  it.each([
    ["apps/web/src/zerops/accountHq.test.ts", true],
    ["apps/web/test/scenarios/areas/c-mate/engine-page.scenario.ts", true],
    ["apps/web/test/scenarios/fakes/mateEngine.ts", true],
    ["apps/web/test/scenarios/harness/clientClock.ts", false],
    ["apps/web/test/scenarios/fakes/fakeClock.ts", false],
    ["apps/web/src/zerops/accountHq.ts", false],
    [".repos/effect-smol/packages/effect/test/Clock.test.ts", false],
  ])(
    "Only test, scenario and scenario helper files outside the clocks are scanned: %s",
    (path, scanned) => {
      expect(scannedFile(path)).toBe(scanned);
    },
  );

  it.each([
    ["reads within the entry pass", { a: reads("Date.now()") }, { a: 1 }, { a: 1 }, []],
    ["an entry lowered below its base passes", { a: reads("Date.now()") }, { a: 1 }, { a: 2 }, []],
    ["the first ledger seeds without a base", { a: reads("Date.now()") }, { a: 1 }, undefined, []],
    [
      "a read beyond the entry fails at its position",
      { a: reads("Date.now()", "new Date()") },
      { a: 1 },
      { a: 1 },
      [
        "a:1:1 reads Date.now() outside the harness clock (ledger allows 1).",
        "a:2:1 reads new Date() outside the harness clock (ledger allows 1).",
      ],
    ],
    [
      "a raised entry fails even when the reads fit it",
      { a: reads("Date.now()", "Date.now()") },
      { a: 2 },
      { a: 1 },
      ["a: test clock ledger grew 1 → 2; read the harness clock instead."],
    ],
    [
      "a new entry fails",
      { b: reads("performance.now()") },
      { b: 1 },
      {},
      ["b: test clock ledger grew 0 → 1; read the harness clock instead."],
    ],
    [
      "an entry above the reads must be lowered",
      { a: reads("Date.now()") },
      { a: 2 },
      { a: 2 },
      ["a: lower the test clock ledger entry to 1 (currently 2)."],
    ],
    [
      "an entry of a file without reads must be removed",
      { a: [] },
      { a: 1 },
      { a: 1 },
      ["a: remove its test clock ledger entry (currently 1)."],
    ],
  ])("The test clock ledger may only shrink: %s", (_, found, ledger, previous, problems) => {
    expect(ledgerProblems(new Map(Object.entries(found)), ledger, previous)).toEqual(problems);
  });

  it("A repository check reads the ledger at its base and allows the clock modules", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-clock-"));
    directories.push(root);
    const write = (files: Record<string, string>) => {
      for (const [name, source] of Object.entries(files)) {
        NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, name)), { recursive: true });
        NodeFS.writeFileSync(NodePath.join(root, name), source);
      }
    };
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" });
    write({
      "scripts/check-test-clock.ts": "",
      "scripts/test-clock-exceptions.json": JSON.stringify({ "a.test.ts": 1 }),
      "a.test.ts": "Date.now();",
      "apps/web/test/scenarios/fakes/fakeClock.ts": "Date.now(); performance.now();",
      "src/clock.ts": "new Date();",
    });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "ledger");
    git("branch", "base");
    expect(checkTestClock(root, { base: "base" })).toEqual([]);

    write({
      "scripts/test-clock-exceptions.json": JSON.stringify({ "a.test.ts": 2 }),
      "a.test.ts": "Date.now(); new Date();",
    });
    expect(checkTestClock(root, { base: "base" })).toEqual([
      "a.test.ts: test clock ledger grew 1 → 2; read the harness clock instead.",
    ]);
    expect(checkTestClock(root, { base: "base", files: ["src/clock.ts"] })).toEqual([
      "a.test.ts: test clock ledger grew 1 → 2; read the harness clock instead.",
    ]);

    write({ "scripts/test-clock-exceptions.json": JSON.stringify({ "a.test.ts": 1 }) });
    expect(checkTestClock(root, { base: "base", files: ["a.test.ts"] })).toEqual([
      "a.test.ts:1:1 reads Date.now() outside the harness clock (ledger allows 1).",
      "a.test.ts:1:13 reads new Date() outside the harness clock (ledger allows 1).",
    ]);
  });
});
