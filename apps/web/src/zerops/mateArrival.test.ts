import { deriveBirthProgress, type BirthFacts } from "@t3tools/client-runtime/zerops/birthProgress";
import { describe, expect, it } from "vite-plus/test";

import { signInPhrase } from "~/components/zerops/ZeropsAgentSignIn.logic";

import {
  arrivalFace,
  arrivalHeaderFace,
  arrivalHeadline,
  arrivalSentence,
  arrivalSteps,
  comingSentence,
  inFirstSeenOrder,
  nextRuntimesLine,
  pressNote,
  pressRuns,
  runtimesComing,
  type ArrivalKind,
  type ArrivalSubstep,
} from "./mateArrival";

const WREN = { name: "Wren", project: "Beviro" };
const NOW = Date.parse("2026-09-30T10:02:00.000Z");
const AGO = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

/** 72 s in: its project made in 25 s, its container being created for 44 s. */
const CREATING: BirthFacts = {
  project: { status: "ACTIVE", createdAt: AGO(72) },
  container: { serviceId: "zcp", status: "CREATING", hasOrigin: false },
  processes: [
    {
      actionName: "project.create",
      status: "FINISHED",
      createdAt: AGO(72),
      startedAt: AGO(72),
      finishedAt: AGO(47),
      serviceIds: [],
    },
    {
      actionName: "stack.create",
      status: "RUNNING",
      createdAt: AGO(44),
      startedAt: AGO(44),
      finishedAt: null,
      serviceIds: ["zcp"],
    },
  ],
  health: undefined,
  connection: "none",
};

describe("terminal setup process facts", () => {
  it("shows the failed workspace's source duration, unchanged an hour later", () => {
    const facts: BirthFacts = {
      ...CREATING,
      processes: CREATING.processes.map((process) =>
        process.actionName === "stack.create"
          ? {
              ...process,
              status: "FAILED",
              finishedAt: AGO(10),
              failReason: "CommandExec: init command failed",
            }
          : process,
      ),
    };
    const progress = deriveBirthProgress(facts, NOW);
    const workspace = (now: number) =>
      arrivalSteps(progress, WREN, now).find((step) => step.id === "workspace");
    expect(workspace(NOW)).toMatchObject({ state: "failed", time: "0:34" });
    expect(workspace(NOW + 3_600_000)).toEqual(workspace(NOW));
  });

  it("does not invent a duration for a failure with no source end", () => {
    const steps = [
      { id: "container", label: "Container", state: "failed", startedAt: AGO(44) },
    ] as const;
    expect(
      arrivalSteps({ steps }, WREN, NOW).find((step) => step.id === "workspace")?.time,
    ).toBeUndefined();
  });
});

