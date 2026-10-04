import {
  finishMateSetupVerb,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  beginPress,
  finishSetupView,
  FINISHED_SETUP_LINE,
  forgetPress,
  interruptedPresses,
  progressPress,
  FINISHED_SHOWN_MS,
  PRESSED_ELSEWHERE,
  connectedPresses,
  finishSetupRowLine,
  finishSetupRunning,
  birthPresses,
  finishMateSetup,
  pressComingInput,
  pressDoneAt,
  pressesInFlight,
  readMatePress,
  runPress,
  settlePress,
  mateFinishRegistration,
  PRESS_CALL_CAP_MS,
  PRESS_CALL_SILENT,
  pressPlatform,
  whilePressing,
  type MatePress,
  type MatePressState,
} from "./matePress";
import type { LockManagerLike } from "./mateLocks";

/** What HQ heard of the press: each close-off it was asked to mark. */
const hq = vi.hoisted(() => ({
  calls: null as Array<string> | null,
  /** The id of the key the Mate named to HQ; none where it named none. */
  key: null as string | null,
  /** What HQ answers every attach with, where it takes none. */
  attachFailure: null as Error | null,
}));
vi.mock("./accountHq", () => ({
  accountHqApi: () => ({
    recordClosedOff: async () => {
      hq.calls?.push("mark");
    },
    bindBirth: async () => undefined,
    attachProject: async (
      appId: string,
      attach: {
        readonly mate?: {
          readonly face: string;
          readonly standUp?: boolean;
          readonly serviceId?: string;
        };
        readonly birth?: string;
      },
    ) => {
      if (hq.attachFailure !== null) {
        hq.calls?.push("attach failed");
        throw hq.attachFailure;
      }
      hq.calls?.push(
        `attach ${appId}${attach.mate?.serviceId === undefined ? "" : ` as ${attach.mate.serviceId}`}${attach.birth === undefined ? "" : ` closing ${attach.birth}`}${attach.mate?.standUp === true ? " asking its stand-up" : ""}`,
      );
    },
    createMate: async (mate: {
      readonly face: string;
      readonly standUp?: boolean;
      readonly serviceId?: string;
    }) => {
      hq.calls?.push(
        `record ${mate.face}${mate.serviceId === undefined ? "" : ` as ${mate.serviceId}`}${mate.standUp === true ? " asking its stand-up" : ""}`,
      );
    },
    mateKey: async () => hq.key,
  }),
}));

const mate = (serviceId: string | undefined, closedOff: boolean | undefined) => ({
  ...(serviceId === undefined ? {} : { service: { id: serviceId } }),
  project: {
    hq: {
      appId: null,
      appName: null,
      kind: "mate" as const,
      mate: { face: "", ...(closedOff === undefined ? {} : { closedOff }) },
    },
  },
});

// A press interrupted before its close-off: the container carries the press's marker, and HQ does
// not know its project closed off (pass 28). *Finish setup* finishes it.
describe("interruptedPresses", () => {
  it.each([
    {
      case: "a marked container whose project was never marked closed off",
      mate: mate("zcp-a", false),
      marker: true,
      interrupted: true,
    },
    {
      case: "a press that got as far as its close-off",
      mate: mate("zcp-a", true),
      marker: true,
      interrupted: false,
    },
    {
      case: "a Mate made before the press: no marker",
      mate: mate("zcp-a", false),
      marker: false,
      interrupted: false,
    },
    {
      case: "a marker the store has not read yet",
      mate: mate("zcp-a", false),
      marker: "unread" as const,
      interrupted: false,
    },
    {
      case: "a marker whose stream failed",
      mate: mate("zcp-a", false),
      marker: "unknown" as const,
      interrupted: false,
    },
    {
      case: "a Mate with no container listed",
      mate: mate(undefined, false),
      marker: true,
      interrupted: false,
    },
    {
      case: "a marked container HQ has said nothing of: an older HQ",
      mate: mate("zcp-a", undefined),
      marker: true,
      interrupted: true,
    },
    {
      case: "a marked container HQ holds no record of",
      mate: { service: { id: "zcp-a" }, project: {} },
      marker: true,
      interrupted: true,
    },
  ])("$case", ({ mate: candidate, marker, interrupted }) => {
    const markers = new Map([["zcp-a", marker]]);
    expect(interruptedPresses([candidate], markers).has("zcp-a")).toBe(interrupted);
  });
});

