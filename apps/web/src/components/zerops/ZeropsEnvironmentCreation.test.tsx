import type {
  EnvironmentCreationStep,
  EnvironmentCreationStepProgress,
  ServiceDeployment,
} from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  creationNow,
  creationSettled,
  environmentCreationSteps,
  ZeropsEnvironmentCreation,
} from "./ZeropsEnvironmentCreation";

const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
  { kind: "create-project", name: "Beviro CRM - production", tagList: [], location: undefined },
  { kind: "import-recipe", role: "prod", yaml: "services: []" },
  { kind: "await-ready", withAgent: false },
];

function progress(
  states: ReadonlyArray<EnvironmentCreationStepProgress["state"]>,
): ReadonlyArray<EnvironmentCreationStepProgress> {
  return STEPS.map((step, index) => ({ step, state: states[index] ?? "queued" }));
}

/** A service the platform settled with nothing deployed: `known(none)`. */
const nothingDeployed = (service: string): ServiceDeployment => ({
  service,
  deployment: {
    state: "known",
    value: { kind: "none" },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "settled" },
  },
});

/** A service whose deployment nobody has read yet. */
const unread = (service: string): ServiceDeployment => ({
  service,
  deployment: { state: "unread", waitingFor: null },
});

function render(props: Partial<Parameters<typeof ZeropsEnvironmentCreation>[0]> = {}) {
  return renderToStaticMarkup(
    <ZeropsEnvironmentCreation
      name="Beviro CRM - production"
      nowMs={10_000}
      onDismiss={() => {}}
      progress={progress(["done", "running", "queued"])}
      {...props}
    />,
  );
}

// The run's Add stage: its progress stood in a card of its own at the page's foot, below the fold,
// while the stage's line on its card already said "Deploying…" — it is said on that line now.
describe("a stage's setting up in one line", () => {
  it.each([
    { case: "before its plan is known", states: [], step: undefined, since: null },
    {
      case: "the step under way",
      states: ["done", "running", "queued"],
      step: "Adding its services",
      since: 1_000,
    },
    {
      case: "the next, between two",
      states: ["done", "done", "queued"],
      step: "Starting the stage's services",
      since: 1_000,
    },
    {
      case: "the last, once all are done",
      states: ["done", "done", "done"],
      step: "Starting the stage's services",
      since: 1_000,
    },
    {
      case: "the one that failed",
      states: ["done", "failed", "queued"],
      step: "Adding its services",
      since: 1_000,
    },
  ] as const)("says $case, and since when it runs", ({ states, step, since }) => {
    const steps = STEPS.slice(0, states.length).map((entry, index) => ({
      step: entry,
      state: states[index] ?? "queued",
      ...(states[index] === "queued" ? {} : { startedAtMs: 1_000 + index * 500 }),
    }));
    expect(creationNow(steps, "stage")).toEqual({ step, startedAtMs: since });
  });
});

describe("environmentCreationSteps", () => {
  it("labels each step from the plan, so a new step cannot arrive unlabelled", () => {
    const steps = environmentCreationSteps(progress(["done", "running", "queued"]), 10_000);
    expect(steps.map((step) => step.label)).toEqual([
      "Creating it",
      "Adding its services",
      "Starting its services",
    ]);
    expect(steps.map((step) => step.state)).toEqual(["done", "running", "queued"]);
  });

  it("times a running step against now and a finished one against its end", () => {
    const [first, second] = environmentCreationSteps(
      [
        { step: STEPS[0]!, state: "done", startedAtMs: 0, finishedAtMs: 4_000 },
        { step: STEPS[1]!, state: "running", startedAtMs: 4_000 },
      ],
      10_000,
    );
    expect(first?.durationMs).toBe(4_000);
    expect(second?.durationMs).toBe(6_000);
  });

  it("puts what the platform said beside the step that failed", () => {
    const [, second] = environmentCreationSteps(
      [
        { step: STEPS[0]!, state: "done" },
        { step: STEPS[1]!, state: "failed", error: "projectImportProjectIncluded" },
      ],
      0,
    );
    expect(second?.note).toBe("projectImportProjectIncluded");
  });
});

// The run: "Tea Shop - stage is set up" stood 70 s after the stage's own line said Running at
// its address, saying it again and asking for a Dismiss.
describe("a set-up card's end", () => {
  it.each([
    {
      case: "the place runs at its address",
      outcome: "done",
      runs: true,
      addressed: true,
      gone: true,
    },
    {
      case: "it runs with no address yet",
      outcome: "done",
      runs: true,
      addressed: false,
      gone: false,
    },
    { case: "nothing runs there yet", outcome: "done", runs: false, addressed: true, gone: false },
    { case: "it failed", outcome: "failed", runs: true, addressed: true, gone: false },
    {
      case: "it is still being set up",
      outcome: undefined,
      runs: true,
      addressed: true,
      gone: false,
    },
  ] as const)("goes by itself once the place it set up says the rest: $case", (input) => {
    expect(creationSettled(input)).toBe(input.gone);
  });
});

