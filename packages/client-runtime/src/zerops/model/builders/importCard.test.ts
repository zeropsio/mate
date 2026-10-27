import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildImportFields } from "./importCard.ts";

const YAML = [
  "project:",
  "  name: z3-eval",
  "services:",
  "  - hostname: apidev",
  "    type: nodejs@22",
  '  - hostname: "db"',
  "    type: postgresql@16",
  "    mode: NON_HA",
].join("\n");

function importCall(input: Record<string, unknown>, result?: unknown): ZeropsCall {
  return {
    id: "c1",
    turnId: "t1",
    toolName: "zerops_import",
    input,
    status: result === undefined ? "inProgress" : "completed",
    ...(result === undefined ? {} : { resultText: JSON.stringify(result) }),
    truncated: false,
    startedAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "a1",
    ...(result === undefined ? {} : { settledAt: "2026-09-01T00:00:30.000Z" }),
    rowIds: new Set(["a1"]),
    agentInternal: false,
  };
}

const process = (service: string, processId: string, status = "FINISHED") => ({
  processId,
  actionName: "stack.create",
  status,
  service,
  serviceId: `svc-${service}`,
});

describe("buildImportFields — targets from the import YAML while it runs", () => {
  it.each([
    {
      name: "every service hostname of inline content",
      input: { content: YAML },
      expected: { subject: "apidev, db", target: "apidev", steps: ["apidev", "db"] },
    },
    {
      name: "none for a file path — the YAML is not in the call",
      input: { filePath: "/var/www/import.yml" },
      expected: { subject: "the services", target: undefined, steps: [] },
    },
    {
      name: "none before the arguments stream in",
      input: {},
      expected: { subject: "the services", target: undefined, steps: [] },
    },
  ])("$name", ({ input, expected }) => {
    const fields = buildImportFields(importCall(input));
    expect({
      subject: fields.subject,
      target: fields.target?.hostname,
      steps: fields.steps.map((step) => step.label),
    }).toEqual(expected);
    expect(fields.steps.every((step) => step.state === "running")).toBe(true);
  });

  it("keeps the YAML's order when the result lists the services differently", () => {
    const fields = buildImportFields(
      importCall({ content: YAML }, { processes: [process("db", "p2"), process("apidev", "p1")] }),
    );
    expect(fields.subject).toBe("apidev, db");
    expect(fields.steps.map((step) => [step.label, step.state])).toEqual([
      ["apidev", "done"],
      ["db", "done"],
    ]);
  });

  it("keeps a YAML-named service the result does not report, under the call's own phase", () => {
    const fields = buildImportFields(
      importCall({ content: YAML }, { processes: [process("apidev", "p1")] }),
    );
    expect(fields.steps.map((step) => [step.label, step.state])).toEqual([
      ["apidev", "done"],
      ["db", "done"],
    ]);
  });
});

describe("buildImportFields — what a settled import started, and why it failed", () => {
  it.each([
    { name: "no process ids while it runs", result: undefined, expected: undefined },
    {
      name: "every process the result names",
      result: { processes: [process("apidev", "p1"), process("db", "p2")] },
      expected: ["p1", "p2"],
    },
  ])("$name", ({ result, expected }) => {
    expect(buildImportFields(importCall({ content: YAML }, result)).processIds).toEqual(expected);
  });

  it.each([
    {
      name: "no explanation for an import that landed",
      result: { processes: [process("apidev", "p1")] },
      expected: undefined,
    },
    {
      name: "the first service error",
      result: {
        processes: [process("apidev", "p1")],
        serviceErrors: [{ service: "db", message: "unknown type postgresql@99\nmore" }],
      },
      expected: { reason: "unknown type postgresql@99" },
    },
    {
      name: "the failed process's reason",
      result: {
        processes: [{ ...process("apidev", "p1", "FAILED"), failReason: "quota exceeded" }],
      },
      expected: { reason: "quota exceeded" },
    },
  ])("$name", ({ result, expected }) => {
    expect(buildImportFields(importCall({ content: YAML }, result)).explanation).toEqual(expected);
  });
});
