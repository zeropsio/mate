import type {
  EnvironmentCreationStep,
  EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { environmentCreationSteps, ZeropsEnvironmentCreation } from "./ZeropsEnvironmentCreation";

const STEPS: ReadonlyArray<EnvironmentCreationStep> = [
  { kind: "create-project", name: "Beviro CRM - production", tagList: [], location: undefined },
  { kind: "import-recipe", role: "prod", yaml: "services: []", sources: {} },
  { kind: "await-ready", withAgent: false },
];

function progress(
  states: ReadonlyArray<EnvironmentCreationStepProgress["state"]>,
): ReadonlyArray<EnvironmentCreationStepProgress> {
  return STEPS.map((step, index) => ({ step, state: states[index] ?? "queued" }));
}

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

describe("environmentCreationSteps", () => {
  it("labels each step from the plan, so a new step cannot arrive unlabelled", () => {
    const steps = environmentCreationSteps(progress(["done", "running", "queued"]), 10_000);
    expect(steps.map((step) => step.label)).toEqual([
      "Creating the environment",
      "Importing the application",
      "Waiting for the services",
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

describe("ZeropsEnvironmentCreation", () => {
  it("names what it is creating and shows the checklist", () => {
    const html = render();
    expect(html).toContain("Creating Beviro CRM - production");
    expect(html).toContain("Importing the application");
    expect(html).toContain('data-zerops-creation-outcome="running"');
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
    const html = render({ outcome: { kind: "done", undeployed: ["app"] } });
    expect(html).toContain("app has nothing deployed yet");
  });

  it("says where a stage's first deploy comes from, rather than sending anyone out", () => {
    // A stage tracks main and the broker deploys the difference on its own, so
    // the old sentence — "deploy from the Zerops dashboard or ask an agent to"
    // — sent the reader out of the product for something already on its way
    // (measured on the test account, 2026-09-20).
    const html = render({ tier: "stage", outcome: { kind: "done", undeployed: ["app"] } });
    expect(html).toContain("app has nothing deployed yet");
    expect(html).toContain("main lands here on its own");
    expect(html).not.toContain("Zerops dashboard");
  });

  it("says a production waits for a release", () => {
    const html = render({ tier: "production", outcome: { kind: "done", undeployed: ["app"] } });
    expect(html).toContain("a release names");
    expect(html).not.toContain("Zerops dashboard");
  });

  it("explains the hand-off to the container wait", () => {
    const html = render({ outcome: { kind: "handed-off" } });
    expect(html).toContain("the wait continues below");
  });
});