describe("arrivalSteps — what the Mate's own setup says (`/mate/setup.json`)", () => {
  const ids = (setup: Parameters<typeof arrivalSteps>[0]["setup"]) =>
    arrivalSteps({ ...deriveBirthProgress(CREATING, NOW), setup }, WREN, NOW).map(
      (step) => `${step.id}:${step.state}`,
    );

  it("adds nothing for a Mate whose setup it has not read: an older one, or one not up yet", () => {
    expect(ids(undefined)).toEqual(["copy:done", "workspace:active", "you:you"]);
  });

  it.each([
    {
      case: "Git on its way, nobody signed in yet",
      setup: { git: "waiting", signin: "waiting", standup: "waiting" },
      want: ["git:active", "you:you", "standup:waiting"],
    },
    {
      case: "Git there, signed in, standing up",
      setup: { git: "done", signin: "done", standup: "running" },
      want: ["git:done", "you:done", "standup:active"],
    },
    {
      case: "all of it done",
      setup: { git: "done", signin: "done", standup: "done" },
      want: ["git:done", "you:done", "standup:done"],
    },
    {
      case: "a Mate with no stand-up to run: no stand-up step",
      setup: { git: "done", signin: "done", standup: "none" },
      want: ["git:done", "you:done"],
    },
    {
      case: "a stand-up that failed",
      setup: { git: "done", signin: "done", standup: "failed" },
      want: ["git:done", "you:done", "standup:failed"],
    },
  ] as const)("draws $case", ({ setup, want }) => {
    expect(ids(setup)).toEqual(["copy:done", "workspace:active", ...want]);
  });
  // Mate signs people in to Claude Code and Codex only: a Mate on Cursor, OpenCode, Grok or
  // Antigravity has nothing to sign in, and its step says what is true of it.
  it.each([
    { case: "while its setup is not read", setup: undefined },
    { case: "once its setup says it", setup: { git: "done", signin: "done" } as const },
  ])("says an agent that needs no sign-in is ready, $case", ({ setup }) => {
    const you = arrivalSteps(
      { ...deriveBirthProgress(CREATING, NOW), setup, agentReady: true },
      WREN,
      NOW,
    ).find((step) => step.id === "you");
    expect(you).toEqual({ id: "you", label: "Wren's agent is ready", state: "done" });
  });
});
// Inside a Zerops project the Mate's setup is always served: a read turned away, or answered with
// something else, is a failure the arrival says — never a Mate that has no setup to tell.
describe("arrivalSteps — a setup that can't be read", () => {
  it.each([
    {
      failure: "refused",
      why: "Its container turned the read of its setup away.",
    },
    {
      failure: "invalid",
      why: "Its container answered with something that isn't its setup.",
    },
  ] as const)("says why where its setup was $failure", ({ failure, why }) => {
    const steps = arrivalSteps(
      { ...deriveBirthProgress(CREATING, NOW), setupFailure: failure },
      WREN,
      NOW,
    );
    expect(steps.map((step) => `${step.id}:${step.state}`)).toEqual([
      "copy:done",
      "workspace:active",
      "setup:failed",
      "you:you",
    ]);
    expect(steps.find((step) => step.id === "setup")).toEqual({
      id: "setup",
      label: "Wren's setup",
      state: "failed",
      why,
    });
  });
});
// A New project's first Mate has no stand-up, so its Git access is the one place its HQ says it
// cannot come: failed, with why and what the person can do — and done once it is granted.
describe("arrivalSteps — Git access that failed", () => {
  const gitStep = (setup: Parameters<typeof arrivalSteps>[0]["setup"]) =>
    arrivalSteps({ ...deriveBirthProgress(CREATING, NOW), setup }, WREN, NOW).find(
      (step) => step.id === "git",
    );

  it.each([
    {
      case: "no official HQ: an admin sets it up",
      setup: { git: "failed", gitFailure: { reason: "no_hq" }, signin: "waiting", standup: "none" },
      why: "This organization has no HQ yet. Ask an admin to set it up.",
    },
    {
      case: "HQ refused it: its reason",
      setup: {
        git: "failed",
        gitFailure: { reason: "refused", code: "not_a_mate" },
        signin: "waiting",
        standup: "none",
      },
      why: "HQ has no record of this Mate yet. Finish its setup from its menu.",
    },
    {
      case: "failed, why not said",
      setup: { git: "failed", signin: "waiting", standup: "none" },
      why: undefined,
    },
  ] as const)("$case", ({ setup, why }) => {
    expect(gitStep(setup)).toEqual({
      id: "git",
      label: "Wren's Git access",
      state: "failed",
      ...(why === undefined ? {} : { why }),
    });
  });

  it("is done once it is granted, after it failed", () => {
    const failed = { git: "failed", gitFailure: { reason: "no_hq" } } as const;
    expect(gitStep({ ...failed, signin: "waiting", standup: "none" })?.state).toBe("failed");
    expect(gitStep({ git: "done", signin: "waiting", standup: "none" })).toEqual({
      id: "git",
      label: "Wren's Git access",
      state: "done",
    });
  });
});

