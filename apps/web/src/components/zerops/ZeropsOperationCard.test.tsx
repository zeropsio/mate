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
    expect(html).toContain(operation.kicker);
    if (operation.kind === "deploy") {
      // A card that names one service reads verb + hostname chip, not the voice sentence.
      expect(html).toMatch(
        new RegExp(`data-zerops-identity-chip[^>]*>${operation.target!.hostname}<`),
      );
      expect(html).not.toContain("data-zerops-voice-source");
    } else {
      expect(html).toContain(operation.voice);
      expect(html).toContain(`data-zerops-voice-source="${operation.voiceSource}"`);
    }
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

  it("renders the observation's secondary processes as compact rows under the steps", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard
        now={Date.parse("2026-09-01T00:00:42.000Z")}
        observed={{
          ...observed,
          chips: [
            {
              id: "p-subdomain",
              label: "Enable subdomain access",
              state: "running",
              stateLabel: "Running",
            },
          ],
        }}
        operation={running}
      />,
    );
    const chips = html.match(/<ol[^>]*aria-label="Other activity"[\s\S]*?<\/ol>/)?.[0];

    expect(chips).toContain("Enable subdomain access");
    expect(chips).toContain('data-zerops-process-density="compact"');
    expect(html.indexOf("Enable subdomain access")).toBeGreaterThan(html.indexOf("38 s"));
  });

  it("writes no provenance line while the provenance is empty", () => {
    const html = renderToStaticMarkup(
      <ZeropsOperationCard observed={{ ...observed, provenance: "" }} operation={running} />,
    );
    expect(html).not.toContain("data-zerops-operation-provenance");
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
    header(html).match(/data-zerops-primitive="micro-label"[^>]*>([^<]*)</)?.[1];
  const chipOf = (html: string) =>
    header(html).match(/data-zerops-identity-chip[^>]*>([^<]*)</)?.[1];
  const pathOf = (html: string) =>
    header(html).match(/data-zerops-subject-path[^>]*>([^<]*)</)?.[1];

  it.each([
    {
      name: "a running browser check on a service's subdomain",
      operation: browser("inProgress", { url: PAGE }),
      subjectHost: "kanbandev",
      verb: "Checking",
      chip: "kanbandev",
      path: "/cz/products/vltava?lang=cs",
    },
    {
      name: "a settled browser check on a host no service answers",
      operation: browser("completed", { url: PAGE }),
      subjectHost: undefined,
      verb: "Checked",
      chip: "kanbandev-26a7.prg1.zerops.app",
      path: "/cz/products/vltava?lang=cs",
    },
    {
      name: "a deploy",
      operation: deploy({ targetService: "weatherdash" }),
      subjectHost: undefined,
      verb: "Deploying",
      chip: "weatherdash",
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
    { toolName: "zerops_delete", input: { serviceHostname: "appdev" }, word: "Deleting" },
    { toolName: "zerops_scale", input: { serviceHostname: "appdev" }, word: "Scaling" },
    { toolName: "zerops_manage", input: { serviceHostname: "appdev" }, word: "Managing" },
    { toolName: "zerops_env", input: { serviceHostname: "appdev" }, word: "Updating environment" },
    {
      toolName: "zerops_dev_server",
      input: { hostname: "appdev", action: "start" },
      word: "dev server",
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

    expect(header).toContain(word);
  });
});

describe("ZeropsOperationCard — attempt number (R9)", () => {
  it("renders a muted 'attempt 3' in the status cluster of the third try", () => {
    const failedDeploy = (id: string, createdAt: string) =>
      zeropsCall({
        id,
        startedAt: createdAt,
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "failed",
        resultText: JSON.stringify({ code: "API_ERROR", error: "zerops.yml not found" }),
      });
    const { operations } = reduceZeropsOperations(
      [
        failedDeploy("r1", "2026-09-01T00:00:00.000Z"),
        failedDeploy("r2", "2026-09-01T00:01:00.000Z"),
        failedDeploy("r3", "2026-09-01T00:02:00.000Z"),
      ],
      CONTEXT,
    );
    const third = operations[2]!;
    expect(third.attempts).toBe(3);

    const html = renderToStaticMarkup(<ZeropsOperationCard operation={third} />);
    expect(html).toContain("attempt 3");
  });

  it("renders no attempt word for a single call", () => {
    const single = operationFor(
      zeropsCall({
        id: "single1",
        startedAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
      }),
    );
    expect(single.attempts).toBe(1);

    const html = renderToStaticMarkup(<ZeropsOperationCard operation={single} />);
    expect(html).not.toContain("attempt");
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

  it("a deploy with no observed region still draws its five pipeline slots", () => {
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

    expect(html.match(/data-zerops-process-state=/g)?.length ?? 0).toBe(5);
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
    expect(statusDotSpan).not.toContain("0:42");

    const durationSpan = html.match(/<span[^>]*data-zerops-operation-duration[^>]*>([^<]*)</);
    expect(durationSpan).toBeDefined();
    expect(durationSpan![1]).toContain("0:42");
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
    // The kicker stays only as the steps' accessible name; the one label a
    // header may set is the status word, as the verb of a card that names
    // one service.
    expect(header).not.toContain(operation.kicker);
    expect(microLabels).toEqual(operation.kind === "deploy" ? [operation.statusWord] : []);
    expect(html).not.toContain("border-t");
  });

  it("verify, done: the status reads as a word beside the voice line", () => {
    const operation = cases[1]!.operation;
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

  it("sets its steps in the compact density", () => {
    const html = renderToStaticMarkup(<ZeropsOperationCard operation={cases[1]!.operation} />);
    expect(html).toContain('data-zerops-process-density="compact"');
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
    steps: [{ id: "build", label: "Build", state: "done", stateLabel: "Done" }],
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
    expect(html.indexOf("data-zerops-operation-version")).toBeGreaterThan(
      html.indexOf('data-zerops-primitive="process-steps"'),
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
          provenance: "live from Zerops · 2 s ago",
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

  it("keeps a failed call's closing line and Details beside the explanation", () => {
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
    expect(html).toContain("Details");
  });
});
