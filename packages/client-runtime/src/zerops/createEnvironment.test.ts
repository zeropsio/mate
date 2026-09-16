import { describe, expect, it } from "vite-plus/test";

import {
  defaultAgentForRole,
  environmentCreationStepLabel,
  planEnvironmentCreation,
  type EnvironmentCreationStep,
} from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";

/** A tier as `importReadyTier` hands it over: services, and where their code is. */
const TIER = {
  kind: "tier" as const,
  tier: "production" as const,
  yaml: "services:\n  - hostname: api\n    startWithoutCode: true\n",
  sources: { api: { repository: "https://gitea.test/acme/api", setup: "api" } },
};

const BASE = {
  clientId: "client-1",
  groupId: "7k2m9qx4vb1c",
  groupName: "Go Hello World",
  name: "Go Hello World - production",
  recipe: TIER,
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
  it("refuses a project whose recipe has not been merged yet", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      recipe: { ...TIER, yaml: "   " },
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("no recipe merged yet");
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
    // Its token is lowered the moment it exists, before anything is imported
    // beside it and before anyone can talk to it (guide 0.2).
    const plan = planEnvironmentCreation({ ...BASE, role: "dev", name: "dev" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toEqual([
      "create-project",
      "import-container",
      "secure-container-token",
      "drop-container-delegation",
      "isolate-project-env",
      "import-recipe",
      "await-ready",
      // Last and tolerant: the Mate's Gitea access, which needs a container
      // that is up and an account whose Gitea is (guide 1.5).
      "fetch-gitea-credential",
    ]);
  });

  it("plans no token lowering for an environment with no container", () => {
    // Nothing was minted, so there is nothing to lower.
    const plan = planEnvironmentCreation(BASE);
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).not.toContain("secure-container-token");
    expect(stepKinds(plan.steps)).not.toContain("drop-container-delegation");
    expect(stepKinds(plan.steps)).not.toContain("isolate-project-env");
  });

  it("gives the new container the agents the group is signed in with", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      role: "dev",
      name: "dev",
      agents: ["claude-code"],
    });
    if (!plan.ok) throw new Error("expected a plan");
    const container = plan.steps.find((step) => step.kind === "import-container");
    expect(container).toEqual({ kind: "import-container", agents: ["claude-code"] });
  });

  it("asks for no agent in particular when the group has authorized none", () => {
    // Empty is not the same as a choice: `buildZcpServiceImportYaml` omits
    // ZCP_AGENTS entirely, and an absent key offers every agent (MC-11).
    const plan = planEnvironmentCreation({ ...BASE, role: "dev", name: "dev" });
    if (!plan.ok) throw new Error("expected a plan");
    const container = plan.steps.find((step) => step.kind === "import-container");
    expect(container).toEqual({ kind: "import-container", agents: [] });
  });

  it("lets a caller ask for an agent in production explicitly", () => {
    const plan = planEnvironmentCreation({ ...BASE, withAgent: true });
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toContain("import-container");
  });

  it("carries the tier the caller read, byte for byte", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "prod" });
    if (!plan.ok) throw new Error("expected a plan");
    const step = plan.steps.find((entry) => entry.kind === "import-recipe");
    expect(step?.kind === "import-recipe" && step.yaml).toBe(TIER.yaml);
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
      "Locking the container's access",
      "Taking back the container's one-time permit",
      "Closing the project's shared variables",
      "Importing the application",
      "Waiting for the agent",
      "Giving the Mate its Gitea access",
    ]);
  });

  it("says what it is waiting for when there is no agent", () => {
    expect(environmentCreationStepLabel({ kind: "await-ready", withAgent: false })).toBe(
      "Waiting for the services",
    );
  });
});