// A stand-up that ended short says why, where the Mate's own server says it.
describe("arrivalSteps — a stand-up that failed", () => {
  const standUpStep = (setup: Parameters<typeof arrivalSteps>[0]["setup"]) =>
    arrivalSteps({ ...deriveBirthProgress(CREATING, NOW), setup }, WREN, NOW).find(
      (step) => step.id === "standup",
    );

  it.each([
    {
      case: "its process stopped",
      standupFailure: "process_gone",
      why: "The stand-up's process stopped.",
    },
    {
      case: "its turn ended before the previews were built",
      standupFailure: "stage_not_built",
      why: "Development is up; the previews were not built — ask the agent to build them, or deploy them by hand.",
    },
    {
      case: "its ask never went out: the retry says it",
      standupFailure: "send_failed",
      why: undefined,
    },
    { case: "why not said", standupFailure: undefined, why: undefined },
  ] as const)("$case", ({ standupFailure, why }) => {
    expect(
      standUpStep({
        git: "done",
        signin: "done",
        standup: "failed",
        ...(standupFailure === undefined ? {} : { standupFailure }),
      }),
    ).toEqual({
      id: "standup",
      label: "Wren stands up development",
      state: "failed",
      ...(why === undefined ? {} : { why }),
    });
  });
});

describe("arrivalSteps", () => {
  it("reads a Mate's six birth steps as its copy, its workspace and the person's sign-in", () => {
    const steps = arrivalSteps(deriveBirthProgress(CREATING, NOW), WREN, NOW);
    expect(steps).toEqual([
      { id: "copy", label: "Wren's copy of Beviro", state: "done", time: "0:25" },
      {
        id: "workspace",
        label: "Wren's workspace",
        state: "active",
        time: "0:44",
        note: "about 2 min",
      },
      {
        id: "you",
        label: "You sign Wren in with your Claude or ChatGPT subscription",
        phrase: signInPhrase("Wren"),
        state: "you",
      },
    ]);
  });

  it("measures nothing it has no facts for: a step waiting says no time", () => {
    const steps = arrivalSteps(
      deriveBirthProgress(
        {
          ...CREATING,
          project: undefined,
          container: undefined,
          processes: [],
        },
        NOW,
      ),
      WREN,
      NOW,
    );
    expect(steps.map(({ id, state, time }) => ({ id, state, time }))).toEqual([
      { id: "copy", state: "active", time: undefined },
      { id: "workspace", state: "waiting", time: undefined },
      { id: "you", state: "you", time: undefined },
    ]);
  });

  it("names the managed services under its copy, what the copy waits on, and nothing where none are read", () => {
    const progress = deriveBirthProgress(CREATING, NOW);
    const managed = [
      { hostname: "db", state: "done" as const },
      { hostname: "cache", state: "active" as const },
      { hostname: "storage", state: "waiting" as const },
    ];
    expect(arrivalSteps({ ...progress, managed }, WREN, NOW)[0]?.services).toEqual([
      { name: "db", state: "ok" },
      { name: "cache", state: "busy" },
      { name: "storage", state: "waiting" },
    ]);
    expect(arrivalSteps(progress, WREN, NOW)[0]).not.toHaveProperty("services");
  });

  it.each([
    { state: "done" as const, drawn: "ok" as const },
    { state: "active" as const, drawn: "busy" as const },
    { state: "waiting" as const, drawn: "waiting" as const },
    { state: "failed" as const, drawn: "failed" as const },
  ])(
    "draws a runtime the birth imports after closing off, $state, as $drawn under its workspace, never its copy",
    ({ state, drawn }) => {
      const progress = deriveBirthProgress(CREATING, NOW);
      const withRuntimes = {
        ...progress,
        runtimes: { runtimes: [{ hostname: "medusadev", state }] },
      };
      const steps = arrivalSteps(withRuntimes, WREN, NOW);
      expect(steps[0]).not.toHaveProperty("services");
      expect(steps[1]?.services).toEqual([{ name: "medusadev", state: drawn }]);
    },
  );

  it("shows no workspace duration before its process start is known", () => {
    // Measured live (Gita, 2026-09-30): 0:12, then 0:08 once the container's own start was read.
    const projectOnly: BirthFacts = {
      ...CREATING,
      container: { serviceId: "zcp", status: "READY_TO_DEPLOY", hasOrigin: false },
      processes: CREATING.processes.filter((process) => process.actionName === "project.create"),
    };
    const later = NOW + 5_000;
    const before = arrivalSteps(deriveBirthProgress(projectOnly, NOW), WREN, NOW)[1]?.time;
    const after = arrivalSteps(deriveBirthProgress(CREATING, later), WREN, later)[1]?.time;
    expect([before, after]).toEqual([undefined, "0:49"]);
  });

  it("says where its workspace stopped, in its own words", () => {
    const steps = arrivalSteps(
      deriveBirthProgress(
        {
          ...CREATING,
          container: { serviceId: "zcp", status: "ACTIVE", hasOrigin: true },
          processes: CREATING.processes.map((process) =>
            process.actionName === "stack.create"
              ? { ...process, status: "FINISHED" as const, finishedAt: AGO(10) }
              : process,
          ),
          health: "stalled",
        },
        NOW,
      ),
      WREN,
      NOW,
    );
    expect(steps[1]).toMatchObject({
      id: "workspace",
      state: "failed",
      why: "Zerops Mate never answered",
    });
  });

  it("puts a New project's own steps first and folds its first Mate's copy into its workspace", () => {
    const mate = deriveBirthProgress(CREATING, NOW);
    const steps = arrivalSteps(
      {
        steps: [
          { id: "hq", label: "HQ", state: "done" },
          { id: "registry", label: "Acme Shop", state: "done" },
          ...mate.steps,
        ],
      },
      { name: "Vera", project: "Acme Shop" },
      NOW,
    );
    expect(steps.map(({ id, label, state }) => ({ id, label, state }))).toEqual([
      { id: "hq", label: "HQ", state: "done" },
      { id: "registry", label: "Acme Shop", state: "done" },
      { id: "workspace", label: "Vera's workspace", state: "active" },
      {
        id: "you",
        label: "You sign Vera in with your Claude or ChatGPT subscription",
        state: "you",
      },
    ]);
    // Its clock starts with the project's own creation.
    expect(steps[2]?.time).toBe("1:12");
  });
});

