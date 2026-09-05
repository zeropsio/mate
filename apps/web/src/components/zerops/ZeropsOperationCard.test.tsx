import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  deriveZeropsThreadModel,
  reduceZeropsOperations,
  type ZeropsCall,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";
import {
  addMariadb,
  verifyAndRefusedDeploy,
  weatherdashFirstDeploy,
  type ZeropsShowcaseThread,
} from "@t3tools/client-runtime/zerops/operations/fixtures";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ScopedThreadRef } from "@t3tools/contracts";

const panelTestState = vi.hoisted(() => ({
  onOpen: null as (() => void) | null,
  open: vi.fn(),
}));

vi.mock("~/components/ui/tooltip", async (importOriginal) => {
  const React = await import("react");
  const original = await importOriginal<typeof import("~/components/ui/tooltip")>();
  return {
    ...original,
    TooltipTrigger: ({
      children,
      render,
    }: {
      readonly children: React.ReactNode;
      readonly render: React.ReactElement<{ readonly onClick?: () => void }>;
    }) => {
      panelTestState.onOpen = render.props.onClick ?? null;
      return React.cloneElement(render, undefined, children);
    },
  };
});

vi.mock("../../rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ open: panelTestState.open }),
  },
}));

import { ZeropsOperationCard, type ObservedRegion } from "./ZeropsOperationCard";

/** Every `ZeropsOperation` (card kind) a real captured thread's activities fold into. */
function operationsFor(thread: ZeropsShowcaseThread): ReadonlyArray<ZeropsOperation> {
  return deriveZeropsThreadModel({ activities: thread.activities })
    .entries.filter(
      (entry): entry is Extract<typeof entry, { kind: "operation" }> => entry.kind === "operation",
    )
    .map((entry) => entry.operation);
}

/** A hand-built `ZeropsCall`, defaulting the fields these tests never vary. */
function zeropsCall(overrides: {
  readonly id: string;
  readonly toolName: string;
  readonly status: ZeropsCall["status"];
  readonly startedAt: string;
  readonly turnId?: string | null;
  readonly input?: Record<string, unknown>;
  readonly resultText?: string;
  readonly settledAt?: string;
  readonly truncated?: boolean;
}): ZeropsCall {
  return {
    turnId: null,
    input: {},
    truncated: false,
    anchorActivityId: overrides.id,
    rowIds: new Set([overrides.id]),
    agentInternal: false,
    ...overrides,
  };
}

/** One call folds into exactly one operation — the reducer's output for a single-call fixture. */
function operationFor(call: ZeropsCall): ZeropsOperation {
  return reduceZeropsOperations([call]).operations[0]!;
}

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
  const running = operationFor(
    zeropsCall({
      id: "e1",
      startedAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "inProgress",
    }),
  );

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
    const done = operationFor(
      zeropsCall({
        id: "e2",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        settledAt: "2026-09-01T00:01:12.000Z",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={done} />);

    expect(html).toContain("1m 12s");
  });
});

describe("ZeropsOperationCard — dev server", () => {
  const operation = operationFor(
    zeropsCall({
      id: "dev1",
      startedAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_dev_server",
      input: { action: "start", hostname: "apidev" },
      status: "completed",
      resultText: JSON.stringify({
        action: "start",
        hostname: "apidev",
        running: true,
        port: 3000,
      }),
    }),
  );

  it("renders the dev-server card with an Open link only when a subdomain URL is supplied", () => {
    const withoutUrl = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    expect(withoutUrl).not.toContain("Open");
    expect(withoutUrl).toContain("dev server running on apidev:3000.");

    const withUrl = renderToStaticMarkup(
      <ZeropsOperationCard
        devServerUrl="https://apidev-26a7-3000.prg1.zerops.app"
        operation={operation}
      />,
    );
    expect(withUrl).toContain("Open");
    expect(withUrl).toContain("https://apidev-26a7-3000.prg1.zerops.app");
  });

  it("ignores a devServerUrl prop for a non-devServer operation", () => {
    const deployOperation = operationFor(
      zeropsCall({
        id: "dev2",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
      }),
    );
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        devServerUrl="https://apidev-26a7-3000.prg1.zerops.app"
        operation={deployOperation}
      />,
    );
    expect(html).not.toContain("apidev-26a7-3000.prg1.zerops.app");
  });
});

