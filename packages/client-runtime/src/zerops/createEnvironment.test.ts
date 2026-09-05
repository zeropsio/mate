import { describe, expect, it } from "vite-plus/test";

import {
  defaultAgentForRole,
  environmentCreationStepLabel,
  planEnvironmentCreation,
  type EnvironmentCreationStep,
} from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import { GO_HELLO_WORLD_GROUP } from "./recipeStoreSeed.ts";

const BASE = {
  clientId: "client-1",
  groupId: "7k2m9qx4vb1c",
  groupName: "Go Hello World",
  name: "Go Hello World - production",
  record: GO_HELLO_WORLD_GROUP,
  role: "prod" as ZeropsEnvironmentRole,
};

function stepKinds(steps: ReadonlyArray<EnvironmentCreationStep>): ReadonlyArray<string> {
  return steps.map((step) => step.kind);
}

describe("defaultAgentForRole", () => {
  it.each([
    { role: "dev", expected: true },
    { role: "devstage", expected: true },
    { role: "stage", expected: true },
    { role: "prod", expected: false },
  ] satisfies ReadonlyArray<{ role: ZeropsEnvironmentRole; expected: boolean }>)(
    "gives $role an agent: $expected",
    ({ role, expected }) => {
      expect(defaultAgentForRole(role)).toBe(expected);
    },
  );
});

describe("planEnvironmentCreation", () => {
  it("refuses a group with no recipe for the role, and says why", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "devstage" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("devstage");
  });

  it("refuses a group with no store record at all", () => {
    const plan = planEnvironmentCreation({ ...BASE, record: undefined });
    expect(plan.ok).toBe(false);
  });

  it("refuses a blank name", () => {
    const plan = planEnvironmentCreation({ ...BASE, name: "   " });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("name");
  });

  it("creates the project with its group tags already on it", () => {
    // It must never exist as an untagged project, or it would be briefly
    // missing from its own group while the user watches it appear.
    const plan = planEnvironmentCreation(BASE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const [first] = plan.steps;
    expect(first).toEqual({
      kind: "create-project",
      name: "Go Hello World - production",
      tagList: ["mate:g:7k2m9qx4vb1c", "mate:role:prod", "mate:name:Go Hello World"],
      location: undefined,
    });
  });

  it("omits the name mirror when the group has no name yet", () => {
    const { groupName: _groupName, ...withoutName } = BASE;
    const plan = planEnvironmentCreation(withoutName);
    if (!plan.ok) throw new Error("expected a plan");
    const [first] = plan.steps;
    expect(first?.kind === "create-project" && first.tagList).toEqual([
      "mate:g:7k2m9qx4vb1c",
      "mate:role:prod",
    ]);
  });

  it("gives production no agent container by default", () => {
    const plan = planEnvironmentCreation(BASE);
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toEqual(["create-project", "import-recipe", "await-ready"]);
  });

  it("gives a dev environment its agent, before the application", () => {
    // The agent is what narrates the rest, and what fixes a failed import.
    const plan = planEnvironmentCreation({ ...BASE, role: "dev", name: "dev" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toEqual([
      "create-project",
      "import-container",
      "import-recipe",
      "await-ready",
    ]);
  });

  it("lets a caller ask for an agent in production explicitly", () => {
    const plan = planEnvironmentCreation({ ...BASE, withAgent: true });
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toContain("import-container");
  });

  it("carries the role's own recipe, not some other role's", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "prod" });
    if (!plan.ok) throw new Error("expected a plan");
    const step = plan.steps.find((entry) => entry.kind === "import-recipe");
    expect(step?.kind === "import-recipe" && step.yaml).toBe(GO_HELLO_WORLD_GROUP.recipes.prod);
    expect(step?.kind === "import-recipe" && step.yaml).toContain("minContainers: 2");
  });

  it("passes the location through when one was chosen", () => {
    const plan = planEnvironmentCreation({ ...BASE, location: "eu-central" });
    if (!plan.ok) throw new Error("expected a plan");
    const [first] = plan.steps;
    expect(first?.kind === "create-project" && first.location).toBe("eu-central");
  });

  it("trims the name it creates the project with", () => {
    const plan = planEnvironmentCreation({ ...BASE, name: "  spaced  " });
    if (!plan.ok) throw new Error("expected a plan");
    const [first] = plan.steps;
    expect(first?.kind === "create-project" && first.name).toBe("spaced");
  });
});