describe("inFirstSeenOrder", () => {
  it.each([
    {
      case: "the first read, as it comes",
      seen: [],
      names: ["mailpit", "medusadev"],
      order: ["mailpit", "medusadev"],
      remembered: ["mailpit", "medusadev"],
    },
    {
      // A live add, 2026-09-30: the birth's recipe order, then the listing's own at 168 s.
      case: "a later read in another order, as first seen",
      seen: ["mailpit", "medusadev", "nextstoredev"],
      names: ["nextstoredev", "medusadev", "mailpit"],
      order: ["mailpit", "medusadev", "nextstoredev"],
      remembered: ["mailpit", "medusadev", "nextstoredev"],
    },
    {
      case: "a name new to it, after the ones it has seen",
      seen: ["db", "cache"],
      names: ["search", "cache", "db"],
      order: ["db", "cache", "search"],
      remembered: ["db", "cache", "search"],
    },
    {
      case: "a name gone for a read, keeping its place for its return",
      seen: ["db", "cache", "search"],
      names: ["search", "db"],
      order: ["db", "search"],
      remembered: ["db", "cache", "search"],
    },
  ])("orders $case", ({ seen, names, order, remembered }) => {
    expect(inFirstSeenOrder(seen, names)).toEqual({ order, seen: remembered });
  });
});