describe("the agent's name", () => {
  it("is written onto the project at birth, not added afterwards", () => {
    const plan = planEnvironmentCreation({
      clientId: "c1",
      groupId: "g1",
      role: "stage",
      name: "crm-stage",
      recipe: { ...TIER, tier: "stage" as const },
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
      recipe: { ...TIER, tier: "stage" as const },
    });
    expect(plan.ok).toBe(true);
    const step = plan.ok ? plan.steps[0] : undefined;
    const tags = step?.kind === "create-project" ? step.tagList : [];
    expect(tags.some((tag) => tag.startsWith("mate:bot:"))).toBe(false);
  });
});

describe("the recipe choice", () => {
  it("imports the tier it is handed, and keeps its source map", () => {
    const plan = planEnvironmentCreation(BASE);
    if (!plan.ok) throw new Error(plan.reason);
    const step = plan.steps.find((entry) => entry.kind === "import-recipe");
    expect(step?.kind === "import-recipe" && step.yaml).toContain("startWithoutCode: true");
    // The only record of which repository a service's code comes from; the
    // party that adopts the environment afterwards has no other way to know.
    expect(step?.kind === "import-recipe" && step.sources).toEqual(TIER.sources);
  });

  it("skips the application entirely when the agent is to set it up", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      role: "dev",
      name: "dev",
      recipe: { kind: "none" },
    });
    if (!plan.ok) throw new Error(plan.reason);
    expect(stepKinds(plan.steps)).toEqual([
      "create-project",
      "import-container",
      "secure-container-token",
      "drop-container-delegation",
      "isolate-project-env",
      "await-ready",
      "fetch-gitea-credential",
    ]);
  });

  it("refuses an environment with neither an agent nor an application", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "prod", recipe: { kind: "none" } });
    expect(plan.ok).toBe(false);
  });
});

describe("planEnvironmentCreation — whole-project recipes", () => {
  const WHOLE = `#zeropsPreprocessor=on
project:
  name: published-name
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>
services:
  - hostname: app
`;
  const SERVICES_ONLY = "services:\n  - hostname: app\n";

  function plan(recipe: string, extra: Record<string, unknown> = {}) {
    const result = planEnvironmentCreation({
      clientId: "c1",
      groupId: "g1",
      role: "prod",
      name: "Aurora - production",
      recipe: { kind: "tier" as const, tier: "production" as const, yaml: recipe, sources: {} },
      withAgent: false,
      ...extra,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.steps;
  }

  it("creates the project and its services in one call", () => {
    const steps = plan(WHOLE);
    expect(steps.map((step) => step.kind)).toEqual(["import-project", "await-ready"]);
  });

  it("carries the tier's project-level env through", () => {
    // The reason this path exists at all: create-then-strip drops it.
    const [step] = plan(WHOLE);
    expect(step).toMatchObject({ kind: "import-project" });
    if (step?.kind !== "import-project") throw new Error("expected import-project");
    expect(step.yaml).toContain("APP_KEY: <@generateRandomString(<32>)>");
    expect(step.yaml).toContain("name: Aurora - production");
    expect(step.yaml).not.toContain("published-name");
    expect(step.yaml).toContain("- mate:g:g1");
  });

  it("still adds the agent's container after it", () => {
    expect(plan(WHOLE, { withAgent: true }).map((step) => step.kind)).toEqual([
      "import-project",
      "import-container",
      "secure-container-token",
      "drop-container-delegation",
      "isolate-project-env",
      "await-ready",
      "fetch-gitea-credential",
    ]);
  });

  it("keeps create-then-import for a services-only recipe", () => {
    expect(plan(SERVICES_ONLY).map((step) => step.kind)).toEqual([
      "create-project",
      "import-recipe",
      "await-ready",
    ]);
  });

  it("keeps create-then-import when the caller chose a region", () => {
    // The project block has no location; ignoring one would put the
    // environment somewhere the user did not ask for.
    expect(plan(WHOLE, { location: "eu-central" }).map((step) => step.kind)).toEqual([
      "create-project",
      "import-recipe",
      "await-ready",
    ]);
  });
});