describe("ZeropsOperationCard — browser", () => {
  const THREAD_REF: ScopedThreadRef = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
  };

  const operation = operationFor(
    zeropsCall({
      id: "brw1",
      startedAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: JSON.stringify({
        url: "https://kanbandev-26a7.prg1.zerops.app",
        steps: [
          { command: ["open", "https://kanbandev-26a7.prg1.zerops.app"], success: true },
          {
            command: ["click", "@e1"],
            success: false,
            error: "no element matched @e1",
            errorKind: "selector-not-found",
          },
          { command: ["screenshot", "/tmp/shot.png"], success: true },
          { command: ["errors"], success: true },
          { command: ["console"], success: true },
          { command: ["network", "requests", "--status", "400-599"], success: true },
          { command: ["close"], success: true },
        ],
        errorsOutput: ["TypeError: x is not a function"],
        consoleOutput: [{ type: "error", text: "failed to fetch" }],
        networkOutput: [],
      }),
    }),
  );

  it("renders the condensed line and the full step list only inside the Show steps expander; the plumbing tail never appears", () => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    expect(html).toContain(operation.browserSummary!.line);
    expect(html).toContain("open https://kanbandev-26a7.prg1.zerops.app");
    expect(html).toContain("click @e1");
    expect(html).toContain("Show steps");
    expect(html).not.toContain("screenshot /tmp/shot.png");
    expect(html).not.toMatch(/>\s*errors\s*</);
    expect(html).not.toContain("network requests --status 400-599");
  });

  it("a failed step is always visible with the steps collapsed", () => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const detailsIndex = html.indexOf("<details");
    const failedStepIndex = html.indexOf("click @e1");
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(failedStepIndex).toBeGreaterThan(-1);
    expect(failedStepIndex).toBeLessThan(detailsIndex);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("renders the live frame while the call is in progress and the screenshot once it completes", () => {
    const runningHtml = renderToStaticMarkup(
      <ZeropsOperationCard
        live
        liveFrame={{ src: "data:image/jpeg;base64,LIVE", width: 640, height: 360 }}
        operation={operation}
      />,
    );
    expect(runningHtml).toContain("data:image/jpeg;base64,LIVE");
    expect(runningHtml).not.toContain("data:image/png;base64,DONE");

    const doneHtml = renderToStaticMarkup(
      <ZeropsOperationCard
        browserScreenshot={{ src: "data:image/png;base64,DONE", width: 1280, height: 720 }}
        live={false}
        liveFrame={{ src: "data:image/jpeg;base64,LIVE", width: 640, height: 360 }}
        operation={operation}
      />,
    );
    expect(doneHtml).toContain("data:image/png;base64,DONE");
    expect(doneHtml).not.toContain("data:image/jpeg;base64,LIVE");
  });

  it("renders the last frame when a completed call carried no screenshot", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        live={false}
        liveFrame={{ src: "data:image/jpeg;base64,LASTFRAME", width: 640, height: 360 }}
        operation={operation}
      />,
    );
    expect(html).toContain("data:image/jpeg;base64,LASTFRAME");
  });

  it("ignores browserScreenshot/liveFrame props for a non-browser operation", () => {
    const deployOperation = operationFor(
      zeropsCall({
        id: "brw2",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
      }),
    );
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        browserScreenshot={{ src: "data:image/png;base64,AAAA" }}
        live
        liveFrame={{ src: "data:image/jpeg;base64,BBBB", width: 640, height: 360 }}
        operation={deployOperation}
      />,
    );
    expect(html).not.toContain("data-zerops-browser-viewport");
    expect(html).not.toContain("data:image/png;base64,AAAA");
    expect(html).not.toContain("data:image/jpeg;base64,BBBB");
  });

  it("clicking the viewport opens the Browser panel", () => {
    panelTestState.onOpen = null;
    panelTestState.open.mockClear();
    renderToStaticMarkup(
      <ZeropsOperationCard
        browserScreenshot={{ src: "data:image/png;base64,AAAA", width: 1280, height: 720 }}
        operation={operation}
        threadRef={THREAD_REF}
      />,
    );
    const onOpen = panelTestState.onOpen as (() => void) | null;
    expect(onOpen).not.toBeNull();
    (onOpen as () => void)();
    expect(panelTestState.open).toHaveBeenCalledWith(THREAD_REF, "browser");
  });
});