describe("ZeropsEnvironmentCreation", () => {
  it("names what it is creating and says the step under way in one row, never a growing list", () => {
    const html = render();
    expect(html).toContain("Creating Beviro CRM - production");
    expect(html).toContain("Adding its services");
    expect(html).toContain('data-zerops-creation-outcome="running"');
    // The steps done and to come are not listed: the row's words replace each other.
    const done = render({ progress: progress(["done", "done", "running"]) });
    expect(done).not.toContain("Adding its services");
  });

  it("offers no way out while it is running", () => {
    expect(render()).not.toContain("Dismiss");
  });

  it("says the project exists when a later step failed", () => {
    // A half-built environment is a real project; the user must not make a second.
    const html = render({
      outcome: { kind: "failed", error: "boom", projectExists: true },
      progress: progress(["done", "failed", "queued"]),
    });
    expect(html).toContain("The project exists");
    expect(html).toContain("Dismiss");
  });

  it("says nothing was created when creating the project is what failed", () => {
    const html = render({
      outcome: { kind: "failed", error: "quota", projectExists: false },
      progress: progress(["failed", "queued", "queued"]),
    });
    expect(html).toContain("Nothing was created");
  });

  it("says what still needs a deploy when the environment is up", () => {
    const html = render({ outcome: { kind: "done", deployments: [nothingDeployed("app")] } });
    expect(html).toContain("app has nothing deployed yet");
  });

  it("never says nothing is deployed while what runs there is unread", () => {
    // A negative is earned from a known, complete answer (DESIGN §3.4); an
    // environment with one service not yet read has no such answer.
    const html = render({
      tier: "stage",
      outcome: { kind: "done", deployments: [nothingDeployed("app"), unread("api")] },
    });
    expect(html).not.toContain("nothing deployed yet");
    expect(html).toContain("Checking what runs here…");
  });

  it("says where a stage's first deploy comes from, rather than sending anyone out", () => {
    // A stage tracks main and HQ deploys the difference on its own, so
    // the old sentence — "deploy from the Zerops dashboard or ask an agent to"
    // — sent the reader out of the product for something already on its way
    // (measured on the test account, 2026-09-20).
    const html = render({
      tier: "stage",
      outcome: { kind: "done", deployments: [nothingDeployed("app")] },
    });
    expect(html).toContain("app has nothing deployed yet");
    expect(html).toContain("its first deploy of main shows on its line above");
    // Its services stand; nothing serves there yet, so it is set up, never "up".
    expect(html).toContain("The environment is set up.");
    expect(html).not.toContain(" is up");
    expect(html).not.toContain("Zerops dashboard");
    // The card cannot see what holds the deploy: it promises no time (run 4, F2 — "within a few
    // minutes" stood for 4.6 min).
    expect(html).not.toContain("within a few minutes");
  });

  it.each([
    { outcome: undefined, title: "Creating Beviro CRM - production" },
    {
      outcome: { kind: "done", deployments: [nothingDeployed("app")] } as const,
      title: "Beviro CRM - production is set up",
    },
    // Handed off, its container is still on its way: still being created.
    { outcome: { kind: "handed-off" } as const, title: "Creating Beviro CRM - production" },
    {
      outcome: { kind: "failed", error: "No.", projectExists: true } as const,
      title: "Beviro CRM - production didn’t come up",
    },
  ])("is titled $title", ({ outcome, title }) => {
    const html = render(outcome === undefined ? {} : { outcome });
    expect(html).toContain(`>${title}</h2>`);
  });

  // The onboarding run: "app has nothing deployed yet" stood under a stage whose line read
  // "Running · main" for a minute, beside a "Back to projects" on the projects page.
  it("says nothing of a first deploy once something runs there, and is dismissed where it stands", () => {
    const html = render({
      tier: "stage",
      outcome: { kind: "done", deployments: [nothingDeployed("app")] },
      deployed: true,
    });
    expect(html).toContain("The environment is set up.");
    expect(html).not.toContain("nothing deployed yet");
    expect(html).not.toContain("Back to projects");
    expect(html).toContain("Dismiss");
  });

  it("Production's reserved project says its services arrive with the first release", () => {
    const html = render({ tier: "production", outcome: { kind: "done", deployments: [] } });
    expect(html).toContain("Its services arrive with the first approved release.");
  });

  it("says a production waits for a release", () => {
    const html = render({
      tier: "production",
      outcome: { kind: "done", deployments: [nothingDeployed("app")] },
    });
    expect(html).toContain("a release names");
    expect(html).not.toContain("Zerops dashboard");
  });

  it("explains the hand-off to the container wait", () => {
    const html = render({ outcome: { kind: "handed-off" } });
    expect(html).toContain("the wait continues below");
  });
});
