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
import { readPipeline } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
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

/** The clock at the hand-built calls' own moment, no project known — a triggered build is still running. */
const CONTEXT = { nowMs: Date.parse("2026-09-01T00:00:00.000Z"), projectId: undefined };

/** Every `ZeropsOperation` (card kind) a real captured thread's activities fold into. */
function operationsFor(thread: ZeropsShowcaseThread): ReadonlyArray<ZeropsOperation> {
  return deriveZeropsThreadModel({ activities: thread.activities, nowMs: CONTEXT.nowMs })
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
  return reduceZeropsOperations([call], CONTEXT).operations[0]!;
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
    if (html.includes("<ol")) {
      expect(html).toContain(operation.kicker);
    }
    if (operation.kind === "deploy" || operation.kind === "verify") {
      // A card that names one service reads verb + hostname chip, not the voice sentence.
      expect(html).toMatch(
        new RegExp(
          `data-zerops-subject-chip[^>]*>${operation.target?.hostname ?? operation.subject}<`,
        ),
      );
      expect(html).not.toContain("data-zerops-voice-source");
    } else {
      expect(html).toContain(operation.voice);
      expect(html).toContain(`data-zerops-voice-source="${operation.voiceSource}"`);
    }
    // A passed verify's chips already say every check passed.
    if (
      operation.closing !== undefined &&
      !(operation.kind === "verify" && operation.phase === "done")
    ) {
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

describe("ZeropsOperationCard — a deploy reads its pipeline step by step", () => {
  const SHA = "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";
  const at = (seconds: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, seconds)).toISOString();
  const NOW_MS = Date.parse(at(74));
  const deploy = (overrides: Partial<Parameters<typeof zeropsCall>[0]> = {}) =>
    operationFor(
      zeropsCall({
        id: "deploy-readout",
        startedAt: at(0),
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "inProgress",
        ...overrides,
      }),
    );
  const running = deploy();
  const readout = (
    appVersion: Parameters<typeof readPipeline>[0],
    nowSeconds = 74,
  ): ObservedRegion["pipeline"] =>
    readPipeline(appVersion, {
      nowMs: Date.parse(at(nowSeconds)),
      serviceName: "weatherdash",
      serviceType: "Node.js",
    });
  const building = readout({
    name: SHA,
    status: "BUILDING",
    build: { pipelineStart: at(5), startDate: at(13) },
  });
  const observedOf = (pipeline: ObservedRegion["pipeline"]): ObservedRegion => ({
    steps: [],
    ...(pipeline === undefined ? {} : { pipeline }),
    provenance: "",
    log: <div data-testid="build-log-tail">log tail</div>,
  });
  const render = (operation: ZeropsOperation, observed?: ObservedRegion) =>
    renderToStaticMarkup(
      <ZeropsOperationCard
        now={NOW_MS}
        operation={operation}
        {...(observed === undefined ? {} : { observed })}
      />,
    );
  const rowsOf = (html: string) =>
    [
      ...html.matchAll(
        /<li[^>]*data-zerops-pipeline-step="([^"]+)" data-zerops-pipeline-state="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g,
      ),
    ].map(([, id, state, inner]) => ({ id, state, inner: inner! }));
  const headerOf = (html: string) => html.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0] ?? "";
  const durationOf = (html: string) =>
    html.match(/<span[^>]*data-zerops-operation-duration[^>]*>([^<]*)</)?.[1];

  it("one row per step the pipeline has: its sentence and its duration, in the card's one format", () => {
    const rows = rowsOf(render(running, observedOf(building)));

    expect(rows.map(({ id, state }) => [id, state])).toEqual([
      ["INIT_BUILD_CONTAINER", "finished"],
      ["RUN_BUILD_COMMANDS", "running"],
      ["DEPLOY", "waiting"],
    ]);
    expect(rows[0]?.inner).toContain("Initialized build container");
    expect(rows[0]?.inner).toContain(">8s<");
    expect(rows[1]?.inner).toContain("Running build commands from zerops.yml");
    expect(rows[1]?.inner).toContain(">1m 1s<");
    expect(rows[2]?.inner).toContain(
      "Create app version 3f2a9c1 and upgrade Node.js service weatherdash",
    );
    expect(rows[2]?.inner).not.toContain("tabular-nums");
  });

  it.each([
    { state: "finished", shows: ["lucide-check", "text-success-foreground"] },
    { state: "running", shows: ['data-zerops-status-tone="busy"', "animate-status-pulse"] },
    { state: "waiting", shows: ["lucide-circle", "text-muted-foreground"] },
  ])("a $state step's glyph", ({ state, shows }) => {
    const row = rowsOf(render(running, observedOf(building))).find(
      (entry) => entry.state === state,
    );
    const glyph = row?.inner.match(
      /<(svg|span)[^>]*data-zerops-pipeline-glyph="[a-z]+"[\s\S]*?<\/\1>/,
    )?.[0];
    for (const text of shows) expect(glyph ?? "").toContain(text);
  });

  it.each([
    {
      name: "failed",
      pipeline: readout(
        {
          name: SHA,
          status: "BUILD_FAILED",
          build: { pipelineStart: at(5), startDate: at(13), pipelineFailed: at(70) },
        },
        600,
      ),
      state: "failed",
      shows: ["lucide-circle-alert", "text-destructive-foreground"],
    },
    {
      name: "cancelled",
      pipeline: readout(
        { name: SHA, status: "CANCELLED", build: { pipelineStart: at(5), pipelineFailed: at(9) } },
        600,
      ),
      state: "cancelled",
      shows: ["lucide-x", "text-muted-foreground"],
    },
  ])("a $name step's glyph", ({ pipeline, state, shows }) => {
    const row = rowsOf(render(deploy({ status: "failed" }), observedOf(pipeline))).find(
      (entry) => entry.state === state,
    );
    for (const text of shows) expect(row?.inner).toContain(text);
  });

  it("the running and the failed step read in the foreground, every other one muted", () => {
    const failed = readout(
      {
        name: SHA,
        status: "BUILD_FAILED",
        build: { pipelineStart: at(5), startDate: at(13), pipelineFailed: at(70) },
      },
      600,
    );
    const sentenceTone = (inner: string) =>
      inner.includes("flex-1 text-sm leading-5 text-foreground") ? "foreground" : "muted";

    expect(
      rowsOf(render(running, observedOf(building))).map((row) => sentenceTone(row.inner)),
    ).toEqual(["muted", "foreground", "muted"]);
    expect(
      rowsOf(render(deploy({ status: "failed" }), observedOf(failed))).map((row) =>
        sentenceTone(row.inner),
      ),
    ).toEqual(["muted", "foreground", "muted"]);
  });

  it("a running deploy's note follows its sentence", () => {
    const deploying = readPipeline(
      {
        name: SHA,
        status: "DEPLOYING",
        build: { pipelineStart: at(5), startDate: at(13), endDate: at(60) },
      },
      { nowMs: NOW_MS, serviceName: "weatherdash", hadContainers: true },
    );
    const row = rowsOf(render(running, observedOf(deploying))).find(
      (entry) => entry.id === "DEPLOY",
    );
    expect(row?.inner).toContain(
      "Creating app version 3f2a9c1 and upgrading weatherdash · Preparing upgrade…",
    );
  });

  it("the header reads the pipeline's word, the service and the overall line — never a clock", () => {
    const header = headerOf(render(running, observedOf(building)));

    expect(header).toMatch(/data-zerops-primitive="status-dot"[^>]*>[\s\S]*?>Running</);
    expect(header).not.toContain('data-zerops-primitive="micro-label"');
    expect(header).toMatch(/data-zerops-subject-chip[^>]*>weatherdash</);
    expect(durationOf(header)).toBe("Running for 1m 9s");
    expect(header).not.toMatch(/\d:\d\d/);
  });

  it.each([
    { name: "nothing observed yet", observed: undefined },
    {
      name: "the platform still calculating",
      observed: observedOf(readout({ status: "WAITING_TO_BUILD", build: {} })),
    },
  ])("before the steps are known — $name: one row says it is calculating them", ({ observed }) => {
    const html = render(running, observed);
    const rows = rowsOf(html);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.inner).toContain("Calculating steps from zerops.yml");
    expect(rows[0]?.inner).toContain('data-zerops-status-tone="busy"');
    expect(durationOf(headerOf(html))).toBe("1m 14s");
  });

  it("the provenance is one quiet line, only once the feed is not answering", () => {
    const quiet = render(running, observedOf(building));
    const silent = render(running, {
      ...observedOf(building),
      provenance: "Zerops isn't answering · last update 2m ago",
    });

    expect(quiet).not.toContain("data-zerops-operation-provenance");
    expect(silent).toMatch(
      /data-zerops-operation-provenance[^>]*>Zerops isn&#x27;t answering · last update 2m ago</,
    );
  });

  it("renders the observation's secondary processes as compact rows under the steps", () => {
    const html = render(running, {
      ...observedOf(building),
      chips: [
        {
          id: "p-subdomain",
          label: "Enable subdomain access",
          state: "running",
          stateLabel: "Running",
        },
      ],
    });
    const chips = html.match(/<ol[^>]*aria-label="Other activity"[\s\S]*?<\/ol>/)?.[0];

    expect(chips).toContain("Enable subdomain access");
    expect(html.indexOf("Enable subdomain access")).toBeGreaterThan(
      html.indexOf("data-zerops-pipeline-steps"),
    );
    expect(html).toContain("build-log-tail");
  });

  it("a settled deploy whose pipeline ended reads the pipeline's word and overall line", () => {
    const active = readout(
      {
        name: SHA,
        status: "ACTIVE",
        build: {
          pipelineStart: at(5),
          startDate: at(13),
          endDate: at(60),
          pipelineFinish: at(100),
        },
        activationDate: at(100),
      },
      600,
    );
    const done = deploy({
      status: "completed",
      settledAt: at(110),
      resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
    });
    const header = headerOf(render(done, observedOf(active)));

    expect(header).toMatch(/>Finished</);
    expect(durationOf(header)).toBe("Finished in 1m 35s");
  });

  it("a settled deploy whose readout stopped mid-way keeps the result's own word and time", () => {
    const done = deploy({
      status: "completed",
      settledAt: at(72),
      resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
    });
    const header = headerOf(render(done, observedOf(building)));

    expect(header).toMatch(/>Deployed</);
    expect(durationOf(header)).toBe("1m 12s");
  });

  it.each([
    {
      name: "failed in its build",
      result: {
        status: "BUILD_FAILED",
        targetService: "weatherdash",
        failedPhase: "build",
        versionName: SHA,
      },
      rows: [["RUN_BUILD_COMMANDS", "Build commands from zerops.yml failed"]],
    },
    {
      name: "failed starting its new container",
      result: {
        status: "DEPLOY_FAILED",
        targetService: "weatherdash",
        failedPhase: "init",
        versionName: SHA,
      },
      rows: [["DEPLOY", "Failed while creating app version 3f2a9c1 or upgrading weatherdash"]],
    },
    {
      name: "landed",
      result: { status: "DEPLOYED", targetService: "weatherdash" },
      rows: [],
    },
  ])(
    "a settled deploy the card never observed, $name: only the step its result names as failed",
    ({ result, rows }) => {
      const html = render(
        deploy({ status: "completed", settledAt: at(72), resultText: JSON.stringify(result) }),
      );

      expect(
        rowsOf(html).map(({ id, inner }) => [id, inner.match(/leading-5[^"]*">([^<]*)</)?.[1]]),
      ).toEqual(rows);
      expect(durationOf(headerOf(html))).toBe("1m 12s");
    },
  );
});