describe("runtimesComing", () => {
  const runtime = (hostname: string, status: string | undefined) => ({
    hostname,
    role: hostname.endsWith("stage") ? ("stage" as const) : ("dev" as const),
    ...(status === undefined ? {} : { service: { id: `svc-${hostname}`, status } }),
  });

  it.each([
    { case: "an import not listed yet", status: undefined, state: "waiting", coming: true },
    { case: "a service made", status: "NEW", state: "busy", coming: true },
    { case: "a service being created", status: "CREATING", state: "busy", coming: true },
    {
      case: "a dev half waiting for its build",
      status: "READY_TO_DEPLOY",
      state: "busy",
      coming: true,
    },
    { case: "a running one", status: "ACTIVE", state: "ok", coming: false },
    { case: "a failed one", status: "ACTION_FAILED", state: "failed", coming: false },
    // A Mate opened later whose app someone stopped is not coming up.
    { case: "a stopped one", status: "STOPPED", state: "waiting", coming: false },
  ] as const)("reads $case as $state, coming up: $coming", ({ status, state, coming }) => {
    expect(runtimesComing([runtime("appdev", status)])).toEqual({
      services: [{ name: "appdev", state }],
      coming,
    });
  });

  it("reads a stage half waiting for its first deploy as up", () => {
    expect(runtimesComing([runtime("appstage", "READY_TO_DEPLOY")])).toEqual({
      services: [{ name: "appstage", state: "ok" }],
      coming: false,
    });
  });

  it("is coming up while any one is, in the order given", () => {
    expect(runtimesComing([runtime("appdev", "ACTIVE"), runtime("mailpit", "CREATING")])).toEqual({
      services: [
        { name: "appdev", state: "ok" },
        { name: "mailpit", state: "busy" },
      ],
      coming: true,
    });
  });

  it.each([{ runtimes: undefined }, { runtimes: [] }])(
    "has no line with no runtimes",
    ({ runtimes }) => {
      expect(runtimesComing(runtimes)).toBeUndefined();
    },
  );
});

describe("nextRuntimesLine", () => {
  it.each([
    { case: "never shows for runtimes already up", from: "none", coming: false, to: "none" },
    { case: "shows while they come up", from: "none", coming: true, to: "coming" },
    { case: "stays while they do", from: "coming", coming: true, to: "coming" },
    // Its words fade, its place stays: the page is centred, and a line that went would move it.
    {
      case: "settles, keeping its place, once all are up",
      from: "coming",
      coming: false,
      to: "settled",
    },
    { case: "stays settled", from: "settled", coming: false, to: "settled" },
    {
      case: "comes back for one that goes down again",
      from: "settled",
      coming: true,
      to: "coming",
    },
    // The listing blinks between reads: an unread one says nothing about the runtimes.
    {
      case: "stays coming while the listing is unread",
      from: "coming",
      coming: undefined,
      to: "coming",
    },
    {
      case: "stays settled while the listing is unread",
      from: "settled",
      coming: undefined,
      to: "settled",
    },
    {
      case: "never shows while the listing is unread",
      from: "none",
      coming: undefined,
      to: "none",
    },
  ] as const)("$case", ({ from, coming, to }) => {
    expect(nextRuntimesLine(from, coming)).toBe(to);
  });
});

