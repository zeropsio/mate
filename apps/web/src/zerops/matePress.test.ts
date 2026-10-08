import { Atom } from "effect/reactivity";
import {
  makeAccountStore,
  creationPressStoreAtom,
  accountReadsAtom,
  type AccountStore,
  type ProjectServices,
} from "@t3tools/client-runtime/data";
import { appAtomRegistry } from "../rpc/atomRegistry";
beforeEach(() => {
  appAtomRegistry.set(creationPressStoreAtom, makeAccountStore(appAtomRegistry));
});
import {
  acquireHqPressLease as pressHold,
  PRESS_RENEW_MS,
  PRESS_STEP_RENEW_MS,
} from "@t3tools/client-runtime/data";
import {
  finishMateSetupVerb,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { RunToEnd } from "@t3tools/client-runtime/data";
import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  closeOffHoldOf,
  closeOffOpenOf,
  closeOffPendingOf,
  finishSetupRowLine,
  finishSetupRunning,
  birthPresses,
  finishMateSetup,
  pressComingInput,
  pressDoneAt,
  pressesInFlight,
  readMatePress,
  runPress,
  recordPressOutcome,
  STOPPED_SHOWN_MS,
  mateFinishRegistration,
  PRESS_MAY_HAVE_LANDED,
  PRESSED_IN_ANOTHER_BROWSER,
  whilePressing,
  type MatePress,
  type MatePressState,
  type PressInputs,
} from "./matePress";
import { accountHqApi } from "./accountHq";
import type { LockManagerLike } from "./mateLocks";

const serviceRead = Atom.make<ProjectServices>({ services: [], live: true, reconnecting: false });
function servicesReading(value: ProjectServices) {
  appAtomRegistry.set(serviceRead, value);
  const owner = appAtomRegistry.get(creationPressStoreAtom)!;
  const data: AccountStore["data"] = {
    ...owner.data,
    project: (projection, key) =>
      projection.name === "projectServices"
        ? (serviceRead as unknown as ReturnType<
            typeof owner.data.project<typeof key, ReturnType<typeof projection.derive>>
          >)
        : owner.data.project(projection, key),
  };
  appAtomRegistry.set(accountReadsAtom, {
    orgId: "org-acme",
    data,
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
}
/** A step's owner answer. */
const answered = <A>(answer: { readonly value: A }) => Promise.resolve(answer.value);
/**
 * The account's operations as a press's tests stand them in: each Zerops write a step runs goes
 * to the fake platform method that test names, and a
 * lost answer is the client's own uncertain failure, as `runToEnd` makes it.
 */
type FakeWrite = (...args: ReadonlyArray<never>) => unknown;
function fakeRun(
  writes: Readonly<Record<string, FakeWrite | undefined>>,
  readIsolation?: () => Promise<string | undefined>,
): RunToEnd {
  const call = async (name: string, ...args: ReadonlyArray<unknown>) => {
    const write = writes[name];
    if (write === undefined) throw new Error(`No ${name} in this press.`);
    return (write as (...a: ReadonlyArray<unknown>) => unknown)(...args);
  };
  const closed = async () => {
    const isolation = await readIsolation?.();
    return isolation?.trim().split(/\s+/u)[0] === "service";
  };
  return (async (intent: Parameters<RunToEnd>[0]) => {
    switch (intent.kind) {
      case "import-container":
        return call("importDevelopmentContainer", intent);
      case "import-services":
        return call("importServices", intent.projectId, intent.yaml);
      case "harden-project": {
        if (intent.confirm === true) {
          if (await closed()) return { keyNotLowered: null };
          await call("closeOff", intent.projectId);
          if (!(await closed())) throw new Error("The project does not read as closed off yet.");
          return { keyNotLowered: null };
        }
        const hardened = (await call("isolateProjectEnv", intent.projectId, intent.keyTokenId)) as {
          readonly keyNotLowered: string | null;
        };
        return { keyNotLowered: hardened.keyNotLowered };
      }
      // HQ's writes go to the HQ this file stands in (`accountHq` below).
      case "attach-project":
        return hqApi().attachProject(intent.appId, intent.attach);
      case "create-mate-record":
        return hqApi().createMate(intent.mate);
      case "mark-closed-off":
        return hqApi().recordClosedOff(intent.projectId);
      case "bind-birth":
        return hqApi().bindBirth(intent.birthId, intent.projectId);
      default:
        throw new Error(`No ${intent.kind} in this press.`);
    }
  }) as RunToEnd;
}

/** The HQ `accountHq` stands in for here, as the account's HQ writes reach it. */
const hqApi = () => accountHqApi({} as never, "org-acme", { projectId: "hq", address: "" });

/** A press's operations over a fake run; HQ's navigation records no environment here. */
const operationsOf = (run: RunToEnd): PressInputs["operations"] => ({
  run,
  untilEnvironment: () => Promise.reject(new Error("No environment in this press.")),
});

/** A press's platform over fake writes, with its HQ steps as the test names them. */
function platformOf(
  fakes: Readonly<Record<string, FakeWrite | undefined>> & {
    readonly readIsolation?: () => Promise<string | undefined>;
  },
): EnvironmentCreationPlatform {
  return {
    run: fakeRun(fakes, fakes.readIsolation),
    markClosedOff: (fakes.markClosedOff ?? (async () => undefined)) as never,
    register: (fakes.register ?? (async () => undefined)) as never,
    untilServicesSettled: async () => [],
  };
}

type OperationIntent = Parameters<RunToEnd>[0];

/** One operation's owner answer, with the other steps using the account's fake executor. */
function withOperation<K extends OperationIntent["kind"]>(
  inputs: PressInputs,
  kind: K,
  answer: (intent: Extract<OperationIntent, { readonly kind: K }>) => unknown,
): PressInputs {
  return {
    ...inputs,
    operations: {
      ...inputs.operations,
      run: (async (intent: OperationIntent, options: Parameters<RunToEnd>[1]) =>
        intent.kind === kind
          ? answer(intent as Extract<OperationIntent, { readonly kind: K }>)
          : inputs.operations.run(intent, options)) as RunToEnd,
    },
  };
}

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
    recheckKey: async () => {
      hq.calls?.push("recheck key");
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
    id: "p-a",
    hq: {
      appId: null,
      appName: null,
      kind: "mate" as const,
      mate: { face: "", ...(closedOff === undefined ? {} : { closedOff }) },
    },
  },
});