describe("ZeropsOperationCard — the pipeline row", () => {
  const running = operationFor(
    zeropsCall({
      id: "seg",
      startedAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_import",
      input: { content: "services:\n  - hostname: weatherdash\n" },
      status: "inProgress",
    }),
  );
  const segmentsOf = (steps: ObservedRegion["steps"]) => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard now={0} observed={{ steps, provenance: "" }} operation={running} />,
    );
    return [
      ...html.matchAll(/<li[^>]*data-zerops-process-state="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g),
    ].map(([, state, inner]) => ({ state, inner: inner! }));
  };

  it.each([
    {
      name: "a done step: its glyph and its duration, never the word Done",
      step: {
        id: "b",
        label: "Build",
        state: "done",
        stateLabel: "Done",
        durationMs: 171_000,
      } as const,
      shows: ["Build", "2m 51s", 'data-zerops-segment-glyph="done"'],
      hides: ['tabular-nums">Done<'],
    },
    {
      name: "a done step with no known duration: the label alone",
      step: { id: "b", label: "Build", state: "done", stateLabel: "Done" } as const,
      shows: ["Build"],
      hides: ['tabular-nums">Done<'],
    },
    {
      name: "a running step: its live duration",
      step: {
        id: "d",
        label: "Deploy",
        state: "running",
        stateLabel: "Running",
        durationMs: 7_000,
      } as const,
      shows: ["Deploy", "7 s"],
      hides: ['tabular-nums">Running<'],
    },
    {
      name: "a failed step says Failed",
      step: {
        id: "d",
        label: "Deploy",
        state: "failed",
        stateLabel: "Failed",
        durationMs: 7_000,
      } as const,
      shows: ["Deploy", ">Failed<"],
      hides: [],
    },
    {
      name: "a long label wraps instead of being cut",
      step: { id: "c", label: "Prepare container", state: "queued", stateLabel: "Queued" } as const,
      shows: ["Prepare container", "break-words"],
      hides: ["truncate"],
    },
  ])("$name", ({ step, shows, hides }) => {
    const [segment] = segmentsOf([step]);
    for (const text of shows) expect(segment?.inner).toContain(text);
    for (const text of hides) expect(segment?.inner).not.toContain(text);
  });
});