// Finish setup drawn as the Add dialog draws a press, then a clear end (live, 2026-10-01: Hugo's
// view went "could not be added", "isn't running", "coming up", and never said it was done).
describe("finishSetupView — Finish setup on a Mate's own view", () => {
  // As Finish setup runs (F6b): its record in its application before its container.
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "register" },
    { kind: "import-container", agents: [] },
    { kind: "close-off" },
  ];
  const progress = (
    states: ReadonlyArray<EnvironmentCreationStepProgress["state"]>,
  ): ReadonlyArray<EnvironmentCreationStepProgress> =>
    STEPS.map((step, index) => ({ step, state: states[index]! }));
  const press = (state: MatePressState, made: Partial<MatePress> = {}): MatePress => ({
    projectId: "p-hugo",
    organizationId: "org-acme",
    startedAt: 0,
    placement: null,
    container: true,
    finishing: true,
    state,
    ...made,
  });
  const drawn = (view: ReturnType<typeof finishSetupView>) =>
    view === undefined
      ? undefined
      : { done: view.done, line: view.line, steps: view.steps.map((s) => `${s.label}:${s.state}`) };

  it.each([
    {
      case: "an Add's press",
      made: press({ kind: "pressing" }, { finishing: false }),
      want: undefined,
    },
    {
      case: "before its first step",
      made: press({ kind: "pressing" }),
      want: { done: false, line: "Finishing its setup…", steps: [] },
    },
    {
      case: "registered, its container being imported",
      made: press({ kind: "pressing" }, { progress: progress(["done", "running", "queued"]) }),
      want: {
        done: false,
        line: "Finishing its setup…",
        steps: ["Registered:done", "Container:active", "Closed off:waiting"],
      },
    },
    {
      case: "being closed off",
      made: press({ kind: "pressing" }, { progress: progress(["done", "done", "running"]) }),
      want: {
        done: false,
        line: "Finishing its setup…",
        steps: ["Registered:done", "Container:done", "Closed off:active"],
      },
    },
    {
      case: "through",
      made: press({ kind: "pressed" }, { progress: progress(["done", "done", "done"]) }),
      want: {
        done: true,
        line: "Its setup is finished. It comes up on its own now, with no browser needed.",
        steps: ["Registered:done", "Container:done", "Closed off:done"],
      },
    },
    {
      case: "through, its registration refused",
      made: press({ kind: "pressed" }, { progress: progress(["failed", "done", "done"]) }),
      want: {
        done: true,
        line: "Its setup is finished. It comes up on its own now, with no browser needed. It still needs an owner to register it.",
        steps: ["Registered:failed", "Container:done", "Closed off:done"],
      },
    },
  ])("$case", ({ made, want }) => {
    expect(drawn(finishSetupView(made))).toEqual(want);
  });

  it("is kept on the press as it moves", () => {
    beginPress({
      projectId: "p-hugo",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
      finishing: true,
    });
    progressPress("p-hugo", progress(["done", "running", "queued"]));
    expect(drawn(finishSetupView(readMatePress("p-hugo")!))?.steps).toEqual([
      "Registered:done",
      "Container:active",
      "Closed off:waiting",
    ]);
    forgetPress("p-hugo");
    // A press nobody holds keeps nothing.
    progressPress("p-hugo", progress(["done", "done", "done"]));
    expect(readMatePress("p-hugo")).toBeUndefined();
  });
});

