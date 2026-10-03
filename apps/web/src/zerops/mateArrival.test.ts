import { deriveBirthProgress, type BirthFacts } from "@t3tools/client-runtime/zerops/birthProgress";
import { describe, expect, it } from "vite-plus/test";

import { signInPhrase } from "~/components/zerops/ZeropsAgentSignIn.logic";

import {
  arrivalFace,
  arrivalHeadline,
  arrivalSentence,
  arrivalSteps,
  comingSentence,
  inFirstSeenOrder,
  nextRuntimesLine,
  runtimesComing,
  type ArrivalKind,
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

describe("arrivalSteps", () => {
  it("reads a Mate's six birth steps as its copy, its workspace and the person's sign-in", () => {
    const steps = arrivalSteps(deriveBirthProgress(CREATING, NOW), WREN, NOW);
    expect(steps).toEqual([
      { id: "copy", label: "Wren's copy of Beviro", state: "done", time: "0:25" },
      {
        id: "workspace",
        label: "Wren's workspace",
        state: "active",
        time: "0:47",
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

  it("never moves its workspace's clock back: it counts from its project's end, though its container starts later", () => {
    // Measured live (Gita, 2026-09-30): 0:12, then 0:08 once the container's own start was read.
    const projectOnly: BirthFacts = {
      ...CREATING,
      container: { serviceId: "zcp", status: "READY_TO_DEPLOY", hasOrigin: false },
      processes: CREATING.processes.filter((process) => process.actionName === "project.create"),
    };
    const later = NOW + 5_000;
    const before = arrivalSteps(deriveBirthProgress(projectOnly, NOW), WREN, NOW)[1]?.time;
    const after = arrivalSteps(deriveBirthProgress(CREATING, later), WREN, later)[1]?.time;
    expect([before, after]).toEqual(["0:47", "0:52"]);
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
          { id: "git-hosting", label: "Git hosting", state: "done" },
          { id: "registry", label: "Acme Shop", state: "done" },
          ...mate.steps,
        ],
      },
      { name: "Vera", project: "Acme Shop" },
      NOW,
    );
    expect(steps.map(({ id, label, state }) => ({ id, label, state }))).toEqual([
      { id: "git-hosting", label: "Git hosting", state: "done" },
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
      face: "sleep",
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
      kind: "failed",
      headline: "The message to Wren didn't go through.",
      sentence: "Wren is signed in, but your ask to stand up development didn't reach it.",
      face: "needs",
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
    expect(arrivalFace(kind, true)).toBe(face);
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
    expect(arrivalFace("sign-in", false)).toBe("sleep");
    expect(arrivalFace("coming-failed", false)).toBe("needs");
  });
});