describe("ZeropsOperationCard — a triggered build past its cap", () => {
  it("reads attention, not busy, and links the project in Zerops", () => {
    const [uncertain] = reduceZeropsOperations(
      [
        zeropsCall({
          id: "e3",
          startedAt: "2026-09-01T00:00:00.000Z",
          turnId: "t1",
          toolName: "zerops_deploy",
          input: { targetService: "weatherdash" },
          status: "completed",
          settledAt: "2026-09-01T00:00:05.000Z",
          resultText: JSON.stringify({ status: "BUILD_TRIGGERED", targetService: "weatherdash" }),
        }),
      ],
      { nowMs: Date.parse("2026-09-01T00:10:05.000Z"), projectId: "proj-1" },
    ).operations;
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={uncertain!} />);

    expect(uncertain!.phase).toBe("uncertain");
    expect(html).toContain('data-zerops-card-tone="attention"');
    expect(html).toContain("Unconfirmed");
    expect(html).toContain("No result from the build. Check it in Zerops.");
    expect(html).toContain('href="https://app.zerops.io/project/proj-1"');
    expect(html).toContain("Open in Zerops");
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

  it("draws its result and its Open link in one row, and no step line when nothing failed", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        devServerUrl="https://apidev-26a7-3000.prg1.zerops.app"
        operation={operation}
      />,
    );
    const row = html.match(/<div[^>]*data-zerops-result-row[\s\S]*$/)?.[0] ?? "";
    expect(row).toContain("dev server running on apidev:3000.");
    expect(row).toContain("https://apidev-26a7-3000.prg1.zerops.app");
    expect(html).not.toContain('data-zerops-primitive="process-steps"');
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

  it("renders the figures in one line and the full step list only inside the Show steps expander; the plumbing tail never appears", () => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const metrics = html.match(/<p[^>]*data-zerops-browser-metrics[\s\S]*?<\/p>/)?.[0];
    expect(metrics).toContain(">2 steps · 2 errors<");
    // The page is the card's subject; the figures never repeat it.
    expect(html).not.toContain("opened https://");
    expect(html).toContain("open https://kanbandev-26a7.prg1.zerops.app");
    expect(html).toContain("click @e1");
    expect(html).toContain("Show steps");
    expect(html).not.toContain("screenshot /tmp/shot.png");
    expect(html).not.toMatch(/>\s*errors\s*</);
    expect(html).not.toContain("network requests --status 400-599");
  });

  it.each([
    { name: "errors on the page", errors: true },
    { name: "a clean page", errors: false },
  ])("$name: the figures take the error tone only when there are errors", ({ errors }) => {
    const checked = errors
      ? operation
      : operationFor(
          zeropsCall({
            id: "brw-clean",
            startedAt: "2026-09-01T00:00:00.000Z",
            turnId: "t1",
            toolName: "zerops_browser",
            input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
            status: "completed",
            resultText: JSON.stringify({
              url: "https://kanbandev-26a7.prg1.zerops.app",
              steps: [{ command: ["set", "viewport", "1440", "900"], success: true }],
              errorsOutput: [],
              consoleOutput: [],
              networkOutput: [],
            }),
          }),
        );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={checked} />);
    const metrics = html.match(/<p[^>]*data-zerops-browser-metrics[^>]*>/)?.[0];
    expect(metrics?.includes("text-destructive-foreground")).toBe(errors);
    if (!errors) {
      expect(html).toContain(">1440×900 · 1 step · 0 errors<");
    }
  });

  it("says what it checked once: no closing sentence repeats the page and its counts", () => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    expect(operation.closing).toBeDefined();
    expect(html).not.toContain(operation.closing!);
    expect(html).not.toContain("data-zerops-card-outcome");
  });

  it("sets the thumbnail beside the header, stacking above it only in a narrow card (under 22rem)", () => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const card = html.match(/<div[^>]*data-zerops-card-kind[^>]*>/)?.[0];
    const layout = html.match(/<div[^>]*data-zerops-browser-layout[^>]*>/)?.[0];
    expect(card).toContain("@container");
    expect(layout).toContain("flex-col");
    expect(layout).toContain("@[22rem]:flex-row");
    expect(html.indexOf("data-zerops-browser-viewport")).toBeLessThan(html.indexOf("<header"));
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

  describe("the frame is reserved from birth, so the image fills it in place", () => {
    const born = operationFor(
      zeropsCall({
        id: "brw-born",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_browser",
        input: { url: "https://kanbandev-26a7.prg1.zerops.app/cz/products/vltava" },
        status: "inProgress",
      }),
    );
    const mobile = operationFor(
      zeropsCall({
        id: "brw-mobile",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_browser",
        input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
        status: "completed",
        resultText: JSON.stringify({
          url: "https://kanbandev-26a7.prg1.zerops.app",
          steps: [{ command: ["set", "viewport", "390", "844"], success: true }],
          errorsOutput: [],
          consoleOutput: [],
          networkOutput: [],
        }),
      }),
    );
    const frame = (html: string) =>
      html.match(/<button[^>]*data-zerops-browser-viewport[^>]*>[\s\S]*?<\/button>/)?.[0];

    it.each([
      {
        name: "born, nothing to show yet",
        operation: born,
        props: {},
        ratio: "16 / 9",
        image: false,
      },
      {
        name: "the first live frame",
        operation: born,
        props: {
          live: true,
          liveFrame: { src: "data:image/jpeg;base64,LIVE", width: 640, height: 400 },
        },
        ratio: "16 / 9",
        image: true,
      },
      {
        name: "the screenshot",
        operation: born,
        props: {
          browserScreenshot: { src: "data:image/png;base64,DONE", width: 1280, height: 2400 },
        },
        ratio: "16 / 9",
        image: true,
      },
      { name: "a known viewport", operation: mobile, props: {}, ratio: "390 / 844", image: false },
      {
        name: "a running check that set its viewport",
        operation: operationFor(
          zeropsCall({
            id: "brw-resize",
            startedAt: "2026-09-01T00:00:00.000Z",
            turnId: "t1",
            toolName: "zerops_browser",
            input: {
              url: "https://kanbandev-26a7.prg1.zerops.app",
              commands: [["set", "viewport", "390", "844"]],
            },
            status: "inProgress",
          }),
        ),
        props: {},
        ratio: "390 / 844",
        image: false,
      },
    ])("$name: the frame keeps aspect-ratio $ratio", ({ operation, props, ratio, image }) => {
      const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} {...props} />);
      const viewport = frame(html);

      expect(viewport).toBeDefined();
      expect(viewport).toContain(`aspect-ratio:${ratio}`);
      expect(viewport?.includes("data-zerops-browser-image")).toBe(image);
      expect(viewport).not.toMatch(/animate-/);
    });

    it("the live caption follows the call's own phase, so a reload of a running call reads the same", () => {
      const html = renderToStaticMarkup(<ZeropsOperationCard operation={born} />);
      expect(html).toContain("data-zerops-browser-live-caption");
    });
  });

  it("clicking an empty frame opens the Browser panel", () => {
    panelTestState.onOpen = null;
    panelTestState.open.mockClear();
    renderToStaticMarkup(<ZeropsOperationCard operation={operation} threadRef={THREAD_REF} />);
    const onOpen = panelTestState.onOpen as (() => void) | null;
    expect(onOpen).not.toBeNull();
    (onOpen as () => void)();
    expect(panelTestState.open).toHaveBeenCalledWith(THREAD_REF, "browser");
  });
});