describe("runPress — a press settled, tried again, and one at a time", () => {
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [{ kind: "close-off", isolated: true }];
  const platform = (marks: Array<"ok" | "refused">): EnvironmentCreationPlatform =>
    ({
      markClosedOff: async () => {
        if (marks.shift() === "refused") throw new Error("The tag was refused.");
      },
    }) as unknown as EnvironmentCreationPlatform;
  const begin = (finishing = false) =>
    beginPress({
      projectId: "p-1",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
      finishing,
    });
  const press = (marks: Array<"ok" | "refused">, locks?: LockManagerLike) =>
    runPress({
      organizationId: "org-acme",
      steps: STEPS,
      platform: platform(marks),
      isCurrent: () => true,
      resume: { from: 0, projectId: "p-1", projectName: "Acme - Ada" },
      locks,
      sleep: async () => undefined,
    });

  it("settles a Finish setup that ran through, for its view to say so", async () => {
    begin(true);
    expect(await press(["ok"])).toMatchObject({ ok: true });
    expect(readMatePress("p-1")?.state).toEqual({ kind: "pressed" });
    forgetPress("p-1");
  });

  // Finish setup's record ends too: its view says done for a moment, then the row is the Mate's
  // again, ⋯ menu and all — it never waits for a connect that may not come (pass 28 review).
  it("clears a Finish setup a moment after its view said it is done", async () => {
    vi.useFakeTimers();
    try {
      begin(true);
      await press(["ok"]);
      expect(readMatePress("p-1")?.state).toEqual({ kind: "pressed" });
      vi.advanceTimersByTime(FINISHED_SHOWN_MS);
      expect(readMatePress("p-1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends an Add's press at its mark", async () => {
    begin();
    expect(await press(["ok"])).toMatchObject({ ok: true });
    expect(readMatePress("p-1")).toBeUndefined();
  });

  it("settles a press that stopped with Try again, which resumes it at the step that stopped", async () => {
    begin();
    const refusals: Array<"ok" | "refused"> = ["refused", "ok"];
    expect(await press(refusals)).toMatchObject({ ok: false, failedStep: { kind: "close-off" } });
    const stopped = readMatePress("p-1")?.state;
    expect(stopped).toMatchObject({
      kind: "failed",
      step: "close-off",
      reason: "The tag was refused.",
    });
    if (stopped?.kind !== "failed" || stopped.retry === null) throw new Error("no retry");
    expect(refusals).toEqual(["ok"]);
    // Only the manual action consumes the next attempt.
    await stopped.retry();
    expect(readMatePress("p-1")).toBeUndefined();
  });

  it("runs none where another tab is pressing the project, and says so", async () => {
    begin();
    const busy: LockManagerLike = { request: async (_name, _options, hold) => hold(null) };
    expect(await press(["ok"], busy)).toMatchObject({ ok: false, error: PRESSED_ELSEWHERE });
    expect(readMatePress("p-1")?.state).toMatchObject({
      kind: "failed",
      reason: PRESSED_ELSEWHERE,
    });
    forgetPress("p-1");
  });
});

// A pool-claimed Mate's harden ran once and was never tried again (pass 28 review).
// F6b (e2e, 2026-10-03): Dan's press stood "pressing" for two hours, his workspace's clock running
// on: a call of the press that never answered held it, and nothing bounded a try.
describe("a press whose platform never answers", () => {
  /** The account's command layer, whose container import never answers; whether it was ended. */
  const silentImport = () => {
    const seen = { interrupted: false };
    const inputs = {
      client: {} as never,
      organizationId: "org-acme",
      data: {
        organizationRef: (organizationId: string) => ({ organizationId }),
        projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
        runtime: {
          commands: {
            importDevelopmentContainer: () =>
              Effect.never.pipe(
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    seen.interrupted = true;
                  }),
                ),
              ),
          },
        },
      } as never,
    };
    return { inputs, seen };
  };

  it("gives a call a minute, then ends it where it stands and says it did not answer", async () => {
    vi.useFakeTimers();
    try {
      const { inputs, seen } = silentImport();
      const platform = pressPlatform(inputs, {
        register: null,
        hq: null,
        readObservedServices: async () => [],
      });
      const answer = platform
        .importDevelopmentContainer({ projectId: "p-1", projectName: "Acme - Dan", agents: [] })
        .then(
          () => "answered",
          (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
        );
      await vi.advanceTimersByTimeAsync(PRESS_CALL_CAP_MS - 1);
      expect(seen.interrupted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await answer).toBe(PRESS_CALL_SILENT);
      expect(seen.interrupted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the press at its container, for its view to say so and Finish setup to resume it", async () => {
    vi.useFakeTimers();
    try {
      const { inputs } = silentImport();
      beginPress({
        projectId: "p-1",
        organizationId: "org-acme",
        startedAt: 0,
        placement: null,
        container: true,
      });
      const outcome = runPress({
        organizationId: "org-acme",
        steps: [{ kind: "import-container", agents: [] }, { kind: "close-off" }],
        platform: pressPlatform(inputs, {
          register: null,
          hq: null,
          readObservedServices: async () => [],
        }),
        isCurrent: () => true,
        resume: { from: 0, projectId: "p-1", projectName: "Acme - Dan" },
        locks: undefined,
      });
      await vi.advanceTimersByTimeAsync(PRESS_CALL_CAP_MS);
      expect(await outcome).toMatchObject({
        ok: false,
        failedStep: { kind: "import-container" },
        error: PRESS_CALL_SILENT,
      });
      expect(readMatePress("p-1")?.state).toMatchObject({
        kind: "failed",
        step: "import-container",
        reason: PRESS_CALL_SILENT,
      });
    } finally {
      forgetPress("p-1");
      vi.useRealTimers();
    }
  });
});

// A press record ended only with the tab (pass 28 review): it ends at the mark — the Mate needs no
// browser from then — or, for Finish setup, whose view says it is done, at its first connect.
describe("a press's end", () => {
  // As a Mate's press runs (F6b): its record in its application before its container.
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "register" },
    { kind: "import-container", agents: [] },
    { kind: "close-off" },
  ];
  const at = (states: ReadonlyArray<EnvironmentCreationStepProgress["state"]>) =>
    STEPS.map((step, index) => ({ step, state: states[index]! }));

  it.each([
    { case: "registering", states: ["running", "queued", "queued"], want: false },
    { case: "registered, before its mark", states: ["done", "done", "running"], want: false },
    { case: "registered and marked", states: ["done", "done", "done"], want: true },
    { case: "its registration refused, marked", states: ["failed", "done", "done"], want: true },
  ] as const)("$case: $want", ({ states, want }) => {
    expect(pressDoneAt(at(states))).toBe(want);
  });

  it("ends every press whose Mate has connected", () => {
    const made = (projectId: string): MatePress => ({
      projectId,
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
      state: { kind: "pressed" },
    });
    expect(
      connectedPresses(
        [made("p-up"), made("p-coming"), made("p-unlisted")],
        [
          { project: { id: "p-up" }, group: "connected" },
          { project: { id: "p-coming" }, group: "provisioning" },
        ],
      ),
    ).toEqual(["p-up"]);
  });

  it("keeps a stopped Add's receipts even if its accepted container connects", () => {
    expect(
      connectedPresses(
        [
          {
            projectId: "p-stopped",
            state: {
              kind: "failed",
              step: "close-off",
              reason: "HQ isn't answering.",
              retry: null,
            },
          },
        ],
        [{ project: { id: "p-stopped" }, group: "connected" }],
      ),
    ).toEqual([]);
  });

  // Live, 2026-10-02: Finish setup on a Mate whose container was up — its press was ended the
  // moment it began, so nothing anywhere said its setup was being finished.
  it("leaves a Finish setup on a connected Mate to end on its own", () => {
    const made = (projectId: string, finishing: boolean): MatePress => ({
      projectId,
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
      ...(finishing ? { finishing: true } : {}),
      state: { kind: "pressing" },
    });
    expect(
      connectedPresses(
        [made("p-finishing", true), made("p-added", false)],
        [
          { project: { id: "p-finishing" }, group: "connected" },
          { project: { id: "p-added" }, group: "connected" },
        ],
      ),
    ).toEqual(["p-added"]);
  });
});

// A stopped Finish setup keeps its reason and manual continuation, including after bringing
// its container. Its coming-up projection still distinguishes what it brought.
describe("a Finish setup that stopped", () => {
  const STOPPED: MatePressState = {
    kind: "failed",
    step: "close-off",
    reason: "Zerops refused the change",
    retry: null,
  };
  const begin = (container: boolean) =>
    beginPress({
      projectId: "p-stop",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container,
      finishing: true,
    });

  const atImport: MatePressState = { ...STOPPED, step: "import-container" };
  const IMPORT: EnvironmentCreationStep = { kind: "import-container", agents: [] };
  const CLOSE_OFF: EnvironmentCreationStep = { kind: "close-off" };
  /** Its container came, and its close-off stopped. */
  const BROUGHT: ReadonlyArray<EnvironmentCreationStepProgress> = [
    { step: IMPORT, state: "done" },
    { step: CLOSE_OFF, state: "failed" },
  ];
  /** Its import stopped. */
  const NOT_BROUGHT: ReadonlyArray<EnvironmentCreationStepProgress> = [
    { step: IMPORT, state: "failed" },
    { step: CLOSE_OFF, state: "queued" },
  ];

  // Pass 32 reviews: whether a stop stands is read off what it brought, never off a step's name —
  // its harden and the lock of another tab stop it before any step, naming its close-off.
  it.each([
    {
      case: "on a Mate with its container: the stop stays",
      container: false,
      progress: undefined,
      stopped: STOPPED,
      stands: false,
    },
    {
      case: "after bringing its container: the stop stays without saying it is coming",
      container: true,
      progress: BROUGHT,
      stopped: STOPPED,
      stands: false,
    },
    {
      case: "bringing its container, at its import: stands with its reason",
      container: true,
      progress: NOT_BROUGHT,
      stopped: atImport,
      stands: true,
    },
    {
      case: "bringing its container, before any step (its harden, another tab's lock): stands",
      container: true,
      progress: undefined,
      stopped: STOPPED,
      stands: true,
    },
  ])("$case", ({ container, progress, stopped, stands }) => {
    vi.useFakeTimers();
    try {
      begin(container);
      if (progress !== undefined) progressPress("p-stop", progress);
      settlePress("p-stop", stopped);
      const press = readMatePress("p-stop");
      expect(finishSetupRowLine(press)).toBe("Setup stopped");
      expect(pressComingInput([press!], "p-stop")).toEqual({
        press: { startedAt: 0, container: stands, retryable: false },
        setUpFailed: stands ? "Zerops refused the change" : undefined,
      });
      vi.advanceTimersByTime(60_000);
      expect(readMatePress("p-stop")?.state).toEqual(stopped);
    } finally {
      forgetPress("p-stop");
      vi.useRealTimers();
    }
  });

  it("is running only between its press and its end", () => {
    try {
      begin(false);
      expect(finishSetupRunning(readMatePress("p-stop"))).toBe(true);
      settlePress("p-stop", STOPPED);
      expect(finishSetupRunning(readMatePress("p-stop"))).toBe(false);
    } finally {
      forgetPress("p-stop");
    }
    expect(finishSetupRunning(undefined)).toBe(false);
  });
});

describe("finishSetupRowLine — Finish setup as its Mate's row says it, from any screen", () => {
  const press = (state: MatePressState, finishing: boolean): MatePress => ({
    projectId: "p-hugo",
    organizationId: "org-acme",
    startedAt: 0,
    placement: null,
    container: true,
    ...(finishing ? { finishing: true } : {}),
    state,
  });
  const failed: MatePressState = {
    kind: "failed",
    step: "close-off",
    reason: "Zerops refused the change",
    retry: null,
  };

  it.each([
    { case: "no press", press: undefined, line: undefined },
    {
      case: "an Add's press: its dialog and its view say it",
      press: press({ kind: "pressing" }, false),
      line: undefined,
    },
    { case: "finishing", press: press({ kind: "pressing" }, true), line: "Finishing setup…" },
    {
      case: "finished, for the moment its record stays",
      press: press({ kind: "pressed" }, true),
      line: "Setup finished",
    },
    {
      case: "stopped: Finish setup is on its menu again",
      press: press(failed, true),
      line: "Setup stopped",
    },
  ])("$case", ({ press, line }) => {
    expect(finishSetupRowLine(press)).toBe(line);
  });
});

// Finish setup on an older Mate, or a pool-claimed one: one harden first; then its
// close-off, which trusts the harden and reads nothing (pass 28 review).
/** A zcp service of a project, as the platform lists it. */
const zcp = (id: string, name: string) => ({
  id,
  name,
  status: "ACTIVE",
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
});

describe("finishMateSetup — the harden path", () => {
  const inputs = (
    harden: () => boolean,
    calls: Array<string>,
    services: ReadonlyArray<ReturnType<typeof zcp>> = [],
  ) =>
    ({
      client: {
        readProjectEnv: async () => {
          calls.push("read isolation");
          return [{ key: "envIsolation", content: "service" }];
        },
        listProjectServices: async () => services,
      },
      organizationId: "org-acme",
      data: {
        organizationRef: (organizationId: string) => ({ kind: "organization", organizationId }),
        projectRef: (_organizationId: string, projectId: string) => ({
          kind: "project",
          projectId,
        }),
        runtime: {
          commands: {
            isolateProjectEnv: () => {
              calls.push("harden");
              return harden()
                ? Effect.succeed({
                    value: {
                      tokenLowered: true,
                      keyNotLowered: null,
                      delegationsDropped: 0,
                      isolationSteps: 1,
                      restarted: false,
                    },
                  })
                : Effect.fail({
                    _tag: "IsolationRefused" as const,
                    message: "The isolation was refused.",
                  });
            },
          },
        },
      },
    }) as never;
  const finish = (
    harden: () => boolean,
    calls: Array<string>,
    made: { readonly harden?: boolean } = {},
  ) => {
    hq.calls = calls;
    return finishMateSetup({
      inputs: inputs(harden, calls),
      projectId: "p-old",
      projectName: "Acme - Ada",
      container: null,
      registration: null,
      hq: { projectId: "hq-project", address: "https://hq.test" },
      isCurrent: () => true,
      harden: made.harden ?? true,
      locks: undefined,
      sleep: async () => undefined,
    });
  };
  const begin = () =>
    beginPress({
      projectId: "p-old",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
      finishing: true,
    });

  // F6b (2026-10-03): its record in its application before its container, so a Finish setup
  // that stops after leaves a Mate HQ holds there; the close-off marked once, after the isolation
  // it marks — never with the record, which comes before it.
  it("writes its record in its application before its container, and marks it closed off after", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls) as unknown as {
      readonly data: { readonly runtime: { readonly commands: Record<string, unknown> } };
    };
    const withContainer = {
      ...base,
      data: {
        ...base.data,
        runtime: {
          ...base.data.runtime,
          commands: {
            ...base.data.runtime.commands,
            importDevelopmentContainer: () => {
              calls.push("container");
              return Effect.succeed({ value: { serviceName: "zcp", imported: true } });
            },
          },
        },
      },
    };
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: withContainer as never,
        projectId: "p-old",
        projectName: "mate-rig-e2e-d - Dan",
        container: { agents: [] },
        registration: {
          hq: { projectId: "hq-project", address: "https://hq.test" },
          groupId: "app-d",
          kind: "mate",
          mate: { face: undefined },
          standUp: false,
        },
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual(["attach app-d", "container", "read isolation", "mark"]);
    forgetPress("p-old");
  });

  // The stopped registration retains the application in its birth intent (F6c), so another
  // browser's Finish setup can attach it there and continue the unattempted steps.
  it("a stopped registration retains its birth intent for another browser's Finish setup", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls) as unknown as {
      readonly data: { readonly runtime: { readonly commands: Record<string, unknown> } };
    };
    const withContainer = {
      ...base,
      data: {
        ...base.data,
        runtime: {
          ...base.data.runtime,
          commands: {
            ...base.data.runtime.commands,
            importDevelopmentContainer: () => {
              calls.push("container");
              return Effect.succeed({ value: { serviceName: "zcp", imported: true } });
            },
          },
        },
      },
    };
    const HQ_ENDPOINT = { projectId: "hq-project", address: "https://hq.test" };
    hq.calls = calls;
    hq.attachFailure = new HqError({
      kind: "unavailable",
      code: "not_active",
      status: 503,
      message: "HQ isn't serving right now.",
    });
    // The first browser's press stops at the one attach HQ answers with 503.
    const pressed = await finishMateSetup({
      inputs: withContainer as never,
      projectId: "gus-project",
      projectName: "mate-rig-e2e-g - Gus",
      container: { agents: [] },
      registration: {
        hq: HQ_ENDPOINT,
        groupId: "app-g",
        kind: "mate",
        mate: { face: undefined },
        standUp: false,
        intent: "b-gus",
      },
      hq: HQ_ENDPOINT,
      isCurrent: () => true,
      harden: false,
      locks: undefined,
      sleep: async () => undefined,
    });
    expect(pressed).toMatchObject({ ok: false, failedStep: { kind: "register" } });
    expect(calls).toEqual(["attach failed"]);
    forgetPress("gus-project");

    // Another browser, with no press of its own, once the grace a running press has is past: HQ
    // holds no record of Gus, and still holds the birth intent no attach closed.
    hq.attachFailure = null;
    calls.length = 0;
    expect(
      finishMateSetupVerb({
        registration: "registered",
        containerMissing: false,
        closedOffMissing: false,
        pressStopped: false,
        pastGrace: true,
        viewerIsAdder: false,
        hasContainer: true,
        writer: false,
        recordMissing: true,
        mayCreateRecord: true,
      }),
    ).toBe("Finish setup");
    const registration = mateFinishRegistration({
      hq: HQ_ENDPOINT,
      hqKnown: true,
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "app-g",
            name: "mate-rig-e2e-g",
            projects: [],
            births: [{ id: "b-gus", face: "rose:seal", projectId: "gus-project" }],
          },
        ],
      },
      project: {
        id: "gus-project",
        name: "mate-rig-e2e-g - Gus",
        status: "ACTIVE",
        tagList: ["mate"],
      } as never,
      press: undefined,
      writer: false,
      mayCreateRecord: true,
      standUp: false,
      candidates: [],
    });
    expect(registration).toMatchObject({ groupId: "app-g", intent: "b-gus" });
    beginPress({
      projectId: "gus-project",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: false,
      finishing: true,
    });
    expect(
      await finishMateSetup({
        inputs: withContainer as never,
        projectId: "gus-project",
        projectName: "mate-rig-e2e-g - Gus",
        container: { agents: [] },
        registration,
        hq: HQ_ENDPOINT,
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toContain("attach app-g closing b-gus");
    forgetPress("gus-project");
  });

  // F6c (2026-10-03): a Mate whose project names its birth intent closes it with its attach.
  it("attaches a Mate born under an intent closing the intent", async () => {
    begin();
    const calls: Array<string> = [];
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: inputs(() => true, calls),
        projectId: "p-old",
        projectName: "mate-rig-e2e-g - Gus",
        container: null,
        registration: {
          hq: { projectId: "hq-project", address: "https://hq.test" },
          groupId: "app-g",
          kind: "mate",
          mate: { face: undefined },
          standUp: false,
          intent: "b-gus",
        },
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toContain("attach app-g closing b-gus");
    forgetPress("p-old");
  });

  // Audit B3: the person's stand-up ask rides in the write that records the Mate, so no Mate is
  // ever recorded without the ask it was made with — never a call of its own after it.
  it.each([
    {
      case: "an attach",
      registration: {
        hq: { projectId: "hq-project", address: "https://hq.test" },
        groupId: "app-d",
        kind: "mate" as const,
        mate: { face: undefined },
        standUp: true,
      },
      write: "attach app-d asking its stand-up",
    },
    {
      case: "a record in no application",
      registration: {
        hq: { projectId: "hq-project", address: "https://hq.test" },
        kind: "mate-record" as const,
        record: { face: "sand:seal" },
        standUp: true,
      },
      write: "record sand:seal asking its stand-up",
    },
  ])("asks for the stand-up in $case", async ({ registration, write }) => {
    begin();
    const calls: Array<string> = [];
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: inputs(() => true, calls),
        projectId: "p-old",
        projectName: "mate-rig-e2e-d - Dan",
        container: null,
        registration,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual(["harden", write, "mark"]);
    forgetPress("p-old");
  });

  it("hardens, then marks it closed off without reading the isolation again", async () => {
    begin();
    const calls: Array<string> = [];
    expect(await finish(() => true, calls)).toMatchObject({ ok: true });
    expect(calls).toEqual(["harden", "mark"]);
    expect(readMatePress("p-old")?.state).toEqual({ kind: "pressed" });
    forgetPress("p-old");
  });

  // Every other close-off checks isolation once before the mark.
  it("closes a Mate off through the whole procedure where nothing hardened it", async () => {
    begin();
    const calls: Array<string> = [];
    expect(await finish(() => true, calls, { harden: false })).toMatchObject({ ok: true });
    expect(calls).toEqual(["read isolation", "mark"]);
    forgetPress("p-old");
  });

  // ADR 0003: a press gives no other Mate of the application sight of the new project — it lists
  // and writes no key but through its own steps.
  it("writes no other Mate's key", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls) as unknown as {
      readonly client: Record<string, unknown>;
    };
    const client = {
      ...base.client,
      listIntegrationTokens: async () => {
        calls.push("list keys");
        return [
          {
            id: "k-sib",
            name: "zcp-p-sib",
            roleCode: "NO_ACCESS",
            createdByUser: "u-zoe",
            projects: [{ projectId: "p-sib", roleCode: "BASIC_USER" }],
          },
        ];
      },
      setIntegrationTokenProjects: async (input: { readonly tokenId: string }) => {
        calls.push(`put ${input.tokenId}`);
      },
    };
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: { ...(base as object), client } as never,
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.startsWith("put") || call === "list keys")).toEqual([]);
    forgetPress("p-old");
  });

  // Step A, A11: an admin adopting a Mate whose key an owner made may not write that key. The
  // adoption finishes, and its view and its row say the key stayed as it was, and who can lower it.
  it("says a key it could not lower, and finishes", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls) as unknown as {
      readonly data: { readonly runtime: { readonly commands: Record<string, unknown> } };
    };
    const refusedKey = {
      ...base,
      data: {
        ...base.data,
        runtime: {
          ...base.data.runtime,
          commands: {
            ...base.data.runtime.commands,
            isolateProjectEnv: () =>
              Effect.succeed({
                value: {
                  tokenLowered: false,
                  keyNotLowered: "This Zerops account is not allowed to do that.",
                  delegationsDropped: 0,
                  isolationSteps: 1,
                  restarted: false,
                },
              }),
          },
        },
      },
    };
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: refusedKey as never,
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    const said =
      "The Mate's key couldn't be lowered: This Zerops account is not allowed to do that; an owner can do it.";
    const press = readMatePress("p-old");
    expect([press?.state.kind, finishSetupView(press)?.line, finishSetupRowLine(press)]).toEqual([
      "pressed",
      `${FINISHED_SETUP_LINE} ${said}`,
      `Setup finished. ${said}`,
    ]);
    forgetPress("p-old");
  });

  // Key by id (audit K3): an adopted Mate's key is hardened by the id the Mate named to HQ, where
  // it named one; matched on the token list only where it did not.
  it("hardens an adopted Mate's key by the id HQ names", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls) as unknown as {
      readonly data: { readonly runtime: { readonly commands: Record<string, unknown> } };
    };
    const asked: Array<string | undefined> = [];
    const byId = {
      ...base,
      data: {
        ...base.data,
        runtime: {
          ...base.data.runtime,
          commands: {
            ...base.data.runtime.commands,
            isolateProjectEnv: (_project: unknown, keyTokenId?: string) => {
              asked.push(keyTokenId);
              return Effect.succeed({
                value: {
                  tokenLowered: true,
                  keyNotLowered: null,
                  delegationsDropped: 0,
                  isolationSteps: 1,
                  restarted: false,
                },
              });
            },
          },
        },
      },
    };
    hq.calls = calls;
    const finishOld = () =>
      finishMateSetup({
        inputs: byId as never,
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      });
    hq.key = "token-7";
    expect(await finishOld()).toMatchObject({ ok: true });
    hq.key = null;
    expect(await finishOld()).toMatchObject({ ok: true });
    expect(asked).toEqual(["token-7", undefined]);
    forgetPress("p-old");
  });

  // One Mate per project (audit D2): Set up Mate and Finish setup on a project holding several zcp
  // services stop before anything is written, naming them; Try again reads the project again.
  it("stops on a project holding several zcp services before anything is written, naming them", async () => {
    begin();
    const calls: Array<string> = [];
    const services = [zcp("svc-1", "zcp"), zcp("svc-2", "zcp1")];
    hq.calls = calls;
    const finishing = {
      inputs: inputs(() => true, calls, services),
      projectId: "p-old",
      projectName: "Acme - Ada",
      container: null,
      registration: {
        hq: { projectId: "hq-project", address: "https://hq.test" },
        kind: "mate-record" as const,
        record: { face: "sky:seal" },
        standUp: false,
      },
      hq: { projectId: "hq-project", address: "https://hq.test" },
      isCurrent: () => true,
      harden: true,
      locks: undefined,
      sleep: async () => undefined,
    };
    const error =
      "This project has more than one Zerops Control Plane (zcp, zcp1). A project holds one Mate: delete the others in Zerops, then try again.";
    expect(await finishMateSetup(finishing)).toMatchObject({
      ok: false,
      failedStep: { kind: "register" },
      error,
    });
    expect(calls).toEqual([]);
    const stopped = readMatePress("p-old")?.state;
    expect(stopped).toMatchObject({ kind: "failed", reason: error });
    if (stopped?.kind !== "failed" || stopped.retry === null) throw new Error("no retry");
    services.pop();
    await stopped.retry();
    expect(calls).toEqual(["harden", "record sky:seal as svc-1", "mark"]);
    forgetPress("p-old");
  });

  it.each([
    {
      case: "an attach",
      registration: {
        hq: { projectId: "hq-project", address: "https://hq.test" },
        groupId: "app-d",
        kind: "mate" as const,
        mate: { face: undefined },
        standUp: false,
      },
      write: "attach app-d as svc-1",
    },
    {
      case: "a record in no application",
      registration: {
        hq: { projectId: "hq-project", address: "https://hq.test" },
        kind: "mate-record" as const,
        record: { face: "sand:seal" },
        standUp: false,
      },
      write: "record sand:seal as svc-1",
    },
  ])("names the project's one zcp service in $case", async ({ registration, write }) => {
    begin();
    const calls: Array<string> = [];
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: inputs(() => true, calls, [zcp("svc-1", "zcp")]),
        projectId: "p-old",
        projectName: "mate-rig-e2e-d - Dan",
        container: null,
        registration,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual(["harden", write, "mark"]);
    forgetPress("p-old");
  });

  it("Finish setup resumes a retained stopped press without repeating its accepted writes", async () => {
    begin();
    const calls: Array<string> = [];
    const steps: ReadonlyArray<EnvironmentCreationStep> = [
      { kind: "register" },
      { kind: "import-container", agents: [] },
      { kind: "close-off", isolated: true },
    ];
    const platform = {
      register: async () => {
        calls.push("register");
      },
      importDevelopmentContainer: async () => {
        calls.push("container");
        return { serviceName: "zcp", imported: true };
      },
      readIsolation: async () => "service",
      markClosedOff: async () => {
        calls.push("failed mark");
        throw new Error("HQ isn't answering.");
      },
    } as unknown as EnvironmentCreationPlatform;
    expect(
      await runPress({
        organizationId: "org-acme",
        steps,
        platform,
        isCurrent: () => true,
        resume: { from: 0, projectId: "p-old", projectName: "Acme - Ada" },
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: false, serviceName: "zcp", failedStep: { kind: "close-off" } });
    expect(calls).toEqual(["register", "container", "failed mark"]);
    // The menu begins a new presentation before calling Finish setup.
    begin();
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: inputs(() => true, calls, [zcp("svc-1", "zcp")]),
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: { agents: [] },
        registration: {
          hq: { projectId: "hq-project", address: "https://hq.test" },
          kind: "mate-record",
          record: { face: "sky:seal" },
          standUp: false,
        },
        hq: { projectId: "hq-project", address: "https://hq.test" },
        harden: true,
        isCurrent: () => true,
        locks: undefined,
        sleep: async () => undefined,
      }),
    ).toMatchObject({ ok: true, serviceName: "zcp" });
    expect(calls).toEqual(["register", "container", "failed mark", "mark"]);
    forgetPress("p-old");
  });

  it("reads the project's services once and exposes a manual continuation after failure", async () => {
    begin();
    const calls: Array<string> = [];
    let reads = 0;
    const base = inputs(() => true, calls) as unknown as { client: Record<string, unknown> };
    const finishing = {
      inputs: {
        ...base,
        client: {
          ...base.client,
          listProjectServices: async () => {
            reads += 1;
            if (reads === 1) throw new Error("Zerops isn't answering.");
            return [];
          },
        },
      } as never,
      projectId: "p-old",
      projectName: "Acme - Ada",
      container: null,
      registration: null,
      hq: null,
      isCurrent: () => true,
      locks: undefined,
      sleep: async () => {
        throw new Error("A failed read must not wait and repeat.");
      },
    };
    expect(await finishMateSetup(finishing)).toMatchObject({
      ok: false,
      error: "Zerops isn't answering.",
    });
    expect(reads).toBe(1);
    expect(calls).toEqual([]);
    const stopped = readMatePress("p-old")?.state;
    if (stopped?.kind !== "failed" || stopped.retry === null)
      throw new Error("no manual continuation");
    await stopped.retry();
    expect(reads).toBe(2);
    expect(readMatePress("p-old")?.state).toEqual({ kind: "pressed" });
    forgetPress("p-old");
  });

  it("hardens once, stops visibly, and hardens once more only on Try again", async () => {
    begin();
    const calls: Array<string> = [];
    let refusing = true;
    expect(await finish(() => !refusing, calls)).toMatchObject({
      ok: false,
      failedStep: { kind: "close-off" },
      error: "The isolation was refused.",
    });
    expect(calls).toEqual(["harden"]);
    const stopped = readMatePress("p-old")?.state;
    if (stopped?.kind !== "failed" || stopped.retry === null) throw new Error("no retry");
    refusing = false;
    await stopped.retry();
    expect(readMatePress("p-old")?.state).toEqual({ kind: "pressed" });
    expect(calls).toEqual(["harden", "harden", "mark"]);
    forgetPress("p-old");
  });
});