describe("ZeropsOperationCard — empty body", () => {
  it("renders no ProcessSteps and no placeholder text when there are no steps and no observed region", () => {
    const operation = operationFor(
      zeropsCall({
        id: "e3",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: null,
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "inProgress",
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    expect(operation.steps).toHaveLength(0);
    expect(html).not.toContain('data-zerops-primitive="process-steps"');
  });
});

describe("ZeropsOperationCard — footer detail disclosure", () => {
  it("shows a quiet Details disclosure with the detail text in a scrollable pre block, never a chip", () => {
    const operation = operationFor(
      zeropsCall({
        id: "e4",
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
      }),
    );
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

describe("ZeropsOperationCard — durations against the real fixture (regression)", () => {
  const weatherdash = operationsFor(weatherdashFirstDeploy);
  const deploy = weatherdash.find((o) => o.kind === "deploy")!;
  const verify = weatherdash.find((o) => o.kind === "verify")!;
  const bootstrap = weatherdash.find((o) => o.kind === "bootstrap")!;

  it("the deploy operation's settledAt - anchorAt is ~75.9s and the card shows 1m 16s", () => {
    const elapsedMs = Date.parse(deploy.settledAt!) - Date.parse(deploy.anchorAt);
    expect(elapsedMs).toBeGreaterThan(75_000);
    expect(elapsedMs).toBeLessThan(77_000);

    const html = renderToStaticMarkup(<ZeropsOperationCard operation={deploy} />);
    expect(html).toContain("1m 16s");
    expect(html).not.toContain("0 s");
  });

  it("the verify and bootstrap operations also show a nonzero duration", () => {
    const verifyHtml = renderToStaticMarkup(<ZeropsOperationCard operation={verify} />);
    const bootstrapHtml = renderToStaticMarkup(<ZeropsOperationCard operation={bootstrap} />);
    expect(verifyHtml).toContain("6 s");
    expect(verifyHtml).not.toContain("0 s");
    expect(bootstrapHtml).toContain("55 s");
    expect(bootstrapHtml).not.toContain("0 s");
  });
});

describe("ZeropsOperationCard — the duration renders outside the uppercase status label", () => {
  it("keeps the running elapsed clock out of the StatusDot's own MicroLabel, in a separate tabular-nums span", () => {
    const running = operationFor(
      zeropsCall({
        id: "dur-running",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "inProgress",
      }),
    );
    const html = renderToStaticMarkup(
      <ZeropsOperationCard now={Date.parse("2026-09-01T00:00:42.000Z")} operation={running} />,
    );

    const statusDotSpan = html.match(
      /data-zerops-primitive="status-dot"[\s\S]*?<\/span><\/span>/,
    )?.[0];
    expect(statusDotSpan).toBeDefined();
    expect(statusDotSpan).not.toContain("0:42");

    const durationSpan = html.match(/<span[^>]*data-zerops-operation-duration[^>]*>([^<]*)</);
    expect(durationSpan).toBeDefined();
    expect(durationSpan![1]).toContain("0:42");
  });

  it("renders the settled duration in normal case, tabular-nums, separate from the uppercase status word", () => {
    const operation = operationFor(
      zeropsCall({
        id: "dur-settled",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: null,
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        settledAt: "2026-09-01T00:01:12.000Z",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    const statusDotSpan = html.match(
      /data-zerops-primitive="status-dot"[\s\S]*?<\/span><\/span>/,
    )?.[0];
    expect(statusDotSpan).not.toContain("1m 12s");

    const durationSpanTag = html.match(/<span[^>]*data-zerops-operation-duration[^>]*>/)?.[0];
    expect(durationSpanTag).toBeDefined();
    expect(durationSpanTag).toContain("tabular-nums");
    expect(durationSpanTag).not.toContain("uppercase");
    const durationText = html.match(/<span[^>]*data-zerops-operation-duration[^>]*>([^<]*)</)?.[1];
    expect(durationText).toContain("1m 12s");
  });
});

/**
 * A simplified port of the server's own
 * `apps/server/src/orchestration/ActivityPayloadProjection.ts`
 * `dropSupersededToolUpdatedActivities` (not exported): drops every
 * tool.updated a later tool.completed for the same (turnId, toolCallId)
 * supersedes - the shape a reloaded thread's history/snapshot path returns.
 */
function dropSupersededToolUpdatedActivitiesForTest(
  activities: ZeropsShowcaseThread["activities"],
): ZeropsShowcaseThread["activities"] {
  const keyOf = (activity: ZeropsShowcaseThread["activities"][number]): string | null => {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const toolCallId = typeof payload?.toolCallId === "string" ? payload.toolCallId : undefined;
    return toolCallId ? `${activity.turnId ?? ""} ${toolCallId}` : null;
  };
  const completionIndicesByKey = new Map<string, number[]>();
  activities.forEach((activity, index) => {
    if (activity.kind !== "tool.completed") return;
    const key = keyOf(activity);
    if (key === null) return;
    const indices = completionIndicesByKey.get(key);
    if (indices) indices.push(index);
    else completionIndicesByKey.set(key, [index]);
  });
  return activities.filter((activity, index) => {
    if (activity.kind !== "tool.updated") return true;
    const key = keyOf(activity);
    if (key === null) return true;
    const indices = completionIndicesByKey.get(key);
    return !indices?.some((completionIndex) => completionIndex > index);
  });
}

describe("ZeropsOperationCard - the deploy duration renders identically live and after a reload", () => {
  it("shows 1m 16s for both the full activity list and the reloaded (superseded-updates-dropped) one", () => {
    const fullDeploy = operationsFor(weatherdashFirstDeploy).find((o) => o.kind === "deploy")!;
    const reloadedDeploy = operationsFor({
      ...weatherdashFirstDeploy,
      activities: dropSupersededToolUpdatedActivitiesForTest(weatherdashFirstDeploy.activities),
    }).find((o) => o.kind === "deploy")!;

    expect(fullDeploy.anchorActivityId).toBe(reloadedDeploy.anchorActivityId);
    expect(fullDeploy.anchorAt).toBe(reloadedDeploy.anchorAt);
    expect(fullDeploy.settledAt).toBe(reloadedDeploy.settledAt);

    const liveHtml = renderToStaticMarkup(<ZeropsOperationCard operation={fullDeploy} />);
    const reloadedHtml = renderToStaticMarkup(<ZeropsOperationCard operation={reloadedDeploy} />);
    expect(liveHtml).toContain("1m 16s");
    expect(reloadedHtml).toContain("1m 16s");
    expect(liveHtml).not.toContain("0 s");
    expect(reloadedHtml).not.toContain("0 s");
  });
});
