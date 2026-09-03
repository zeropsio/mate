import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { reduceZeropsOperations } from "@t3tools/client-runtime/zerops/operations";
import type { ZeropsCallEntry, ZeropsOperation } from "@t3tools/client-runtime/zerops/operations";
import {
  addMariadb,
  callEntriesFromThread,
  verifyAndRefusedDeploy,
  weatherdashFirstDeploy,
} from "@t3tools/client-runtime/zerops/operations/fixtures";

import { ZeropsOperationCard, type ObservedRegion } from "./ZeropsOperationCard";

const operationsFor = (
  thread: Parameters<typeof callEntriesFromThread>[0],
): ReadonlyArray<ZeropsOperation> =>
  reduceZeropsOperations(callEntriesFromThread(thread)).operations;

describe("ZeropsOperationCard — fixture operations", () => {
  const weatherdash = operationsFor(weatherdashFirstDeploy);
  const mariadb = operationsFor(addMariadb);
  const refused = operationsFor(verifyAndRefusedDeploy);

  it.each([
    {
      name: "bootstrap, done",
      operation: weatherdash.find((o) => o.kind === "bootstrap")!,
    },
    {
      name: "deploy, done",
      operation: weatherdash.find((o) => o.kind === "deploy")!,
    },
    {
      name: "verify, done",
      operation: weatherdash.find((o) => o.kind === "verify")!,
    },
    {
      name: "bootstrap, done (add-mariadb)",
      operation: mariadb.find((o) => o.kind === "bootstrap")!,
    },
    {
      name: "deploy, failed",
      operation: refused.find((o) => o.kind === "deploy" && o.phase === "failed")!,
    },
  ])("renders $name through the operation card shell", ({ operation }) => {
    expect(operation).toBeDefined();
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    expect(html).toContain("data-zerops-card");
    expect(html).toContain(`data-zerops-card-kind="${operation.kind}"`);
    expect(html).toContain(`data-zerops-operation-key="${operation.key}"`);
    expect(html).toContain(operation.kicker);
    expect(html).toContain(operation.voice);
    expect(html).toContain(`data-zerops-voice-source="${operation.voiceSource}"`);
    if (operation.closing !== undefined) {
      expect(html).toContain(operation.closing);
    }
    for (const link of operation.links) {
      expect(html).toContain(link.url);
      expect(html).toContain(link.label);
    }
  });

  it("never renders a raw platform enum for any fixture operation", () => {
    const all = [...weatherdash, ...mariadb, ...refused];
    const html = all
      .map((operation) => renderToStaticMarkup(<ZeropsOperationCard operation={operation} />))
      .join("\n");

    for (const rawEnum of ["ACTIVE", "DEPLOYED", "FINISHED", "PROBED ONLY"]) {
      expect(html).not.toContain(rawEnum);
    }
  });
});

describe("ZeropsOperationCard — running, with an observed region", () => {
  const runningDeployEntry: ZeropsCallEntry = {
    id: "e1",
    createdAt: "2026-09-01T00:00:00.000Z",
    startedAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_deploy",
    input: { targetService: "weatherdash" },
    status: "inProgress",
  };
  const running = reduceZeropsOperations([runningDeployEntry]).operations[0]!;

  const observed: ObservedRegion = {
    steps: [
      { id: "build", label: "Build", state: "done", stateLabel: "Done", durationMs: 4_000 },
      {
        id: "deploy",
        label: "Deploy",
        state: "running",
        stateLabel: "Running",
        durationMs: 38_000,
      },
    ],
    provenance: "live from Zerops · 2 s ago",
    log: <div data-testid="build-log-tail">log tail</div>,
  };

  it("shows the running elapsed clock, step durations, provenance and the log region", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        now={Date.parse("2026-09-01T00:00:42.000Z")}
        observed={observed}
        operation={running}
      />,
    );

    expect(html).toContain("0:42");
    expect(html).toContain("4 s");
    expect(html).toContain("38 s");
    expect(html).toContain("live from Zerops · 2 s ago");
    expect(html).toContain("build-log-tail");
    expect(html).toContain('data-zerops-card-tone="busy"');
  });

  it("shows a settled m/s-style duration once the operation is done and settledAt is known", () => {
    const doneEntry: ZeropsCallEntry = {
      ...runningDeployEntry,
      id: "e2",
      status: "completed",
      settledAt: "2026-09-01T00:01:12.000Z",
      resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
    };
    const done = reduceZeropsOperations([doneEntry]).operations[0]!;
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={done} />);

    expect(html).toContain("1m 12s");
  });
});

describe("ZeropsOperationCard — empty body", () => {
  it("renders no ProcessSteps and no placeholder text when there are no steps and no observed region", () => {
    const entry: ZeropsCallEntry = {
      id: "e3",
      createdAt: "2026-09-01T00:00:00.000Z",
      startedAt: "2026-09-01T00:00:00.000Z",
      turnId: null,
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "inProgress",
    };
    const operation = reduceZeropsOperations([entry]).operations[0]!;
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    expect(operation.steps).toHaveLength(0);
    expect(html).not.toContain('data-zerops-primitive="process-steps"');
  });
});

describe("ZeropsOperationCard — footer detail disclosure", () => {
  it("shows a quiet Details disclosure with the detail text in a scrollable pre block, never a chip", () => {
    const entry: ZeropsCallEntry = {
      id: "e4",
      createdAt: "2026-09-01T00:00:00.000Z",
      startedAt: "2026-09-01T00:00:00.000Z",
      turnId: null,
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "completed",
      resultText: JSON.stringify({
        status: "DEPLOYED",
        targetService: "weatherdash",
        nextActions: "Check the logs for anything unusual.",
      }),
    };
    const operation = reduceZeropsOperations([entry]).operations[0]!;
    expect(operation.detail).toBeDefined();
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Details");
    expect(html).toContain("<pre");
    expect(html).toContain("max-h-40");
    expect(html).toContain(operation.detail!);
    expect(html).not.toContain(`data-zerops-chip-kind="detail"`);
  });
});