// F6b (e2e, 2026-10-03): *Set up Mate* and *Finish setup* on Dan — a Mate project its press for
// mate-rig-e2e-d left with no container — wrote "Asha" in no application. Both verbs now register by
// one rule, and neither mints a new Mate where HQ holds one, or may yet.
describe("mateFinishRegistration — what Finish setup and Set up Mate register", () => {
  const HQ = { kind: "official", projectId: "p-hq", address: "https://hq.example.test" } as const;
  const FACE = { tint: "coral", shape: "gem" } as const;
  const DAN = {
    id: "dan-project",
    name: "mate-rig-e2e-d - Dan",
    status: "ACTIVE",
    tagList: ["mate"],
  } as const;
  /** Dan as HQ holds him: in `appId`, or in no application. */
  const held = (appId: string | null) => ({
    ...DAN,
    hq: {
      appId,
      appName: appId === null ? null : "mate-rig-e2e-d",
      kind: "mate",
      mate: { face: "coral:gem" },
    },
  });
  const pressOf = (kind: "mate" | "stage"): MatePress => ({
    projectId: DAN.id,
    organizationId: "org-acme",
    startedAt: 0,
    container: kind === "mate",
    placement: {
      groupId: "app-d",
      groupName: "mate-rig-e2e-d",
      kind,
      displayName: "mate-rig-e2e-d - Dan",
      face: FACE,
    },
    state: { kind: "pressing" },
  });
  /** HQ's structure: G, holding the birth intent Gus's project was created under. */
  const STRUCTURE = {
    ungrouped: [],
    apps: [
      {
        id: "app-g",
        name: "mate-rig-e2e-g",
        projects: [],
        births: [{ id: "b-gus", face: "rose:seal", projectId: "gus-project" }],
      },
    ],
  };
  /** Gus's project, its press cut off between its creation and its attach (F6c, 2026-10-03). */
  const GUS = {
    id: "gus-project",
    name: "mate-rig-e2e-g - Gus",
    status: "ACTIVE",
    tagList: ["mate"],
  } as const;
  const BASE = {
    hqKnown: true,
    structure: STRUCTURE,
    writer: true,
    mayCreateRecord: true,
    press: undefined,
  };

  it.each([
    {
      name: "HQ holds it in its application: there, under HQ's face",
      input: { ...BASE, project: held("app-d") },
      expected: { kind: "mate", groupId: "app-d", mate: { face: FACE } },
    },
    {
      name: "HQ holds it in its application, for someone who does not write the registry: nothing",
      input: { ...BASE, writer: false, project: held("app-d") },
      expected: null,
    },
    {
      name: "HQ holds it in no application: nothing, its record standing",
      input: { ...BASE, project: held(null) },
      expected: null,
    },
    {
      name: "HQ's structure not read yet: nothing, however recordless it looks",
      input: { ...BASE, hqKnown: false, project: DAN },
      expected: null,
    },
    {
      name: "no record, a press here placed it: into that application, under its face",
      input: { ...BASE, press: pressOf("mate"), project: DAN },
      expected: { kind: "mate", groupId: "app-d", mate: { face: FACE } },
    },
    {
      name: "no record and no press here, its project naming its birth intent: into the intent's application, under its face, closing it",
      input: { ...BASE, project: GUS },
      expected: {
        kind: "mate",
        groupId: "app-g",
        mate: { face: { tint: "rose", shape: "seal" } },
        intent: "b-gus",
      },
    },
    {
      name: "no record, a press here placed it, its project naming its birth intent: the intent",
      input: { ...BASE, press: pressOf("mate"), project: GUS },
      expected: { kind: "mate", groupId: "app-g", intent: "b-gus" },
    },
    {
      name: "no record and no press here: a new Mate in no application, for who may write it",
      input: { ...BASE, project: DAN },
      expected: { kind: "mate-record" },
    },
    {
      name: "no record, the press here made a stage: a new Mate in no application",
      input: { ...BASE, press: pressOf("stage"), project: DAN },
      expected: { kind: "mate-record" },
    },
    {
      name: "no record, for someone HQ's rule does not let write one: nothing",
      input: { ...BASE, mayCreateRecord: false, project: DAN },
      expected: null,
    },
  ] as const)("$name", ({ input, expected }) => {
    const registration = mateFinishRegistration({
      ...input,
      hq: HQ,
      project: input.project as never,
      standUp: false,
      candidates: [],
    });
    if (expected === null) expect(registration).toBeNull();
    else expect(registration).toMatchObject({ hq: HQ, standUp: false, ...expected });
    // D3: a Mate's name is its project's in Zerops; nothing registered in HQ carries one.
    if (registration?.kind === "mate") expect(registration.mate).not.toHaveProperty("name");
    if (registration?.kind === "mate-record") {
      expect(registration.record).not.toHaveProperty("name");
    }
  });
});