describe("the stage's words", () => {
  it.each<{ kind: ArrivalKind; headline: string; sentence: string; face: string }>([
    {
      kind: "coming",
      headline: "Wren is coming up on Beviro.",
      sentence: "About two minutes.",
      face: "waking",
    },
    {
      kind: "sign-in",
      headline: "Sign Wren in to start.",
      sentence: "Once it's signed in, Wren stands up development on Beviro.",
      face: "idle",
    },
    {
      kind: "sign-in-plain",
      headline: "Sign Wren in to start.",
      sentence: "Once it's signed in, Wren writes and runs code on its own copy of Beviro.",
      face: "idle",
    },
    {
      kind: "sign-in-colleague",
      headline: "Sign Wren in to start.",
      sentence: "Nobody has signed Wren in yet. Sign it in with your own account and it's yours.",
      face: "idle",
    },
    {
      kind: "standing-up",
      headline: "Wren is standing up development on Beviro.",
      sentence: "Signed in. It starts in a moment.",
      face: "working",
    },
    {
      kind: "question",
      headline: "What should Wren do on Beviro?",
      sentence: "",
      face: "idle",
    },
  ])("$kind: $headline", ({ kind, headline, sentence, face }) => {
    expect(arrivalHeadline(WREN, kind)).toBe(headline);
    expect(arrivalSentence(WREN, kind)).toBe(sentence);
    // Arrived (its window past, or signed in once): at rest where it waits.
    expect(arrivalFace(kind, true, false)).toBe(face);
  });

  it("names who added it to a colleague, where that is known", () => {
    expect(arrivalSentence(WREN, "sign-in-colleague", { addedBy: "Aleš" })).toBe(
      "Aleš added Wren but hasn't signed it in. Sign it in with your own account and it's yours.",
    );
  });

  it("says why its creation stopped", () => {
    expect(arrivalHeadline(WREN, "coming-failed")).toBe("Wren could not be added to Beviro.");
    expect(arrivalSentence(WREN, "coming-failed", { why: "Could not be created." })).toBe(
      "Could not be created.",
    );
  });

  it("keeps a name whole where the headline breaks", () => {
    expect(arrivalHeadline({ name: "Wren", project: "Acme Docs" }, "standing-up")).toBe(
      "Wren is standing up development on Acme Docs.",
    );
  });

  it.each([
    [undefined, "About two minutes."],
    [20_000, "About two minutes."],
    [75_000, "About a minute left."],
    [140_000, "Almost there."],
    [600_000, "Almost there."],
  ])("coming up %s ms in: %s", (elapsedMs, words) => {
    expect(comingSentence(elapsedMs)).toBe(words);
  });

  it("sleeps until it answers", () => {
    expect(arrivalFace("sign-in", false, false)).toBe("sleep");
    expect(arrivalFace("coming-failed", false, true)).toBe("needs");
  });

  // Its pose (`mateFaceFor`): waking while it arrives — from the press to its first sign-in,
  // inside its window — never for a Mate signed in once and signed out since (its signer tag
  // stays), nor for one nobody signed in past its window.
  it.each([
    { case: "coming up", kind: "coming", arriving: true, face: "waking" },
    { case: "coming up, its window read as past", kind: "coming", arriving: false, face: "waking" },
    { case: "arriving, its sign-in to come", kind: "sign-in", arriving: true, face: "waking" },
    { case: "arriving, a colleague's", kind: "sign-in-colleague", arriving: true, face: "waking" },
    { case: "signed in once, signed out since", kind: "sign-in", arriving: false, face: "idle" },
    {
      case: "nobody signed it in, past its window",
      kind: "sign-in-plain",
      arriving: false,
      face: "idle",
    },
    { case: "signed in, asked nothing yet", kind: "question", arriving: false, face: "idle" },
  ] as const)("$case: $face", ({ kind, arriving, face }) => {
    expect(arrivalFace(kind, true, arriving)).toBe(face);
  });
});

// The header over a Mate's arrival wears the stage's pose (`mateFaceFor`): waking while it comes up
// and arrives, asleep where it did not come, at rest once it has arrived.
describe("arrivalHeaderFace", () => {
  it.each([
    {
      case: "coming up",
      kind: "coming",
      over: false,
      arriving: true,
      connected: false,
      face: "waking",
    },
    {
      case: "up, waiting for its sign-in",
      kind: "coming",
      over: true,
      arriving: true,
      connected: true,
      face: "waking",
    },
    {
      case: "up, signed in once (signed out since or not)",
      kind: "coming",
      over: true,
      arriving: false,
      connected: true,
      face: "idle",
    },
    {
      case: "did not come",
      kind: "failed",
      over: false,
      arriving: true,
      connected: false,
      face: "sleep",
    },
    {
      case: "its link not made",
      kind: "reaching",
      over: false,
      arriving: false,
      connected: false,
      face: "sleep",
    },
  ] as const)("$case: $face", ({ case: _case, face, ...input }) => {
    expect(arrivalHeaderFace(input)).toBe(face);
  });
});

/** The browser-run steps in a row: each id's state, in order. */
const subs = (...states: ReadonlyArray<ArrivalSubstep["state"]>): ReadonlyArray<ArrivalSubstep> =>
  states.map((state, index) => ({
    id: `s${String(index)}`,
    label: `Step ${String(index)}`,
    state,
  }));