describe("ZeropsOperationCard — a verb and a subject, never a sentence with the URL", () => {
  const PAGE = "https://kanbandev-26a7.prg1.zerops.app/cz/products/vltava?lang=cs";
  const browser = (status: ZeropsCall["status"], input: Record<string, unknown>) =>
    operationFor(
      zeropsCall({
        id: `brw-${status}`,
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_browser",
        input,
        status,
        ...(status === "inProgress"
          ? {}
          : {
              resultText: JSON.stringify({
                url: PAGE,
                steps: [],
                errorsOutput: [],
                consoleOutput: [],
                networkOutput: [],
              }),
            }),
      }),
    );
  const deploy = (input: Record<string, unknown>) =>
    operationFor(
      zeropsCall({
        id: "dep-subject",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input,
        status: "inProgress",
      }),
    );
  const header = (html: string) => html.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0] ?? "";
  const verbOf = (html: string) =>
    header(html).match(
      /data-zerops-primitive="status-dot"[\s\S]*?(?:data-zerops-primitive="micro-label"|class="min-w-0 truncate")>([^<]*)</,
    )?.[1];
  const chipOf = (html: string) =>
    header(html).match(/data-zerops-subject-chip[^>]*>([^<]*)</)?.[1];
  const pathOf = (html: string) =>
    header(html).match(/data-zerops-subject-path[^>]*>([^<]*)</)?.[1];

  it.each([
    {
      name: "a running browser check on a service's subdomain",
      operation: browser("inProgress", { url: PAGE }),
      subjectHost: "kanbandev",
      verb: "Checking",
      chip: "kanbandev",
      // The page as the person names it: its path, never the query.
      path: "/cz/products/vltava",
    },
    {
      name: "a settled browser check on a host no service answers",
      operation: browser("completed", { url: PAGE }),
      subjectHost: undefined,
      verb: "Checked",
      chip: "kanbandev-26a7.prg1.zerops.app",
      // The page as the person names it: its path, never the query.
      path: "/cz/products/vltava",
    },
    {
      name: "a deploy",
      operation: deploy({ targetService: "weatherdash" }),
      subjectHost: undefined,
      verb: "Deploying",
      chip: "weatherdash",
      path: undefined,
    },
    {
      name: "a service's log",
      operation: operationFor(
        zeropsCall({
          id: "logs-subject",
          startedAt: "2026-09-01T00:00:00.000Z",
          turnId: "t1",
          toolName: "zerops_logs",
          input: { serviceHostname: "appdev" },
          status: "inProgress",
        }),
      ),
      subjectHost: undefined,
      verb: "Reading",
      chip: "appdev",
      path: undefined,
    },
  ])("$name: $verb · $chip", ({ operation, subjectHost, verb, chip, path }) => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        operation={operation}
        {...(subjectHost === undefined ? {} : { subjectHost })}
      />,
    );

    expect(verbOf(html)).toBe(verb);
    expect(chipOf(html)).toBe(chip);
    expect(pathOf(html)).toBe(path);
    // A service is not the product: its chip is neutral, never the identity teal.
    expect(header(html)).not.toContain("--zerops-update-role");
    expect(header(html)).not.toContain(operation.voice);
    expect(header(html)).not.toContain("https://");
  });

  it.each([
    { name: "a browser check before its URL", operation: browser("inProgress", {}) },
    { name: "a deploy before its target", operation: deploy({}) },
  ])(
    "$name: the subject line is held by a static placeholder, never a fallback phrase",
    ({ operation }) => {
      const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
      const subject = header(html).match(/data-zerops-operation-subject[\s\S]*?<\/p>/)?.[0];

      expect(subject).toContain("data-zerops-subject-placeholder");
      expect(subject).not.toMatch(/animate-/);
      expect(chipOf(html)).toBeUndefined();
      expect(header(html)).not.toContain(operation.subject);
    },
  );

  it("a batch deploy names several services: it keeps its voice line, no single subject", () => {
    const operation = operationFor(
      zeropsCall({
        id: "batch-subject",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy_batch",
        input: { targets: [{ targetService: "api" }, { targetService: "web" }] },
        status: "inProgress",
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    expect(header(html)).toContain(`data-zerops-voice-source="${operation.voiceSource}"`);
    expect(header(html)).not.toContain("data-zerops-operation-subject");
  });
});

describe("ZeropsOperationCard — a running card's header always says what it is doing", () => {
  it.each([
    { toolName: "zerops_browser", input: { url: "https://app.example.com/" }, word: "Checking" },
    { toolName: "zerops_deploy", input: { targetService: "appdev" }, word: "Deploying" },
    {
      toolName: "zerops_subdomain",
      input: { serviceHostname: "appdev", action: "enable" },
      word: "Enabling",
    },
    { toolName: "zerops_verify", input: { serviceHostname: "appdev" }, word: "Checking" },
    { toolName: "zerops_delete", input: { serviceHostname: "appdev" }, word: "Deleting" },
    { toolName: "zerops_scale", input: { serviceHostname: "appdev" }, word: "Scaling" },
    { toolName: "zerops_manage", input: { serviceHostname: "appdev" }, word: "Managing" },
    { toolName: "zerops_env", input: { serviceHostname: "appdev" }, word: "Updating" },
    {
      toolName: "zerops_dev_server",
      input: { hostname: "appdev", action: "start" },
      word: "Starting",
    },
  ])("$toolName: $word", ({ toolName, input, word }) => {
    const operation = operationFor(
      zeropsCall({
        id: `word-${toolName}`,
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName,
        input,
        status: "inProgress",
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const header = html.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0] ?? "";
    const verb = header.match(
      /data-zerops-primitive="status-dot"[\s\S]*?(?:data-zerops-primitive="micro-label"|class="min-w-0 truncate")>([^<]*)</,
    )?.[1];

    expect(verb).toBe(word);
    if (toolName !== "zerops_browser") {
      expect(header).toMatch(/data-zerops-subject-chip[^>]*>appdev</);
      expect(header).not.toContain("data-zerops-voice-source");
    }
  });
});

describe("ZeropsOperationCard — repeated calls on one target", () => {
  it.each([
    { toolName: "zerops_deploy", input: { targetService: "weatherdash" } },
    { toolName: "zerops_verify", input: { serviceHostname: "weatherdash" } },
    { toolName: "zerops_browser", input: { url: "https://weatherdash.example/" } },
  ])("$toolName: no card carries an attempt number", ({ toolName, input }) => {
    const { operations } = reduceZeropsOperations(
      ["2026-09-01T00:00:00.000Z", "2026-09-01T00:01:00.000Z", "2026-09-01T00:02:00.000Z"].map(
        (startedAt, index) =>
          zeropsCall({
            id: `${toolName}-${index}`,
            startedAt,
            turnId: "t1",
            toolName,
            input,
            status: "failed",
            resultText: JSON.stringify({ code: "API_ERROR", error: "zerops.yml not found" }),
          }),
      ),
      CONTEXT,
    );

    expect(operations).toHaveLength(3);
    for (const operation of operations) {
      const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
      expect(html).not.toMatch(/attempt/i);
    }
  });
});

describe("ZeropsOperationCard — empty body", () => {
  it("renders no ProcessSteps and no placeholder text when there are no steps and no observed region", () => {
    const operation = operationFor(
      zeropsCall({
        id: "e3",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: null,
        toolName: "zerops_verify",
        input: { serviceHostname: "weatherdash" },
        status: "inProgress",
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);

    expect(operation.steps).toHaveLength(0);
    expect(html).not.toContain('data-zerops-primitive="process-steps"');
  });

  it("a running deploy with no observed region says it is calculating its steps", () => {
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
    const html = renderToStaticMarkup(<ZeropsOperationCard now={0} operation={operation} />);
    const list = html.match(/<ol[^>]*data-zerops-pipeline-steps[\s\S]*?<\/ol>/)?.[0];

    expect(list?.match(/<li/g)?.length).toBe(1);
    expect(list).toContain("Calculating steps from zerops.yml");
    expect(html).not.toContain("data-zerops-pipeline-segments");
  });
});

describe("ZeropsOperationCard — what zcp writes for the agent stays off the card", () => {
  it.each([
    {
      name: "a deploy's next actions",
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "completed" as const,
      resultText: JSON.stringify({
        status: "DEPLOYED",
        targetService: "weatherdash",
        nextActions: "Run zerops_verify on weatherdash.",
        verification: "Tell the person that link.",
      }),
      agentText: ["Run zerops_verify on weatherdash.", "Tell the person that link."],
    },
    {
      name: "a failed call's diagnostic and suggestion",
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "failed" as const,
      resultText: JSON.stringify({
        code: "DEPLOY_FAILED",
        error: "zcli push failed",
        diagnostic: "exit status 1",
        suggestion: "Run zerops_discover to check the service.",
      }),
      agentText: ["exit status 1", "Run zerops_discover to check the service."],
    },
    {
      name: "a verify's check hints",
      toolName: "zerops_verify",
      input: { serviceHostname: "weatherdash" },
      status: "completed" as const,
      resultText: JSON.stringify({
        hostname: "weatherdash",
        status: "healthy",
        checks: [{ name: "service_running", status: "pass", detail: "Read zerops_logs next." }],
      }),
      agentText: ["Read zerops_logs next."],
    },
    {
      name: "a result the card cannot read",
      toolName: "zerops_subdomain",
      input: { serviceHostname: "weatherdash", action: "enable" },
      status: "completed" as const,
      resultText: "subdomain: ok (raw tool output)",
      agentText: ["subdomain: ok (raw tool output)"],
    },
  ])("$name", ({ toolName, input, status, resultText, agentText }) => {
    const operation = operationFor(
      zeropsCall({
        id: `agent-${toolName}`,
        startedAt: "2026-09-01T00:00:00.000Z",
        toolName,
        input,
        status,
        resultText,
        settledAt: "2026-09-01T00:00:05.000Z",
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard now={0} operation={operation} />);

    expect(html).not.toMatch(/<summary[^>]*>Details</);
    for (const text of agentText) expect(html).not.toContain(text);
  });
});

describe("ZeropsOperationCard — durations against the real fixture (regression)", () => {
  const weatherdash = operationsFor(weatherdashFirstDeploy);
  const deploy = weatherdash.find((o) => o.kind === "deploy")!;
  const verify = weatherdash.find((o) => o.kind === "verify")!;
  const bootstrap = weatherdash.find((o) => o.kind === "bootstrap")!;

  it("the deploy operation's settledAt - anchorAt is ~75.9s and the card shows 1m 15s", () => {
    const elapsedMs = Date.parse(deploy.settledAt!) - Date.parse(deploy.anchorAt);
    expect(elapsedMs).toBeGreaterThan(75_000);
    expect(elapsedMs).toBeLessThan(77_000);

    const html = renderToStaticMarkup(<ZeropsOperationCard operation={deploy} />);
    expect(html).toContain("1m 15s");
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

describe("ZeropsOperationCard — the duration renders outside the status word", () => {
  it("keeps the running elapsed clock out of the StatusDot's word, in a separate tabular-nums span", () => {
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
    expect(statusDotSpan).not.toContain("42s");

    const durationSpan = html.match(/<span[^>]*data-zerops-operation-duration[^>]*>([^<]*)</);
    expect(durationSpan).toBeDefined();
    expect(durationSpan![1]).toBe("42s");
  });

  it("renders the settled duration in the body font, normal case, tabular-nums, separate from the status word", () => {
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
    // The mono face set "1 s" with a full-width gap between number and unit.
    expect(durationSpanTag).not.toContain("font-mono");
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
  it("shows 1m 15s for both the full activity list and the reloaded (superseded-updates-dropped) one", () => {
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
    expect(liveHtml).toContain("1m 15s");
    expect(reloadedHtml).toContain("1m 15s");
    expect(liveHtml).not.toContain("0 s");
    expect(reloadedHtml).not.toContain("0 s");
  });
});

describe("ZeropsOperationCard — one quiet surface", () => {
  const weatherdash = operationsFor(weatherdashFirstDeploy);
  const refused = operationsFor(verifyAndRefusedDeploy);
  const cases = [
    { name: "deploy, done", operation: weatherdash.find((o) => o.kind === "deploy")! },
    { name: "verify, done", operation: weatherdash.find((o) => o.kind === "verify")! },
    {
      name: "deploy, failed",
      operation: refused.find((o) => o.kind === "deploy" && o.phase === "failed")!,
    },
  ];

  it.each(cases)("$name: no tinted band, no kicker label, no inner rules", ({ operation }) => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const header = html.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0] ?? "";
    const microLabels = [
      ...header.matchAll(/data-zerops-primitive="micro-label"[^>]*>([^<]*)</g),
    ].map((match) => match[1]);

    expect(header).not.toBe("");
    expect(header).not.toMatch(/zerops-status-[a-z]+-surface/);
    // The kicker stays only as the steps' accessible name. A card that names
    // one service heads with its status word as the verb label; a voice-line
    // card reads its status in sentence form, never a label.
    expect(header).not.toContain(operation.kicker);
    expect(microLabels).toEqual(
      header.includes("data-zerops-operation-subject") && operation.kind !== "deploy"
        ? [operation.statusWord]
        : [],
    );
    expect(html).not.toContain("border-t");
  });

  it("a card with no single target: the status reads as a word beside the voice line", () => {
    const operation = operationsFor(weatherdashFirstDeploy).find((o) => o.kind === "bootstrap")!;
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const status = html.match(/<span aria-label="Result status"[\s\S]*?<\/span><\/span>/)?.[0];

    expect(status).toContain(`>${operation.statusWord}</span>`);
    expect(status).not.toContain('data-zerops-primitive="micro-label"');
  });

  it("gives only a failed card a failed edge", () => {
    const failed = cases[2]!.operation;
    const done = cases[0]!.operation;
    expect(renderToStaticMarkup(<ZeropsOperationCard operation={failed} />)).toContain(
      "border-[var(--zerops-status-failed)]/35",
    );
    expect(renderToStaticMarkup(<ZeropsOperationCard operation={done} />)).not.toContain(
      "border-[var(--zerops-status-failed)]",
    );
  });

  it("verify: its checks read as one row of chips, never a list", () => {
    const operation = cases[1]!.operation;
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    const row = html.match(/<ul[^>]*data-zerops-verify-checks[\s\S]*?<\/ul>/)?.[0];

    expect(operation.steps.length).toBeGreaterThan(1);
    expect(row).toContain("flex-wrap");
    expect(row?.match(/data-zerops-process-state=/g)?.length).toBe(operation.steps.length);
    expect(html).not.toContain('data-zerops-primitive="process-steps"');
  });

  it("verify, failed: the failed checks are listed under the row with their result", () => {
    const failed = operationFor(
      zeropsCall({
        id: "verify-failed",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_verify",
        input: { serviceHostname: "apidev" },
        status: "completed",
        resultText: JSON.stringify({
          hostname: "apidev",
          status: "unhealthy",
          checks: [
            { name: "service_running", status: "pass" },
            { name: "http_public", status: "fail", httpStatus: 502, detail: "bad gateway" },
          ],
        }),
      }),
    );
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={failed} />);
    const failures = html.match(/<ol[^>]*aria-label="Failed checks"[\s\S]*?<\/ol>/)?.[0];

    expect(failed.phase).toBe("failed");
    expect(failures).toBeDefined();
    expect(failures?.match(/data-zerops-process-state="failed"/g)?.length).toBe(1);
    expect(failures).toContain("HTTP public");
    expect(failures).toContain("502");
    expect(html).toContain(failed.closing!);
  });

  it("verify, done: the chips say it passed — no closing sentence under them", () => {
    const operation = cases[1]!.operation;
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
    expect(operation.closing).toBeDefined();
    expect(html).not.toContain(operation.closing!);
  });
});

describe("ZeropsOperationCard — read cards", () => {
  const logs = (status: ZeropsCall["status"], resultText?: string) =>
    operationFor(
      zeropsCall({
        id: "logs-1",
        toolName: "zerops_logs",
        status,
        startedAt: "2026-09-01T00:00:00.000Z",
        input: { serviceHostname: "app", severity: "ERROR" },
        ...(resultText === undefined ? {} : { resultText, settledAt: "2026-09-01T00:00:02.000Z" }),
      }),
    );

  it("draws the read body from the call's start, and again once the result lands", () => {
    const running = renderToStaticMarkup(
      <ZeropsOperationCard now={0} operation={logs("inProgress")} />,
    );
    const done = renderToStaticMarkup(
      <ZeropsOperationCard
        operation={logs(
          "completed",
          JSON.stringify({
            entries: [{ timestamp: "2026-09-01T00:00:01Z", severity: "Error", message: "boom" }],
            hasMore: false,
          }),
        )}
      />,
    );
    expect(running).toContain('data-zerops-read-body="logs"');
    expect(running).toContain("data-zerops-read-placeholder");
    expect(done).toContain('data-zerops-read-body="logs"');
    expect(done).toContain("boom");
  });

  it("reads like the error card once the call failed", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        operation={logs(
          "failed",
          JSON.stringify({ code: "SERVICE_NOT_FOUND", error: "Service 'app' not found" }),
        )}
      />,
    );
    expect(html).not.toContain("data-zerops-read-body");
    expect(html).toContain("Service &#x27;app&#x27; not found");
  });
});

describe("ZeropsOperationCard — the version a settled deploy shipped", () => {
  const deploy = (result?: Record<string, unknown>) =>
    operationFor(
      zeropsCall({
        id: "version-1",
        toolName: "zerops_deploy",
        status: result === undefined ? "inProgress" : "completed",
        startedAt: "2026-09-01T00:00:00.000Z",
        input: { targetService: "weatherdash" },
        ...(result === undefined
          ? {}
          : { resultText: JSON.stringify(result), settledAt: "2026-09-01T00:00:50.000Z" }),
      }),
    );
  const frozen: ObservedRegion = {
    steps: [],
    pipeline: readPipeline(
      {
        status: "ACTIVE",
        build: {
          pipelineStart: "2026-09-01T00:00:01.000Z",
          startDate: "2026-09-01T00:00:05.000Z",
          endDate: "2026-09-01T00:00:40.000Z",
          pipelineFinish: "2026-09-01T00:00:48.000Z",
        },
        activationDate: "2026-09-01T00:00:48.000Z",
      },
      { nowMs: Date.parse("2026-09-01T00:00:50.000Z"), serviceName: "weatherdash" },
    ),
    provenance: "",
  };

  it.each([
    {
      name: "a running deploy names no version",
      operation: deploy(),
      line: undefined,
    },
    {
      name: "a landed deploy names its short sha after the frozen steps",
      operation: deploy({
        status: "DEPLOYED",
        targetService: "weatherdash",
        appVersionId: "av-1",
        versionName: "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
      }),
      line: "3f2a9c1",
    },
    {
      name: "a landed deploy with no version names none",
      operation: deploy({ status: "DEPLOYED", targetService: "weatherdash" }),
      line: undefined,
    },
  ])("$name", ({ operation, line }) => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard now={0} observed={frozen} operation={operation} />,
    );
    if (line === undefined) {
      expect(html).not.toContain("data-zerops-operation-version");
      return;
    }
    expect(html).toContain(line);
    expect(html).not.toContain("3f2a9c1d");
    expect(html.indexOf("data-zerops-pipeline-steps")).toBeGreaterThan(-1);
    expect(html.indexOf("data-zerops-operation-version")).toBeGreaterThan(
      html.indexOf("data-zerops-pipeline-steps"),
    );
  });

  it("a triggered build that names its version while still running appends it below the live log", () => {
    const triggered = deploy({
      status: "BUILD_TRIGGERED",
      targetService: "weatherdash",
      versionName: "abc123",
    });
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        now={Date.parse("2026-09-01T00:00:42.000Z")}
        observed={{
          ...frozen,
          chips: [{ id: "sub", label: "Subdomain", state: "running", stateLabel: "Running" }],
          provenance: "Zerops isn't answering · last update 12s ago",
          log: <div data-testid="build-log-tail">log tail</div>,
        }}
        operation={triggered}
      />,
    );

    expect(triggered.phase).toBe("running");
    expect(html).toContain("abc123");
    expect(html.indexOf("data-zerops-operation-version")).toBeGreaterThan(
      html.indexOf("data-zerops-operation-provenance"),
    );
  });
});

describe("ZeropsOperationCard — why a card failed or timed out", () => {
  const settled = (
    toolName: string,
    input: Record<string, unknown>,
    status: ZeropsCall["status"],
    result: Record<string, unknown>,
  ) =>
    operationFor(
      zeropsCall({
        id: `explain-${toolName}`,
        toolName,
        status,
        startedAt: "2026-09-01T00:00:00.000Z",
        input,
        resultText: JSON.stringify(result),
        settledAt: "2026-09-01T00:00:50.000Z",
      }),
    );

  it.each([
    {
      name: "a failed build: its cause, then the log tail in mono with the error lines toned",
      operation: settled("zerops_deploy", { targetService: "apidev" }, "completed", {
        status: "BUILD_FAILED",
        targetService: "apidev",
        message: "Build failed",
        failedPhase: "build",
        failureClassification: { category: "build", likelyCause: "Build OOM-killed" },
        buildLogs: ["> next build", "npm ERR! missing script: build"],
      }),
      reason: "Build OOM-killed",
      tail: [
        { text: "&gt; next build", error: false },
        { text: "npm ERR! missing script: build", error: true },
      ],
    },
    {
      name: "a build zcp stopped waiting for: its word, no tail",
      operation: settled("zerops_deploy", { targetService: "apidev" }, "completed", {
        status: "BUILD_TRIGGERED",
        targetService: "apidev",
        message: "Build still running after 10m",
        timedOut: true,
      }),
      reason: "Build still running after 10m",
      tail: [],
    },
    {
      name: "a failed scale with no steps of its own: the platform's reason",
      operation: settled("zerops_scale", { serviceHostname: "apidev" }, "completed", {
        process: {
          id: "proc-1",
          actionName: "stack.scale",
          status: "FAILED",
          created: "2026-09-01T00:00:01Z",
          failReason: "quota exceeded",
        },
        message: "Scaling apidev",
      }),
      reason: "quota exceeded",
      tail: [],
    },
    {
      name: "a deploy call that failed outright: zcp's classified cause",
      operation: settled("zerops_deploy", { targetService: "apidev" }, "failed", {
        code: "DEPLOY_FAILED",
        error: "zcli push failed",
        failureClassification: { category: "credential", likelyCause: "GIT_TOKEN missing" },
      }),
      reason: "GIT_TOKEN missing",
      tail: [],
    },
  ])("$name", ({ operation, reason, tail }) => {
    const html = renderToStaticMarkup(<ZeropsOperationCard now={0} operation={operation} />);
    const block = html.slice(html.indexOf("data-zerops-operation-explanation"));

    expect(html).toContain("data-zerops-operation-explanation");
    expect(block).toContain(reason);
    const lines = [
      ...block.matchAll(/data-zerops-explanation-line="(error|plain)"[^>]*>([^<]*)</g),
    ];
    expect(lines.map(([, tone, text]) => ({ text, error: tone === "error" }))).toEqual(tail);
    if (tail.length > 0) {
      expect(block).toContain("font-mono");
      expect(block).toContain("text-destructive-foreground");
    }
  });

  it("a landed deploy explains nothing", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        now={0}
        operation={settled("zerops_deploy", { targetService: "apidev" }, "completed", {
          status: "DEPLOYED",
          targetService: "apidev",
        })}
      />,
    );
    expect(html).not.toContain("data-zerops-operation-explanation");
  });

  it("keeps a failed call's closing line beside the explanation", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        now={0}
        operation={settled("zerops_deploy", { targetService: "apidev" }, "failed", {
          code: "DEPLOY_FAILED",
          error: "zcli push failed",
          diagnostic: "exit status 1",
          failureClassification: { category: "credential", likelyCause: "GIT_TOKEN missing" },
        })}
      />,
    );
    expect(html).toContain('data-zerops-card-outcome="true"');
    expect(html).toContain("GIT_TOKEN missing");
  });
});