describe("environmentCreationStepLabel", () => {
  it("labels every step a plan can contain", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "dev", name: "dev" });
    if (!plan.ok) throw new Error("expected a plan");

    expect(plan.steps.map(environmentCreationStepLabel)).toEqual([
      "Creating the environment",
      "Adding the agent container",
      "Importing the application",
      "Waiting for the agent",
    ]);
  });

  it("says what it is waiting for when there is no agent", () => {
    expect(environmentCreationStepLabel({ kind: "await-ready", withAgent: false })).toBe(
      "Waiting for the services",
    );
  });
});

describe("the agent's name", () => {
  const RECORD = {
    groupId: "g1",
    name: "Beviro CRM",
    recipes: { stage: "services:\n  - hostname: api\n" },
  };

  it("is written onto the project at birth, not added afterwards", () => {
    const plan = planEnvironmentCreation({
      clientId: "c1",
      groupId: "g1",
      role: "stage",
      name: "crm-stage",
      record: RECORD,
      botName: "Ada",
    });
    expect(plan.ok).toBe(true);
    const step = plan.ok ? plan.steps[0] : undefined;
    expect(step?.kind).toBe("create-project");
    expect(step?.kind === "create-project" ? step.tagList : []).toContain("mate:bot:Ada");
  });

  it("declares the Mate at birth when the environment gets an agent, and not otherwise", () => {
    const tags = (plan: ReturnType<typeof planEnvironmentCreation>) => {
      const step = plan.ok ? plan.steps[0] : undefined;
      return step?.kind === "create-project" ? step.tagList : [];
    };
    // Stage gets an agent by default; production does not — and a caller can
    // say so either way.
    expect(tags(planEnvironmentCreation({ ...BASE, role: "stage" }))).toContain("mate");
    expect(tags(planEnvironmentCreation({ ...BASE, role: "prod" }))).not.toContain("mate");
    expect(tags(planEnvironmentCreation({ ...BASE, role: "prod", withAgent: true }))).toContain(
      "mate",
    );
  });

  it("is optional — an unnamed environment still plans", () => {
    const plan = planEnvironmentCreation({
      clientId: "c1",
      groupId: "g1",
      role: "stage",
      name: "crm-stage",
      record: RECORD,
    });
    expect(plan.ok).toBe(true);
    const step = plan.ok ? plan.steps[0] : undefined;
    const tags = step?.kind === "create-project" ? step.tagList : [];
    expect(tags.some((tag) => tag.startsWith("mate:bot:"))).toBe(false);
  });
});

describe("the recipe choice", () => {
  it("imports the services a caller hands it instead of the store's", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      record: undefined,
      recipe: { kind: "services", yaml: "services:\n  - hostname: app\n", source: "acme-docs-dev" },
    });
    if (!plan.ok) throw new Error(plan.reason);
    const step = plan.steps.find((entry) => entry.kind === "import-recipe");
    expect(step?.kind === "import-recipe" && step.yaml).toContain("hostname: app");
  });

  it("refuses a clone with nothing in it, naming the source", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      recipe: { kind: "services", yaml: "   ", source: "acme-docs-dev" },
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("acme-docs-dev");
  });

  it("skips the application entirely when the agent is to set it up", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      role: "dev",
      name: "dev",
      record: undefined,
      recipe: { kind: "none" },
    });
    if (!plan.ok) throw new Error(plan.reason);
    expect(stepKinds(plan.steps)).toEqual(["create-project", "import-container", "await-ready"]);
  });

  it("refuses an environment with neither an agent nor an application", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "prod", recipe: { kind: "none" } });
    expect(plan.ok).toBe(false);
  });
});
