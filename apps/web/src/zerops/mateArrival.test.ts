import { deriveBirthProgress, type BirthFacts } from "@t3tools/client-runtime/zerops/birthProgress";
import { describe, expect, it } from "vite-plus/test";

import {
  arrivalFace,
  arrivalHeadline,
  arrivalSentence,
  arrivalSteps,
  comingSentence,
  type ArrivalKind,
  type ArrivalStepInput,
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
  provisioningPhase: "awaiting-settled",
  connection: "none",
};

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
      { id: "you", label: "You sign Wren in", state: "you", note: "next" },
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
          provisioningPhase: null,
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

  it("draws the services the copy's import brings under it, and nothing where none are read", () => {
    const progress = deriveBirthProgress(CREATING, NOW);
    const services = [
      { name: "db", state: "ok" as const },
      { name: "medusadev", state: "busy" as const },
      { name: "medusastage", state: "empty" as const },
    ];
    const withServices = {
      steps: progress.steps.map((step): ArrivalStepInput =>
        step.id === "project" ? { ...step, services } : step,
      ),
    };
    expect(arrivalSteps(withServices, WREN, NOW)[0]?.services).toEqual(services);
    expect(arrivalSteps(progress, WREN, NOW)[0]).not.toHaveProperty("services");
  });

  it.each([
    { state: "done" as const, drawn: "ok" as const },
    { state: "active" as const, drawn: "busy" as const },
    { state: "waiting" as const, drawn: "waiting" as const },
    { state: "failed" as const, drawn: "failed" as const },
  ])(
    "draws a runtime the birth imports after closing off, $state, as $drawn",
    ({ state, drawn }) => {
      const progress = deriveBirthProgress(CREATING, NOW);
      const withRuntimes = {
        ...progress,
        runtimes: { runtimes: [{ hostname: "medusadev", state }] },
      };
      expect(arrivalSteps(withRuntimes, WREN, NOW)[0]?.services).toEqual([
        { name: "medusadev", state: drawn },
      ]);
    },
  );

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
          provisioningPhase: "awaiting-health",
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
      { id: "you", label: "You sign Vera in", state: "you" },
    ]);
    // Its clock starts with the project's own creation.
    expect(steps[2]?.time).toBe("1:12");
  });
});

describe("the stage's words", () => {
  it.each<{ kind: ArrivalKind; headline: string; sentence: string; face: string }>([
    {
      kind: "coming",
      headline: "Wren is coming up on Beviro.",
      sentence: "About two minutes. Then you sign it in.",
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
    [undefined, "About two minutes. Then you sign it in."],
    [20_000, "About two minutes. Then you sign it in."],
    [75_000, "About a minute left. Then you sign it in."],
    [140_000, "Almost there. Then you sign it in."],
    [600_000, "Almost there. Then you sign it in."],
  ])("coming up %s ms in: %s", (elapsedMs, words) => {
    expect(comingSentence(elapsedMs)).toBe(words);
  });

  it("sleeps until it answers", () => {
    expect(arrivalFace("sign-in", false)).toBe("sleep");
    expect(arrivalFace("coming-failed", false)).toBe("needs");
  });
});