describe("arrivalSteps — the steps this tab runs, under the project's row", () => {
  const mate = deriveBirthProgress(CREATING, NOW);
  const newProject = {
    steps: [{ id: "registry", label: "Acme Shop", state: "done" as const }, ...mate.steps],
  };

  it.each([
    { case: "running", press: subs("done", "active", "waiting", "waiting"), row: "active" },
    { case: "stopped", press: subs("done", "failed", "waiting", "waiting"), row: "failed" },
    { case: "through", press: subs("done", "done", "done", "done"), row: "done" },
    // Refused, the Mate runs on: its registration waits on Finish setup, and the rest goes on.
    {
      case: "through but its registration, not finished here",
      press: subs("done", "done", "done", "unfinished"),
      row: "done",
    },
  ])("a New project's row reads $row while its steps are $case", ({ press, row }) => {
    const steps = arrivalSteps(
      { ...newProject, press },
      { name: "Vera", project: "Acme Shop" },
      NOW,
    );
    expect(steps[0]).toMatchObject({ id: "registry", state: row, substeps: press });
    expect(steps.slice(1).some((step) => step.substeps !== undefined)).toBe(false);
  });

  it.each([
    { case: "running", press: subs("active", "waiting", "waiting", "waiting"), row: "active" },
    { case: "stopped", press: subs("done", "done", "failed", "waiting"), row: "failed" },
    { case: "through", press: subs("done", "done", "done", "done"), row: "done" },
    {
      case: "its registration not finished",
      press: subs("done", "done", "done", "unfinished"),
      row: "done",
    },
  ])("an added Mate's copy reads $row while its steps are $case", ({ press, row }) => {
    const steps = arrivalSteps({ ...mate, press }, WREN, NOW);
    expect(steps[0]).toMatchObject({ id: "copy", state: row, substeps: press });
  });

  it("keeps a row's own stop over its steps running", () => {
    const failedCopy = {
      steps: mate.steps.map((step) =>
        step.id === "project" ? { ...step, state: "failed" as const, detail: "No room." } : step,
      ),
    };
    const steps = arrivalSteps({ ...failedCopy, press: subs("active", "waiting") }, WREN, NOW);
    expect(steps[0]).toMatchObject({ id: "copy", state: "failed" });
  });

  it("draws no steps under any row where this tab ran none", () => {
    const steps = arrivalSteps(mate, WREN, NOW);
    expect(steps.some((step) => step.substeps !== undefined)).toBe(false);
  });
});

describe("pressRuns — while the tab must stay open", () => {
  it.each([
    { case: "nothing run here", press: undefined, runs: false },
    { case: "no steps", press: subs(), runs: false },
    { case: "not begun", press: subs("waiting", "waiting"), runs: true },
    { case: "one running", press: subs("done", "active", "waiting"), runs: true },
    { case: "one stopped", press: subs("done", "failed", "waiting"), runs: false },
    {
      case: "its registration not finished",
      press: subs("done", "done", "unfinished"),
      runs: false,
    },
    { case: "all through", press: subs("done", "done", "done"), runs: false },
  ])("$case: $runs", ({ press, runs }) => {
    expect(pressRuns(press)).toBe(runs);
  });
});

// Run 6's second review: a stop's whole reason lived in a hover tooltip, and a registration not
// finished read as an owner's with no reason. Both are read whole under the steps, where the
// actions are, by anyone, on any screen.
describe("pressNote — what the steps this tab runs leave to read whole under them", () => {
  const step = (state: ArrivalSubstep["state"], label: string, why?: string): ArrivalSubstep => ({
    id: label,
    label,
    state,
    ...(why === undefined ? {} : { why }),
  });
  it.each([
    { case: "nothing run here", press: undefined, want: null },
    { case: "running", press: [step("done", "Created"), step("active", "Container")], want: null },
    {
      case: "a stop: its whole reason",
      press: [
        step("failed", "Created", "The organization has no room for another project right now."),
        step("waiting", "Container"),
      ],
      want: {
        kind: "stopped",
        text: "The organization has no room for another project right now.",
      },
    },
    {
      case: "a registration not finished: what is not, and why",
      press: [
        step("done", "Closed off"),
        step("unfinished", "Not registered", "Its grant timed out."),
      ],
      want: { kind: "unfinished", text: "Not registered: Its grant timed out." },
    },
    {
      case: "a stop over a registration not finished: the stop",
      press: [
        step("unfinished", "Not registered", "Refused."),
        step("failed", "Container", "Gone."),
      ],
      want: { kind: "stopped", text: "Gone." },
    },
  ] as const)("$case", ({ press, want }) => {
    expect(pressNote(press)).toEqual(want);
  });
});
