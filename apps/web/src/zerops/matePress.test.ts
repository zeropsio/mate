import {
  PRESS_STEP_ATTEMPTS,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  beginPress,
  finishSetupView,
  forgetPress,
  interruptedPresses,
  planShareReach,
  progressPress,
  shareGroupReach,
  PRESSED_ELSEWHERE,
  connectedPresses,
  pressDoneAt,
  readMatePress,
  runPress,
  withPressTries,
  type MatePress,
  type MatePressState,
} from "./matePress";
import type { LockManagerLike } from "./mateLocks";

const mate = (serviceId: string | undefined, tags: ReadonlyArray<string>) => ({
  ...(serviceId === undefined ? {} : { service: { id: serviceId } }),
  project: { tagList: tags },
});

// A press interrupted before its close-off: the container carries the press's marker, its
// project no `mate:closed-off` (pass 28). *Finish setup* finishes it.
describe("interruptedPresses", () => {
  it.each([
    {
      case: "a marked container whose project was never marked closed off",
      mate: mate("zcp-a", ["mate"]),
      marker: true,
      interrupted: true,
    },
    {
      case: "a press that got as far as its close-off",
      mate: mate("zcp-a", ["mate", "mate:closed-off"]),
      marker: true,
      interrupted: false,
    },
    {
      case: "a Mate made before the press: no marker",
      mate: mate("zcp-a", ["mate"]),
      marker: false,
      interrupted: false,
    },
    {
      case: "a marker the store has not read yet",
      mate: mate("zcp-a", ["mate"]),
      marker: "unread" as const,
      interrupted: false,
    },
    {
      case: "a marker whose stream failed",
      mate: mate("zcp-a", ["mate"]),
      marker: "unknown" as const,
      interrupted: false,
    },
    {
      case: "a Mate with no container listed",
      mate: mate(undefined, ["mate"]),
      marker: true,
      interrupted: false,
    },
  ])("$case", ({ mate: candidate, marker, interrupted }) => {
    const markers = new Map([["zcp-a", marker]]);
    expect(interruptedPresses([candidate], markers).has("zcp-a")).toBe(interrupted);
  });
});

// The group's other Mates given sight of the new project in the press itself, where the person may
// edit their keys: an org owner, or the keys' creator (live, 2026-10-01: Otto's siblings gained no
// READ_ONLY until some owner's browser reconciled).
describe("planShareReach", () => {
  const key = (id: string, projectId: string, createdByUser: string) => ({
    id,
    name: `zcp-${projectId}`,
    roleCode: "NO_ACCESS",
    createdByUser,
    projects: [
      { projectId, roleCode: "BASIC_USER" as const },
      { projectId: "stage", roleCode: "READ_ONLY" as const },
    ],
  });
  const TOKENS = [key("k-uma", "uma", "u-ada"), key("k-fen", "fen", "u-eva")];
  const plan = (viewer: { readonly userId: string; readonly roleCode: string }) =>
    planShareReach({
      tokens: TOKENS,
      siblingProjectIds: ["uma", "fen"],
      projectId: "new",
      viewer,
    }).map((write) => [write.tokenId, write.projects.map((grant) => grant.projectId)]);

  it("extends every sibling's key for an org owner", () => {
    expect(plan({ userId: "u-zoe", roleCode: "OWNER" })).toEqual([
      ["k-uma", ["uma", "new", "stage"]],
      ["k-fen", ["fen", "new", "stage"]],
    ]);
  });

  it("extends only the keys this person created, for anyone else", () => {
    expect(plan({ userId: "u-ada", roleCode: "ADMIN" })).toEqual([
      ["k-uma", ["uma", "new", "stage"]],
    ]);
  });

  it("writes nothing to a key that reads the project already", () => {
    expect(
      planShareReach({
        tokens: [
          {
            ...TOKENS[0]!,
            projects: [...TOKENS[0]!.projects, { projectId: "new", roleCode: "READ_ONLY" }],
          },
        ],
        siblingProjectIds: ["uma"],
        projectId: "new",
        viewer: { userId: "u-zoe", roleCode: "OWNER" },
      }),
    ).toEqual([]);
  });
});