// E2E 2026-10-03: the first write after a fresh load failed while the background minted and deleted
// throwaways on the token list the press reads. The background holds while any press is in
// flight, from before the platform takes its project to its end.
describe("pressesInFlight", () => {
  it("says a press is in flight from its first step to its end", async () => {
    const seen: Array<boolean> = [];
    const stop = pressesInFlight.subscribe(() => seen.push(pressesInFlight.read()));
    let during: boolean | undefined;
    const platform = {
      markClosedOff: async () => {
        during = pressesInFlight.read();
      },
    } as unknown as EnvironmentCreationPlatform;
    expect(pressesInFlight.read()).toBe(false);
    await runPress({
      organizationId: "org-acme",
      steps: [{ kind: "close-off", isolated: true }],
      platform,
      isCurrent: () => true,
      resume: { from: 0, projectId: "p-flight", projectName: "Acme - Ada" },
      locks: undefined,
      sleep: async () => undefined,
    });
    forgetPress("p-flight");
    expect({ during, after: pressesInFlight.read(), seen }).toEqual({
      during: true,
      after: false,
      seen: [true, false],
    });
    stop();
  });

  it("counts a New project's creation before its project exists, and two until both end", async () => {
    let finishFirst = (): void => undefined;
    const first = whilePressing(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    await whilePressing(async () => {
      expect(pressesInFlight.read()).toBe(true);
    });
    expect(pressesInFlight.read()).toBe(true);
    finishFirst();
    await first;
    expect(pressesInFlight.read()).toBe(false);
    await expect(whilePressing(() => Promise.reject(new Error("refused")))).rejects.toThrow(
      "refused",
    );
    expect(pressesInFlight.read()).toBe(false);
  });
});

// Re-check of pass 32, live: Finish setup pressed on the projects page pulled the person into the
// Mate's conversation once it connected, as an Add's press does — pressed anywhere else it did not.
describe("birthPresses — the presses that make a Mate, whose conversation the press lands in", () => {
  const press = (projectId: string, finishing: boolean): MatePress => ({
    projectId,
    organizationId: "org-acme",
    startedAt: 0,
    placement: null,
    container: true,
    ...(finishing ? { finishing: true } : {}),
    state: { kind: "pressing" },
  });

  it("names an Add's or a New project's press, never a Finish setup", () => {
    expect(birthPresses([press("p-added", false), press("p-finishing", true)])).toEqual([
      "p-added",
    ]);
  });
});
