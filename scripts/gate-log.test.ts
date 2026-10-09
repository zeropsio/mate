// @effect-diagnostics nodeBuiltinImport:off -- host subprocess fixture.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { failureSummary, runLogged } from "./gate-log.ts";

it("shows the first error, a short tail and the complete saved log", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-log-test-"));
  const log = NodePath.join(root, "full.log");
  try {
    const status = runLogged(
      process.execPath,
      [
        "-e",
        "console.error('Error: original cause'); for (let i=0;i<50;i++) console.log('detail '+i); console.error('last detail'); process.exit(7)",
      ],
      { cwd: root, env: process.env },
      log,
    );
    expect(status).toBe(7);
    const full = NodeFS.readFileSync(log, "utf8");
    const summary = failureSummary(full, log);
    expect(summary).toContain("First error: Error: original cause");
    expect(summary).toContain("last detail");
    expect(summary).toContain(`Full log: ${log}`);
    expect(summary).not.toContain("detail 0\n");
    expect(full).toContain("detail 0\n");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
it("a command that cannot start names the error in its saved log", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-log-test-"));
  const log = NodePath.join(root, "full.log");
  try {
    expect(runLogged(NodePath.join(root, "absent"), [], { cwd: root, env: process.env }, log)).toBe(
      1,
    );
    expect(failureSummary(NodeFS.readFileSync(log, "utf8"), log)).toContain("ENOENT");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
it.each([
  "src/config.ts(4,2): error TS2322: incompatible value",
  "TypeError: cannot read field",
  "  x t3code(rule): invalid access",
])("diagnosis skips suggestions and passing test names to show %s", (cause) => {
  const output = `suggestion TS377012: error handling uses Effect\nPASS handles error states\n${cause}\nlast line\n`;
  expect(failureSummary(output, "/tmp/full.log")).toContain(`First error: ${cause}`);
});

it("does not label ordinary output as an error when the process reports no cause", () => {
  expect(failureSummary("runner banner\nsome progress\n", "/tmp/full.log")).toContain(
    "First error: No explicit error line reported",
  );
});

it("failure excerpts retain each failed title, assertion and location without passing output", () => {
  const output = [
    "runner banner",
    "PASS unrelated",
    " FAIL src/a.test.ts > first failure",
    "AssertionError: expected true",
    " ❯ src/a.test.ts:8:2",
    ...Array.from({ length: 100 }, (_, i) => `detail ${i}`),
    " Test Files  1 failed | 100 passed (101)",
    " FAIL src/b.test.ts > second failure",
    "TypeError: missing value",
    " ❯ src/b.test.ts:20:4",
    " Tests  2 failed | 100 passed (102)",
    "Duration 1s",
  ].join("\n");
  const summary = failureSummary(output, "/tmp/full.log");
  for (const expected of [
    "first failure",
    "second failure",
    "AssertionError: expected true",
    "src/a.test.ts:8:2",
    "src/b.test.ts:20:4",
    "Full log: /tmp/full.log",
  ])
    expect(summary).toContain(expected);
  for (const omitted of ["runner banner", "PASS unrelated", "100 passed", "detail 99", "Duration"])
    expect(summary).not.toContain(omitted);
  expect(summary.split("\n").length).toBeLessThanOrEqual(48);
});
