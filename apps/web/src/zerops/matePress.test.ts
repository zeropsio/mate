import {
  PRESS_STEP_ATTEMPTS,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  beginPress,
  finishSetupView,
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
  pressingProjects,
  readMatePress,
  runPress,
  settlePress,
  STOPPED_SHOWN_MS,
  withPressTries,
  type MatePress,
  type MatePressState,
} from "./matePress";
import type { LockManagerLike } from "./mateLocks";

/** What HQ heard of the press: each close-off it was asked to mark. */
const hq = vi.hoisted(() => ({ calls: null as Array<string> | null }));
vi.mock("./accountHq", () => ({
  accountHqApi: () => ({
    recordClosedOff: async () => {
      hq.calls?.push("mark");
    },
  }),
}));

const mate = (serviceId: string | undefined, closedOff: boolean | undefined) => ({
  ...(serviceId === undefined ? {} : { service: { id: serviceId } }),
  project: {
    hq: {
      appId: null,
      appName: null,
      kind: "mate" as const,
      mate: { name: "Ada", face: "", ...(closedOff === undefined ? {} : { closedOff }) },
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
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "import-container", agents: [] },
    { kind: "close-off" },
    { kind: "register" },
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
      case: "its container being imported",
      made: press({ kind: "pressing" }, { progress: progress(["running", "queued", "queued"]) }),
      want: {
        done: false,
        line: "Finishing its setup…",
        steps: ["Container:active", "Closed off:waiting", "Registered:waiting"],
      },
    },
    {
      case: "closed off, being registered",
      made: press({ kind: "pressing" }, { progress: progress(["done", "done", "running"]) }),
      want: {
        done: false,
        line: "Finishing its setup…",
        steps: ["Container:done", "Closed off:done", "Registered:active"],
      },
    },
    {
      case: "through",
      made: press({ kind: "pressed" }, { progress: progress(["done", "done", "done"]) }),
      want: {
        done: true,
        line: "Its setup is finished. It comes up on its own now, with no browser needed.",
        steps: ["Container:done", "Closed off:done", "Registered:done"],
      },
    },
    {
      case: "through, its registration refused",
      made: press({ kind: "pressed" }, { progress: progress(["done", "done", "failed"]) }),
      want: {
        done: true,
        line: "Its setup is finished. It comes up on its own now, with no browser needed. It still needs an owner to register it.",
        steps: ["Container:done", "Closed off:done", "Registered:failed"],
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
      "Container:done",
      "Closed off:active",
      "Registered:waiting",
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
    const refusals = Array.from({ length: 4 }, () => "refused" as const);
    expect(await press(refusals)).toMatchObject({ ok: false, failedStep: { kind: "close-off" } });
    const stopped = readMatePress("p-1")?.state;
    expect(stopped).toMatchObject({
      kind: "failed",
      step: "close-off",
      reason: "The tag was refused.",
    });
    if (stopped?.kind !== "failed" || stopped.retry === null) throw new Error("no retry");
    // The platform now takes it: refusals spent, the retry runs through, and the press ends.
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
describe("withPressTries — the harden, tried again", () => {
  it("goes on once an attempt takes", async () => {
    let tries = 0;
    const waits: Array<number> = [];
    const outcome = await withPressTries(
      async () => {
        tries += 1;
        if (tries < 3) throw new Error("not yet");
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(outcome).toEqual({ ok: true });
    expect(waits).toHaveLength(2);
  });

  it("says why, after the press's own tries", async () => {
    let tries = 0;
    const outcome = await withPressTries(
      async () => {
        tries += 1;
        throw new Error("Refused.");
      },
      async () => undefined,
    );
    expect(outcome).toEqual({ ok: false, error: "Refused." });
    expect(tries).toBe(PRESS_STEP_ATTEMPTS);
  });
});

// A press record ended only with the tab (pass 28 review): it ends at the mark — the Mate needs no
// browser from then — or, for Finish setup, whose view says it is done, at its first connect.
describe("a press's end", () => {
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "import-container", agents: [] },
    { kind: "close-off" },
    { kind: "register" },
  ];
  const at = (states: ReadonlyArray<EnvironmentCreationStepProgress["state"]>) =>
    STEPS.map((step, index) => ({ step, state: states[index]! }));

  it.each([
    { case: "before its mark", states: ["done", "running", "queued"], want: false },
    { case: "marked, registering", states: ["done", "done", "running"], want: false },
    { case: "marked and registered", states: ["done", "done", "done"], want: true },
    { case: "marked, its registration refused", states: ["done", "done", "failed"], want: true },
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

// Review, pass 32: a Finish setup that stopped on a Mate with its container stood for good — its
// row said "Setup stopped" in place of its sign-in line, and once its link dropped the Mate read
// "Could not be set up". It says it stopped, then the row is the Mate's again; its menu still
// offers Finish setup, from the platform's facts.
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
      case: "on a Mate with its container: said, then gone",
      container: false,
      progress: undefined,
      stopped: STOPPED,
      stands: false,
    },
    {
      case: "after bringing its container: said, then gone, and no longer coming",
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
      vi.advanceTimersByTime(STOPPED_SHOWN_MS);
      expect(readMatePress("p-stop")?.state.kind).toBe(stands ? "failed" : undefined);
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

// Finish setup on an older Mate, or a pool-claimed one: its harden first, tried again; then its
// close-off, which trusts the harden and reads nothing (pass 28 review).
describe("finishMateSetup — the harden path", () => {
  const inputs = (harden: () => boolean, calls: Array<string>) =>
    ({
      client: {
        readProjectEnv: async () => {
          calls.push("read isolation");
          return [{ key: "envIsolation", content: "service" }];
        },
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
                ? Effect.succeed({ value: undefined })
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

  it("hardens, then marks it closed off without reading the isolation again", async () => {
    begin();
    const calls: Array<string> = [];
    expect(await finish(() => true, calls)).toMatchObject({ ok: true });
    expect(calls).toEqual(["harden", "mark"]);
    expect(readMatePress("p-old")?.state).toEqual({ kind: "pressed" });
    forgetPress("p-old");
  });

  // Every other close-off goes through the one procedure: two reads two seconds apart that say
  // closed, then the mark.
  it("closes a Mate off through the whole procedure where nothing hardened it", async () => {
    begin();
    const calls: Array<string> = [];
    expect(await finish(() => true, calls, { harden: false })).toMatchObject({ ok: true });
    expect(calls).toEqual(["read isolation", "read isolation", "mark"]);
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

  it("tries the harden again, and stops with Try again where it still fails", async () => {
    begin();
    const calls: Array<string> = [];
    let refusing = true;
    expect(await finish(() => !refusing, calls)).toMatchObject({
      ok: false,
      failedStep: { kind: "close-off" },
      error: "The isolation was refused.",
    });
    expect(calls.filter((call) => call === "harden")).toHaveLength(PRESS_STEP_ATTEMPTS);
    const stopped = readMatePress("p-old")?.state;
    if (stopped?.kind !== "failed" || stopped.retry === null) throw new Error("no retry");
    refusing = false;
    await stopped.retry();
    expect(readMatePress("p-old")?.state).toEqual({ kind: "pressed" });
    forgetPress("p-old");
  });
});

// A press or a harden this tab runs holds its Mate back from auto-connect (pass 28 review).
describe("pressingProjects", () => {
  it("names the projects whose press runs, and says when that changes", () => {
    let heard = 0;
    const stop = pressingProjects.subscribe(() => {
      heard += 1;
    });
    beginPress({
      projectId: "p-run",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
    });
    expect([...pressingProjects.read()]).toEqual(["p-run"]);
    forgetPress("p-run");
    expect([...pressingProjects.read()]).toEqual([]);
    expect(heard).toBe(2);
    stop();
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