// A press interrupted before its close-off: the container carries the press's marker, and HQ does
// not know its project closed off (pass 28) — or HQ says it is not, and the marker is not read.
// *Finish setup* finishes it.
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
    // HQ's word that its project is not closed off is enough while the marker is not read, or
    // cannot be: the close-off gate holds it then, and Finish setup is its way out (2026-10-05).
    {
      case: "a marker the store has not read yet, HQ saying it is not closed off",
      mate: mate("zcp-a", false),
      marker: "unread" as const,
      interrupted: true,
    },
    {
      case: "a marker whose stream failed, HQ saying it is not closed off",
      mate: mate("zcp-a", false),
      marker: "unknown" as const,
      interrupted: true,
    },
    {
      case: "a marker whose stream failed, HQ saying nothing of it",
      mate: mate("zcp-a", undefined),
      marker: "unknown" as const,
      interrupted: false,
    },
    {
      case: "a marker whose stream failed, HQ holding no record",
      mate: { service: { id: "zcp-a" }, project: { id: "p-a" } },
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
      mate: { service: { id: "zcp-a" }, project: { id: "p-a" } },
      marker: true,
      interrupted: true,
    },
  ])("$case", ({ mate: candidate, marker, interrupted }) => {
    const setups = new Map([
      [
        "p-a",
        {
          marker: typeof marker === "boolean" ? marker : ("unknown" as const),
          closedOff:
            "hq" in candidate.project
              ? (candidate.project.hq.mate.closedOff ?? ("unknown" as const))
              : ("unknown" as const),
        },
      ],
    ]);
    expect(interruptedPresses([candidate], setups).has("zcp-a")).toBe(interrupted);
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
    const refused = made.progress?.find(
      (entry) => entry.step.kind === "register" && entry.state === "failed",
    );
    expect(
      drawn(
        finishSetupView(
          made,
          refused === undefined
            ? { attempt: 1, state: "done" }
            : { attempt: 1, state: "unfinished", reason: refused.error ?? "It was refused." },
        ),
      ),
    ).toEqual(want);
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
    platformOf({
      markClosedOff: async () => {
        if (marks.shift() === "refused") throw new Error("The tag was refused.");
      },
    });
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
    const owner = appAtomRegistry.get(creationPressStoreAtom)!;
    expect(
      [...owner.state().operations.values()]
        .filter((record) => record.intent.kind === "creation-press")
        .map((record) => record.receipt?.outcome.kind),
    ).toEqual(["succeeded"]);
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
// on. The account's command layer bounds every command by its own deadline, and one past it may
// have landed: it says so (`uncertain`), and no clock of the press calls it stopped first.
// B5: two browsers, one Mate. Its press holds it at HQ while it runs — however slow — and lets it
// go at its end; a second press of it, in another browser, is refused before it writes anything.
describe("a press's hold at HQ", () => {
  const api = () => {
    const calls: Array<string> = [];
    let heldBy: string | null = null;
    /** What each hold waits on before HQ answers it: nothing, unless a test holds it back. */
    let gate: () => Promise<void> = async () => {};
    return {
      calls,
      /** Holds every hold sent from now on until the returned function lets them through. */
      slow: () => {
        let open: () => void = () => {};
        const opened = new Promise<void>((resolve) => {
          open = resolve;
        });
        gate = () => opened;
        return open;
      },
      api: {
        holdPress: async (
          projectId: string,
          press: {
            readonly owner: string;
            readonly kind: string;
            readonly appId?: string;
            readonly importProcessId?: string;
            readonly renew?: boolean;
          },
        ) => {
          await gate();
          if (heldBy !== null && heldBy !== press.owner) {
            throw new HqError({
              kind: "refused",
              code: "conflict",
              reason: "press_held",
              status: 409,
              message: "held",
            });
          }
          heldBy = press.owner;
          calls.push(
            `${press.renew === true ? "renew" : "hold"} ${projectId} ${press.kind}${press.appId ? `@${press.appId}` : ""} ${press.owner}${press.importProcessId ? ` ${press.importProcessId}` : ""}`,
          );
        },
        endPress: async (projectId: string, owner: string, finished: boolean) => {
          if (heldBy === owner) heldBy = null;
          calls.push(`${finished ? "finished" : "stopped"} ${projectId} ${owner}`);
        },
      },
    };
  };

  it("is taken, renewed while its press runs, given its import, and let go at its end", async () => {
    vi.useFakeTimers();
    try {
      const hq = api();
      const hold = pressHold(hq.api, { kind: "mate", appId: "app-1" }, "press-a");
      expect(await hold.take("p-1")).toBe("held");
      await vi.advanceTimersByTimeAsync(PRESS_RENEW_MS);
      await hold.imported("imp-1");
      // A step that moves renews it, whatever its timer is let do in a hidden tab — not twice
      // within its least gap.
      hold.renew();
      await vi.advanceTimersByTimeAsync(PRESS_STEP_RENEW_MS);
      hold.renew();
      hold.renew();
      await vi.advanceTimersByTimeAsync(PRESS_RENEW_MS - PRESS_STEP_RENEW_MS);
      await hold.end(true);
      await vi.advanceTimersByTimeAsync(PRESS_RENEW_MS * 3);
      expect(hq.calls).toEqual([
        "hold p-1 mate@app-1 press-a",
        "renew p-1 mate@app-1 press-a",
        "renew p-1 mate@app-1 press-a imp-1",
        "renew p-1 mate@app-1 press-a imp-1",
        "renew p-1 mate@app-1 press-a imp-1",
        "finished p-1 press-a",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A renewal in flight when its press ends must not land after the end: it would hold the
  // project five more minutes, or bring back the record a finished press let go.
  it("ends only after a renewal in flight has landed, and renews nothing after its end", async () => {
    vi.useFakeTimers();
    try {
      const hq = api();
      const hold = pressHold(hq.api, { kind: "mate" }, "press-a");
      await hold.take("p-1");
      await vi.advanceTimersByTimeAsync(PRESS_STEP_RENEW_MS);
      const open = hq.slow();
      hold.renew();
      // On its way to HQ, unanswered, as the press ends.
      await vi.advanceTimersByTimeAsync(0);
      const ended = hold.end(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(hq.calls).toEqual(["hold p-1 mate press-a"]);
      open();
      await ended;
      hold.renew();
      await hold.imported("imp-1");
      await vi.advanceTimersByTimeAsync(PRESS_RENEW_MS * 3);
      expect(hq.calls).toEqual([
        "hold p-1 mate press-a",
        "renew p-1 mate press-a",
        "stopped p-1 press-a",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes its hold again, not as a renewal, where HQ never answered the first", async () => {
    vi.useFakeTimers();
    try {
      const sent: Array<boolean> = [];
      let answered = false;
      const hold = pressHold(
        {
          holdPress: async (_projectId, press) => {
            sent.push(press.renew === true);
            if (!answered) {
              answered = true;
              throw new Error("HQ did not answer");
            }
          },
          endPress: async () => {},
        },
        { kind: "mate" },
        "press-a",
      );
      expect(await hold.take("p-1")).toBe("held");
      await vi.advanceTimersByTimeAsync(PRESS_RENEW_MS * 2);
      expect(sent).toEqual([false, false, true]);
      await hold.end(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes on unheld where HQ refuses this person's hold, never asking it again", async () => {
    vi.useFakeTimers();
    try {
      const asked: Array<string> = [];
      const hold = pressHold(
        {
          holdPress: async () => {
            asked.push("hold");
            throw new HqError({
              kind: "refused",
              code: "forbidden",
              reason: "not_project_reader",
              status: 403,
              message: "refused",
            });
          },
          endPress: async () => {
            asked.push("end");
          },
        },
        { kind: "mate" },
        "press-a",
      );
      expect(await hold.take("p-1")).toBe("held");
      await vi.advanceTimersByTimeAsync(PRESS_RENEW_MS * 3);
      await hold.end(false);
      expect(asked).toEqual(["hold"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a press of a Mate another browser's press holds, before it writes anything", async () => {
    const hq = api();
    await pressHold(hq.api, { kind: "mate" }, "press-a").take("p-1");
    const written: Array<string> = [];
    const platform = platformOf({
      importDevelopmentContainer: async () => {
        written.push("import");
        return { serviceName: "zcp", imported: true };
      },
    });
    try {
      const outcome = await runPress({
        organizationId: "org-acme",
        steps: [{ kind: "import-container", agents: [] }],
        platform,
        isCurrent: () => true,
        resume: { from: 0, projectId: "p-1", projectName: "Acme - Una" },
        locks: undefined,
        hold: pressHold(hq.api, { kind: "mate" }, "press-b"),
      });
      expect(outcome).toMatchObject({ ok: false, error: PRESSED_IN_ANOTHER_BROWSER });
      expect(written).toEqual([]);
    } finally {
      forgetPress("p-1");
    }
  });

  it("names the container import's process to its hold once Zerops answered it", async () => {
    const hq = api();
    const hold = pressHold(hq.api, { kind: "mate" }, "press-a");
    await hold.take("p-1");
    await runPress({
      organizationId: "org-acme",
      steps: [{ kind: "import-container", agents: [] }],
      platform: platformOf({
        importDevelopmentContainer: async () => ({
          serviceName: "zcp",
          imported: true,
          processId: "imp-9",
        }),
      }),
      isCurrent: () => true,
      resume: { from: 0, projectId: "p-1", projectName: "Acme - Una" },
      locks: undefined,
      heldLock: true,
      hold,
    });
    expect(hq.calls).toContain("renew p-1 mate press-a imp-9");
    forgetPress("p-1");
  });

  // B5: a stage's press imports first and registers last; cut short between them, its record stays
  // with its hold ended, for its setup to be finished as a stage of its application.
  it("ends a stage's press that stopped, keeping its record; one that went through leaves none", async () => {
    const hq = api();
    const platform = platformOf({
      importServices: async () => undefined,
      register: async () => {
        throw new Error("HQ could not be reached.");
      },
    });
    const stopped = await runPress({
      organizationId: "org-acme",
      steps: [{ kind: "import-recipe", role: "stage", yaml: "services: []" }, { kind: "register" }],
      platform,
      isCurrent: () => true,
      resume: { from: 0, projectId: "p-stage", projectName: "Acme - stage" },
      locks: undefined,
      hold: pressHold(hq.api, { kind: "stage", appId: "app-1" }, "press-s"),
    });
    await Promise.resolve();
    expect(stopped.ok).toBe(false);
    expect(hq.calls).toEqual(["hold p-stage stage@app-1 press-s", "stopped p-stage press-s"]);
    forgetPress("p-stage");
  });
});

describe("a press whose write's answer was lost", () => {
  it("says the write may have landed and withholds retry without owner evidence", async () => {
    beginPress({
      projectId: "p-1",
      organizationId: "org-acme",
      startedAt: 0,
      placement: null,
      container: true,
    });
    try {
      const outcome = await runPress({
        organizationId: "org-acme",
        steps: [{ kind: "import-container", agents: [] }, { kind: "close-off" }],
        platform: platformOf({
          importDevelopmentContainer: async () => {
            throw new ZeropsApiError("Zerops command exceeded its deadline.", "uncertain");
          },
        }),
        isCurrent: () => true,
        resume: { from: 0, projectId: "p-1", projectName: "Acme - Dan" },
        locks: undefined,
      });
      expect(outcome).toMatchObject({
        ok: false,
        failedStep: { kind: "import-container" },
        uncertain: true,
      });
      const state = readMatePress("p-1")?.state;
      expect(state).toMatchObject({
        kind: "failed",
        step: "import-container",
        reason: `Zerops command exceeded its deadline. ${PRESS_MAY_HAVE_LANDED}`,
      });
      expect(state?.kind === "failed" ? state.retry : null).toBeNull();
    } finally {
      forgetPress("p-1");
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
// its container (76a0c48f8): nothing tries it again on its own. On a Mate with its container its
// row says it stopped, then is the Mate's again (restores 6027014ee and 3d194e2e7); one bringing
// its container stands, for its own view's Try again.
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
      case: "on a Mate with its container: said, then gone, its plan kept",
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
      const resume: MatePress["resumeSetup"] = async () => ({ ok: true }) as never;
      recordPressOutcome("p-stop", stopped, resume);
      const press = readMatePress("p-stop");
      expect(finishSetupRowLine(press)).toBe("Setup stopped");
      expect(pressComingInput([press!], "p-stop")).toEqual({
        press: { startedAt: 0, container: stands, retryable: false },
        setUpFailed: stands ? "Zerops refused the change" : undefined,
      });
      vi.advanceTimersByTime(STOPPED_SHOWN_MS);
      const later = readMatePress("p-stop");
      expect(later?.state).toEqual(stopped);
      expect(later?.resumeSetup).toBe(resume);
      expect(finishSetupRowLine(later)).toBe(stands ? "Setup stopped" : undefined);
      expect(pressComingInput([later!], "p-stop").setUpFailed).toBe(
        stands ? "Zerops refused the change" : undefined,
      );
    } finally {
      forgetPress("p-stop");
      vi.useRealTimers();
    }
  });

  it("a Finish setup pressed again within its words is said anew, never cut short", () => {
    vi.useFakeTimers();
    try {
      begin(false);
      recordPressOutcome("p-stop", STOPPED);
      vi.advanceTimersByTime(STOPPED_SHOWN_MS - 1_000);
      begin(false);
      recordPressOutcome("p-stop", STOPPED);
      vi.advanceTimersByTime(1_000);
      expect(finishSetupRowLine(readMatePress("p-stop"))).toBe("Setup stopped");
      vi.advanceTimersByTime(STOPPED_SHOWN_MS);
      expect(finishSetupRowLine(readMatePress("p-stop"))).toBeUndefined();
    } finally {
      forgetPress("p-stop");
      vi.useRealTimers();
    }
  });

  it("is running only between its press and its end", () => {
    try {
      begin(false);
      expect(finishSetupRunning(readMatePress("p-stop"))).toBe(true);
      recordPressOutcome("p-stop", STOPPED);
      expect(finishSetupRunning(readMatePress("p-stop"))).toBe(false);
    } finally {
      forgetPress("p-stop");
    }
    expect(finishSetupRunning(undefined)).toBe(false);
  });
});

describe("closeOffOpenOf — a Mate the close-off gate holds, as its row and page say it", () => {
  const holds = new Map([
    ["p-open", "open"],
    ["p-unsure", "checking"],
  ] as const);
  const press = (state: MatePressState): MatePress => ({
    projectId: "p-open",
    organizationId: "org-acme",
    startedAt: 0,
    placement: null,
    container: false,
    finishing: true,
    state,
  });
  it.each([
    { case: "known not closed off", projectId: "p-open", press: undefined, want: true },
    {
      case: "held quietly while nothing is known",
      projectId: "p-unsure",
      press: undefined,
      want: false,
    },
    { case: "not held", projectId: "p-other", press: undefined, want: false },
    {
      case: "its Finish setup running here says that instead",
      projectId: "p-open",
      press: press({ kind: "pressing" }),
      want: false,
    },
    {
      case: "its Finish setup stopped here: held again, said",
      projectId: "p-open",
      press: press({ kind: "failed", step: "close-off", reason: "No.", retry: null }),
      want: true,
    },
  ])("$case: $want", ({ projectId, press, want }) => {
    expect(closeOffOpenOf(holds, projectId, press)).toBe(want);
  });
});

// Security review 4: where HQ says nothing, only this browser's own knowledge that a project's
// close-off has not happened holds its Mate — a press here that runs or stopped before it.
describe("closeOffPendingOf — the projects this browser knows are not closed off yet", () => {
  const CLOSE_OFF: EnvironmentCreationStep = { kind: "close-off" };
  const IMPORT: EnvironmentCreationStep = { kind: "import-container", agents: [] };
  const press = (
    projectId: string,
    state: MatePressState,
    progress: ReadonlyArray<EnvironmentCreationStepProgress> | undefined,
    container = true,
  ): MatePress => ({
    projectId,
    organizationId: "org-acme",
    startedAt: 0,
    placement: null,
    container,
    state,
    ...(progress === undefined ? {} : { progress }),
  });
  const STOPPED: MatePressState = { kind: "failed", step: "close-off", reason: "No.", retry: null };
  it.each([
    {
      case: "stopped before its close-off",
      press: press("p", STOPPED, [
        { step: IMPORT, state: "done" },
        { step: CLOSE_OFF, state: "failed" },
      ]),
      want: ["p"],
    },
    {
      case: "running, its close-off ahead",
      press: press("p", { kind: "pressing" }, [
        { step: IMPORT, state: "running" },
        { step: CLOSE_OFF, state: "queued" },
      ]),
      want: ["p"],
    },
    {
      case: "bringing a container, its steps not said yet",
      press: press("p", { kind: "pressing" }, undefined),
      want: ["p"],
    },
    {
      case: "closed off, then stopped after",
      press: press("p", STOPPED, [{ step: CLOSE_OFF, state: "done" }]),
      want: [],
    },
    {
      case: "through",
      press: press("p", { kind: "pressed" }, [{ step: CLOSE_OFF, state: "done" }]),
      want: [],
    },
    {
      case: "a stage's press, which closes nothing off",
      press: press("p", { kind: "pressing" }, undefined, false),
      want: [],
    },
  ])("$case", ({ press, want }) => {
    expect([...closeOffPendingOf([press])]).toEqual(want);
  });
});

describe("closeOffHoldOf — a hold, as the Mate's own view says it", () => {
  const holds = new Map([
    ["p-open", "open"],
    ["p-checking", "checking"],
    ["p-hq", "awaiting-hq"],
  ] as const);
  it.each([
    { projectId: "p-open", want: "open" },
    { projectId: "p-checking", want: "checking" },
    { projectId: "p-hq", want: "awaiting-hq" },
    { projectId: "p-none", want: undefined },
  ])("$projectId: $want", ({ projectId, want }) => {
    expect(closeOffHoldOf(holds, projectId, undefined)).toBe(want);
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
    {
      case: "stopped on a Mate that is up: its sign-in line, dot and last message are its own",
      press: press(failed, true),
      up: true,
      line: undefined,
    },
    {
      case: "finishing on a Mate that is up: still said",
      press: press({ kind: "pressing" }, true),
      up: true,
      line: "Finishing setup…",
    },
  ])("$case", ({ press, up, line }) => {
    expect(finishSetupRowLine(press, { up: up === true })).toBe(line);
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
  ): PressInputs => {
    servicesReading({
      services: services.map((service) => ({ ...service, projectId: "p-old" })),
      live: true,
      reconnecting: false,
    });
    const client = {
      readProjectEnv: async () => {
        calls.push("read isolation");
        return [{ key: "envIsolation", content: "service" }];
      },
    };
    const isolateProjectEnv = () => {
      calls.push("harden");
      return harden()
        ? Promise.resolve({ keyNotLowered: null })
        : Promise.reject(new Error("The isolation was refused."));
    };
    return {
      client: client as unknown as PressInputs["client"],
      organizationId: "org-acme",
      operations: operationsOf(
        fakeRun(
          { isolateProjectEnv, closeOff: isolateProjectEnv },
          async () =>
            (await client.readProjectEnv()).find((entry) => entry.key === "envIsolation")?.content,
        ),
      ),
    };
  };
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
    const base = inputs(() => true, calls);
    const withContainer = withOperation(base, "import-container", () => {
      calls.push("container");
      return answered({ value: { serviceName: "zcp", imported: true } });
    });
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: withContainer,
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
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual(["attach app-d", "container", "read isolation", "mark"]);
    forgetPress("p-old");
  });

  // The 09-05 offer, end to end: Set up Mate on an existing plain project HQ holds nothing of
  // writes the new Mate's record in no application, then its container, and closes it off at HQ —
  // which the record lets HQ mark, so the close-off gate lets it in.
  it("brings a Mate into an existing plain project: its record, its container, its close-off", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls);
    const withContainer = withOperation(base, "import-container", () => {
      calls.push("container");
      return answered({ value: { serviceName: "zcp", imported: true } });
    });
    const endpoint = { projectId: "hq-project", address: "https://hq.test" };
    const registration = mateFinishRegistration({
      hq: endpoint,
      hqKnown: true,
      structure: { ungrouped: [], apps: [] } as never,
      project: { id: "p-old", name: "shop", status: "ACTIVE", tagList: [] },
      press: readMatePress("p-old"),

      mayCreateRecord: true,
      standUp: false,
      candidates: [],
    });
    expect(registration).toMatchObject({ kind: "mate-record", standUp: false });
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: withContainer,
        projectId: "p-old",
        projectName: "shop",
        container: { agents: [] },
        registration,
        hq: endpoint,
        isCurrent: () => true,
        locks: undefined,
      }),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual([
      expect.stringMatching(/^record \S+:\S+$/u),
      "container",
      "read isolation",
      "mark",
    ]);
    forgetPress("p-old");
  });

  // The stopped registration retains the application in its birth intent (F6c), so another
  // browser's Finish setup can attach it there and continue the unattempted steps.
  it("a stopped registration retains its birth intent for another browser's Finish setup", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls);
    const withContainer = withOperation(base, "import-container", () => {
      calls.push("container");
      return answered({ value: { serviceName: "zcp", imported: true } });
    });
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
      inputs: withContainer,
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
    });
    expect(pressed).toMatchObject({ ok: false, failedStep: { kind: "register" } });
    expect(calls).toEqual(["attach failed"]);
    forgetPress("gus-project");

    // Another browser, with no press of its own, where no press holds Gus at HQ any more: HQ holds
    // no record of Gus, and still holds the birth intent no attach closed.
    hq.attachFailure = null;
    calls.length = 0;
    expect(
      finishMateSetupVerb({
        registration: "registered",
        containerMissing: false,
        closedOffMissing: false,
        pressStopped: false,
        pressedElsewhere: false,
        viewerIsAdder: false,
        hasContainer: true,
        containerKnown: true,
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
        inputs: withContainer,
        projectId: "gus-project",
        projectName: "mate-rig-e2e-g - Gus",
        container: { agents: [] },
        registration,
        hq: HQ_ENDPOINT,
        isCurrent: () => true,
        harden: true,
        locks: undefined,
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
    const base = inputs(() => true, calls);
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
        inputs: { ...base, client: client as unknown as PressInputs["client"] },
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
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
    const base = inputs(() => true, calls);
    const refusedKey = withOperation(base, "harden-project", () =>
      answered({
        value: {
          tokenLowered: false,
          keyNotLowered: "This Zerops account is not allowed to do that.",
          delegationsDropped: 0,
          isolationSteps: 1,
          restarted: false,
        },
      }),
    );
    hq.calls = calls;
    expect(
      await finishMateSetup({
        inputs: refusedKey,
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
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

  // Security review 8: a stopped press this tab keeps resumes where it stopped, and its Finish
  // setup still hardens first — the kept plan never skips the key's lowering.
  it("hardens before it resumes a stopped press this tab keeps", async () => {
    begin();
    const calls: Array<string> = [];
    recordPressOutcome(
      "p-old",
      { kind: "failed", step: "close-off", reason: "No.", retry: null },
      async () => {
        calls.push("resume");
        return { ok: true, projectId: "p-old" } as never;
      },
    );
    expect(await finish(() => true, calls)).toMatchObject({ ok: true });
    expect(calls).toEqual(["harden", "resume"]);
    forgetPress("p-old");
  });

  // Key by id (audit K3): an adopted Mate's key is hardened by the id the Mate named to HQ, where
  // it named one; matched on the token list only where it did not.
  it("hardens an adopted Mate's key by the id HQ names", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls);
    const asked: Array<string | undefined> = [];
    const byId = withOperation(base, "harden-project", ({ keyTokenId }) => {
      asked.push(keyTokenId);
      return answered({
        value: {
          tokenLowered: true,
          keyNotLowered: null,
          delegationsDropped: 0,
          isolationSteps: 1,
          restarted: false,
        },
      });
    });
    hq.calls = calls;
    const finishOld = () =>
      finishMateSetup({
        inputs: byId,
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        locks: undefined,
      });
    hq.key = "token-7";
    expect(await finishOld()).toMatchObject({ ok: true });
    hq.key = null;
    expect(await finishOld()).toMatchObject({ ok: true });
    expect(asked).toEqual(["token-7", undefined]);
    forgetPress("p-old");
  });

  // ADR 0003's fallout: a Mate HQ holds whose key reads other projects is hardened by its Finish
  // setup by the id HQ names — the widened key its container holds, never taken for the Mate's own
  // — and then asks HQ to read the key again.
  it("hardens a Mate whose key reads other projects, then asks HQ to read its key again", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls);
    const asked: Array<string | undefined> = [];
    const matched = withOperation(base, "harden-project", ({ keyTokenId }) => {
      asked.push(keyTokenId);
      calls.push("harden");
      return answered({
        value: {
          tokenLowered: true,
          keyNotLowered: null,
          delegationsDropped: 0,
          isolationSteps: 1,
          restarted: false,
        },
      });
    });
    hq.calls = calls;
    hq.key = "token-wide";
    expect(
      await finishMateSetup({
        inputs: matched,
        projectId: "p-old",
        projectName: "Acme - Ada",
        container: null,
        registration: null,
        hq: { projectId: "hq-project", address: "https://hq.test" },
        isCurrent: () => true,
        harden: true,
        keyWider: true,
        locks: undefined,
      }),
    ).toMatchObject({ ok: true });
    hq.key = null;
    expect(asked).toEqual(["token-wide"]);
    expect(calls).toEqual(["harden", "recheck key", "mark"]);
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
    servicesReading({
      services: services.map((service) => ({ ...service, projectId: "p-old" })),
      live: true,
      reconnecting: false,
    });
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
    const platform = platformOf({
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
    });
    expect(
      await runPress({
        organizationId: "org-acme",
        steps,
        platform,
        isCurrent: () => true,
        resume: { from: 0, projectId: "p-old", projectName: "Acme - Ada" },
        locks: undefined,
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
      }),
    ).toMatchObject({ ok: true, serviceName: "zcp" });
    // Its harden runs first: a kept plan never skips the key's lowering (security review 8).
    expect(calls).toEqual(["register", "container", "failed mark", "harden", "mark"]);
    forgetPress("p-old");
  });

  it("withholds service selection while unread and resumes manually after the source answers", async () => {
    begin();
    const calls: Array<string> = [];
    const base = inputs(() => true, calls);
    servicesReading({ services: undefined, live: false, reconnecting: false });
    const finishing = {
      inputs: base,
      projectId: "p-old",
      projectName: "Acme - Ada",
      container: null,
      registration: null,
      hq: null,
      isCurrent: () => true,
      locks: undefined,
    };
    expect(await finishMateSetup(finishing)).toMatchObject({
      ok: false,
      error:
        "The project's current services are unavailable. Try Finish setup after they are read.",
    });
    expect(calls).toEqual([]);
    const stopped = readMatePress("p-old")?.state;
    if (stopped?.kind !== "failed" || stopped.retry === null)
      throw new Error("no manual continuation");
    servicesReading({ services: [], live: true, reconnecting: false });
    await stopped.retry();
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
      name: "HQ holds it in its application: preserve its record and finish only remaining setup",
      input: { ...BASE, project: held("app-d") },
      expected: null,
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