// Every sibling the key mint counts, whatever the services listing holds yet, each key read fresh
// right before its write (live, 2026-10-01: a press ten seconds after load reached three of nine
// siblings, picked by the zcp services the listing held).
describe("shareGroupReach", () => {
  const key = (id: string, projectId: string) => ({
    id,
    name: `zcp-${projectId}`,
    roleCode: "NO_ACCESS",
    createdByUser: "u-ada",
    projects: [{ projectId, roleCode: "BASIC_USER" as const }],
  });
  const fakeClient = (failing: ReadonlySet<string> = new Set()) => {
    const tokens = new Map(
      [key("k-uma", "uma"), key("k-fen", "fen"), key("k-ivo", "ivo")].map((token) => [
        token.id,
        token,
      ]),
    );
    const calls: Array<string> = [];
    return {
      calls,
      tokens,
      client: {
        listIntegrationTokens: async () => {
          calls.push("list");
          return [...tokens.values()];
        },
        setIntegrationTokenProjects: async (input: {
          readonly tokenId: string;
          readonly projects: ReadonlyArray<{
            readonly projectId: string;
            readonly roleCode: string;
          }>;
        }) => {
          calls.push(`put ${input.tokenId}`);
          if (failing.has(input.tokenId)) throw new Error("refused");
          const token = tokens.get(input.tokenId)!;
          tokens.set(input.tokenId, { ...token, projects: input.projects as never });
        },
      },
    };
  };
  const share = (client: ReturnType<typeof fakeClient>["client"], locks?: LockManagerLike) =>
    shareGroupReach({
      client,
      locks,
      organizationId: "org-acme",
      // A stage environment with no key among them, and the new project itself.
      groupProjectIds: ["uma", "stage", "fen", "ivo", "new"],
      projectId: "new",
      viewer: { userId: "u-zoe", roleCode: "OWNER" },
    });

  it("extends every sibling Mate's key, each read fresh under its lock right before its write", async () => {
    const fake = fakeClient();
    const held: Array<string> = [];
    const locks: LockManagerLike = {
      request: async (name, _options, hold) => {
        held.push(name);
        fake.calls.push(`lock ${name}`);
        return hold({ name });
      },
    };
    expect(await share(fake.client, locks)).toEqual({ extended: 3, failed: 0 });
    expect(fake.calls).toEqual([
      "list",
      "lock mate:token:k-uma",
      "list",
      "put k-uma",
      "list",
      "list",
      "lock mate:token:k-fen",
      "list",
      "put k-fen",
      "list",
      "lock mate:token:k-ivo",
      "list",
      "put k-ivo",
    ]);
    // The store's token writes take the same names: the two never write one key at once.
    expect(held).toEqual(["mate:token:k-uma", "mate:token:k-fen", "mate:token:k-ivo"]);
    expect(
      [...fake.tokens.values()].map((token) => token.projects.map((grant) => grant.projectId)),
    ).toEqual([
      ["uma", "new"],
      ["fen", "new"],
      ["ivo", "new"],
    ]);
  });

  it("goes on past a key it could not write, and counts it", async () => {
    const fake = fakeClient(new Set(["k-fen"]));
    expect(await share(fake.client)).toEqual({ extended: 2, failed: 1 });
  });
});

// Finish setup drawn as the Add dialog draws a press, then a clear end (live, 2026-10-01: Hugo's
// view went "could not be added", "isn't running", "coming up", and never said it was done).
describe("finishSetupView — Finish setup on a Mate's own view", () => {
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "import-container", agents: [] },
    { kind: "close-off" },
    { kind: "register" },
    { kind: "share-reach" },
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
      made: press(
        { kind: "pressing" },
        { progress: progress(["running", "queued", "queued", "queued"]) },
      ),
      want: {
        done: false,
        line: "Finishing its setup…",
        steps: ["Container:active", "Closed off:waiting", "Registered:waiting"],
      },
    },
    {
      case: "closed off, being registered",
      made: press(
        { kind: "pressing" },
        { progress: progress(["done", "done", "running", "queued"]) },
      ),
      want: {
        done: false,
        line: "Finishing its setup…",
        steps: ["Container:done", "Closed off:done", "Registered:active"],
      },
    },
    {
      case: "through",
      made: press({ kind: "pressed" }, { progress: progress(["done", "done", "done", "done"]) }),
      want: {
        done: true,
        line: "Its setup is finished. It comes up on its own now, with no browser needed.",
        steps: ["Container:done", "Closed off:done", "Registered:done"],
      },
    },
    {
      case: "through, its registration refused",
      made: press({ kind: "pressed" }, { progress: progress(["done", "done", "failed", "done"]) }),
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
    progressPress("p-hugo", progress(["done", "running", "queued", "queued"]));
    expect(drawn(finishSetupView(readMatePress("p-hugo")!))?.steps).toEqual([
      "Container:done",
      "Closed off:active",
      "Registered:waiting",
    ]);
    forgetPress("p-hugo");
    // A press nobody holds keeps nothing.
    progressPress("p-hugo", progress(["done", "done", "done", "done"]));
    expect(readMatePress("p-hugo")).toBeUndefined();
  });
});

describe("runPress — a press settled, tried again, and one at a time", () => {
  const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "close-off", isolated: true },
    { kind: "share-reach" },
  ];
  const platform = (marks: Array<"ok" | "refused">): EnvironmentCreationPlatform =>
    ({
      markClosedOff: async () => {
        if (marks.shift() === "refused") throw new Error("The tag was refused.");
      },
      shareReach: async () => undefined,
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
    {
      case: "an Add before its mark",
      finishing: false,
      states: ["done", "running", "queued"],
      want: false,
    },
    {
      case: "an Add at its mark",
      finishing: false,
      states: ["done", "done", "running"],
      want: true,
    },
    {
      case: "Finish setup at its mark: its view says when it is done",
      finishing: true,
      states: ["done", "done", "running"],
      want: false,
    },
  ] as const)("$case: $want", ({ finishing, states, want }) => {
    expect(pressDoneAt({ finishing }, at(states))).toBe(want);
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
});
