import { describe, expect, it } from "vite-plus/test";

import {
  defaultAgentForRole,
  environmentCreationStepLabel,
  planEnvironmentCreation,
  type EnvironmentCreationInput,
  type EnvironmentCreationStep,
} from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";

/** A tier as the group repo's `main` holds it. */
const TIER = {
  kind: "tier" as const,
  tier: "production" as const,
  yaml: "services:\n  - hostname: api\n    startWithoutCode: true\n",
};

const BASE = {
  clientId: "client-1",
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
    // A stage is a deploy target (its form says so); an agent there is the
    // person's decision, like production's (2026-09-17).
    { role: "stage", expected: false },
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

  it("creates a production with no tag of ours: where it stands is HQ's to say", () => {
    const plan = planEnvironmentCreation(BASE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const [first] = plan.steps;
    expect(first).toEqual({
      kind: "create-project",
      name: "Go Hello World - production",
      tagList: [],
      location: undefined,
    });
  });

  it("gives production no agent container by default", () => {
    const plan = planEnvironmentCreation(BASE);
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toEqual(["create-project", "import-recipe", "await-ready"]);
  });

  it("gives a dev environment its agent, its key with it, and closes it off before the press returns", () => {
    // The container comes with the key the person minted for it, and the project is closed off in
    // the press: no browser is needed after it, and the runtimes zcp imports on boot never start
    // in an open project.
    const plan = planEnvironmentCreation({ ...BASE, role: "dev", name: "dev" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toEqual([
      "create-project",
      "import-container",
      "close-off",
      "share-reach",
      "await-ready",
    ]);
  });

  it("closes off only an environment with a container: one without has no key to keep in", () => {
    const plan = planEnvironmentCreation(BASE);
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).not.toContain("close-off");
  });

  it.each([
    {
      case: "a Mate",
      input: { role: "dev" as const, name: "dev", register: true },
      // Closed off before it is registered: a refused registration never keeps a Mate open.
      steps: [
        "create-project",
        "import-container",
        "close-off",
        "register",
        "share-reach",
        "await-ready",
      ],
    },
    {
      case: "a production",
      input: { register: true },
      steps: ["create-project", "import-recipe", "register", "await-ready"],
    },
    {
      case: "a Mate whose person may not write the registry",
      input: { role: "dev" as const, name: "dev", register: false },
      steps: ["create-project", "import-container", "close-off", "share-reach", "await-ready"],
    },
  ])("registers $case in the press, before anything is waited on", ({ input, steps }) => {
    const plan = planEnvironmentCreation({ ...BASE, ...input });
    if (!plan.ok) throw new Error("expected a plan");
    expect(stepKinds(plan.steps)).toEqual(steps);
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
    expect(container).toMatchObject({ kind: "import-container", agents: ["claude-code"] });
  });

  it("asks for no agent in particular when the group has authorized none", () => {
    // Empty is not the same as a choice: `buildZcpServiceImportYaml` omits
    // ZCP_AGENTS entirely, and an absent key offers every agent (MC-11).
    const plan = planEnvironmentCreation({ ...BASE, role: "dev", name: "dev" });
    if (!plan.ok) throw new Error("expected a plan");
    const container = plan.steps.find((step) => step.kind === "import-container");
    expect(container).toMatchObject({ kind: "import-container", agents: [] });
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
  it("labels a Mate's steps in the order they run", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      role: "dev",
      name: "dev",
      recipe: {
        ...TIER,
        yaml: `services:\n  - hostname: db\n${TIER.yaml.slice("services:\n".length)}`,
      },
    });
    if (!plan.ok) throw new Error("expected a plan");

    expect(plan.steps.map(environmentCreationStepLabel)).toEqual([
      "Creating the environment",
      "Adding the managed services",
      "Adding the agent container",
      "Closing the project off",
      "Letting the project's other Mates see it",
      "Waiting for the agent",
    ]);
  });

  it.each([
    {
      step: { kind: "import-project", name: "x", tagList: [], yaml: "" },
      label: "Creating the environment",
    },
    { step: { kind: "import-recipe", role: "prod", yaml: "" }, label: "Importing the application" },
    { step: { kind: "register" }, label: "Registering it in its project" },
  ] satisfies ReadonlyArray<{ step: EnvironmentCreationStep; label: string }>)(
    "labels $step.kind",
    ({ step, label }) => {
      expect(environmentCreationStepLabel(step)).toBe(label);
    },
  );

  it("says what it is waiting for when there is no agent", () => {
    expect(environmentCreationStepLabel({ kind: "await-ready", withAgent: false })).toBe(
      "Waiting for the services",
    );
  });
});

describe("the Mate's marker", () => {
  it("declares the Mate at birth when the environment gets an agent, and not otherwise", () => {
    const tags = (plan: ReturnType<typeof planEnvironmentCreation>) => {
      const step = plan.ok ? plan.steps[0] : undefined;
      return step?.kind === "create-project" ? step.tagList : [];
    };
    // A dev environment gets an agent by default; a stage and a production
    // do not — and a caller can say so either way.
    expect(tags(planEnvironmentCreation({ ...BASE, role: "dev" }))).toContain("mate");
    expect(tags(planEnvironmentCreation({ ...BASE, role: "stage" }))).not.toContain("mate");
    expect(tags(planEnvironmentCreation({ ...BASE, role: "stage", withAgent: true }))).toContain(
      "mate",
    );
    expect(tags(planEnvironmentCreation({ ...BASE, role: "prod" }))).not.toContain("mate");
    expect(tags(planEnvironmentCreation({ ...BASE, role: "prod", withAgent: true }))).toContain(
      "mate",
    );
  });
});

describe("the stand-up ask", () => {
  const birthTags = (plan: ReturnType<typeof planEnvironmentCreation>) => {
    const step = plan.ok ? plan.steps[0] : undefined;
    return step?.kind === "create-project" || step?.kind === "import-project" ? step.tagList : [];
  };
  const DEV_TIER = { ...TIER, tier: "stage" as const };

  it.each([
    {
      name: "a Mate added to a project, by the person who added it",
      input: { role: "dev" as const, standUpBy: "u-ada" },
      expected: "mate:standup:u-ada",
    },
    {
      name: "a Mate whose recipe arrives as a whole project",
      input: {
        role: "dev" as const,
        standUpBy: "u-ada",
        recipe: { ...DEV_TIER, yaml: `project:\n  name: x\n${DEV_TIER.yaml}` },
      },
      expected: "mate:standup:u-ada",
    },
    {
      name: "nobody named: nobody's first sign-in sends it",
      input: { role: "dev" as const },
      expected: undefined,
    },
    {
      name: "a dev environment with no agent: nobody there to stand it up",
      input: { role: "dev" as const, standUpBy: "u-ada", withAgent: false },
      expected: undefined,
    },
    {
      name: "a stage with an agent: a deploy target, never stood up for development",
      input: { role: "stage" as const, standUpBy: "u-ada", withAgent: true },
      expected: undefined,
    },
    {
      name: "a production",
      input: { role: "prod" as const, standUpBy: "u-ada" },
      expected: undefined,
    },
  ])("$name", ({ input, expected }) => {
    const plan = planEnvironmentCreation({ ...BASE, recipe: DEV_TIER, ...input });
    const tags = birthTags(plan);
    expect(tags.find((tag) => tag.startsWith("mate:standup:"))).toBe(expected);
    const step = plan.ok ? plan.steps[0] : undefined;
    if (expected !== undefined && step?.kind === "import-project") {
      expect(step.yaml).toContain(expected);
    }
  });
});

/**
 * A Mate's application, its kind, its name and its face are HQ's, written by the press's
 * registration: the project the platform creates carries the marker alone, whichever call
 * creates it.
 */
describe("nothing of a Mate's place on its project", () => {
  const WHOLE = "project:\n  name: published-name\nservices:\n  - hostname: app\n";
  const birthTags = (plan: ReturnType<typeof planEnvironmentCreation>) => {
    if (!plan.ok) throw new Error(plan.reason);
    const [step] = plan.steps;
    return step?.kind === "create-project" || step?.kind === "import-project" ? step.tagList : [];
  };

  it.each([
    { case: "an empty Mate", recipe: { kind: "none" as const }, step: "create-project" },
    { case: "a Mate from a services recipe", recipe: TIER, step: "create-project" },
    {
      case: "a Mate from a whole-project recipe",
      recipe: { ...TIER, yaml: WHOLE },
      step: "import-project",
    },
  ])("is written at birth for $case: the marker alone", ({ recipe, step }) => {
    const plan = planEnvironmentCreation({
      ...BASE,
      role: "dev",
      name: "Go Hello World - Ada",
      recipe,
    });
    expect(plan.ok && plan.steps[0]?.kind).toBe(step);
    expect(birthTags(plan)).toEqual(["mate"]);
    if (plan.ok && plan.steps[0]?.kind === "import-project") {
      expect(plan.steps[0].yaml).toContain("  tags:\n    - mate\n");
    }
  });
});

describe("the recipe choice", () => {
  it("imports the tier it is handed, each build taken out for an empty start", () => {
    const plan = planEnvironmentCreation({
      ...BASE,
      recipe: {
        ...TIER,
        yaml: "services:\n  - hostname: api\n    buildFromGit: https://gitea.test/acme/api\n    zeropsSetup: api\n",
      },
    });
    if (!plan.ok) throw new Error(plan.reason);
    const step = plan.steps.find((entry) => entry.kind === "import-recipe");
    expect(step?.kind === "import-recipe" && step.yaml).toBe(
      "services:\n  - hostname: api\n    startWithoutCode: true\n",
    );
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
      "close-off",
      "share-reach",
      "await-ready",
    ]);
    const container = plan.steps.find((step) => step.kind === "import-container");
    expect(container).toEqual({ kind: "import-container", agents: [] });
  });

  it("refuses an environment with neither an agent nor an application", () => {
    const plan = planEnvironmentCreation({ ...BASE, role: "prod", recipe: { kind: "none" } });
    expect(plan.ok).toBe(false);
  });
});

/**
 * A Mate's tier goes in as two imports: its project with the managed services first, and its
 * runtimes with its container, for zcp to import on boot once the press has closed the project
 * off. Nothing that runs code ever starts in an open project.
 */
describe("planEnvironmentCreation — a Mate's tier", () => {
  const MATE_TIER = `#zeropsPreprocessor=on
project:
  name: published-name
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>
services:
  - hostname: appdev
    type: nodejs@22
    buildFromGit: https://gitea.test/acme/app
    zeropsSetup: dev
  - hostname: appstage
    type: nodejs@22
    buildFromGit: https://gitea.test/acme/app
    zeropsSetup: prod
    priority: 5
  - hostname: db
    type: postgresql@17
    priority: 10
`;
  const SERVICES_ONLY = MATE_TIER.replace(/^project:\n(?: {2}.*\n)+/mu, "");
  const CONTAINER_STEPS = ["import-container", "close-off", "share-reach"] as const;

  function plan(yaml: string, extra: Partial<EnvironmentCreationInput> = {}) {
    const result = planEnvironmentCreation({
      clientId: "c1",
      role: "dev",
      name: "Acme - Wren",
      recipe: { kind: "tier", tier: "mate", yaml },
      ...extra,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.steps;
  }

  it.each([
    {
      case: "a tier that describes its project",
      yaml: MATE_TIER,
      extra: {},
      steps: ["import-project", ...CONTAINER_STEPS, "await-ready"],
    },
    {
      case: "a tier of services only",
      yaml: SERVICES_ONLY,
      extra: {},
      steps: ["create-project", "import-managed", ...CONTAINER_STEPS, "await-ready"],
    },
    {
      case: "a tier placed in a region",
      yaml: MATE_TIER,
      extra: { location: "eu-central" },
      steps: ["create-project", "import-managed", ...CONTAINER_STEPS, "await-ready"],
    },
    {
      case: "a tier of runtimes alone",
      yaml: "services:\n  - hostname: appdev\n    buildFromGit: https://gitea.test/acme/app\n",
      extra: {},
      steps: ["create-project", ...CONTAINER_STEPS, "await-ready"],
    },
    {
      case: "a tier of managed services alone",
      yaml: "project:\n  name: x\nservices:\n  - hostname: db\n    type: postgresql@17\n",
      extra: {},
      steps: ["import-project", ...CONTAINER_STEPS, "await-ready"],
    },
    {
      case: "a stage given an agent",
      yaml: MATE_TIER,
      extra: { role: "stage", withAgent: true },
      steps: ["import-project", ...CONTAINER_STEPS, "await-ready"],
    },
  ] satisfies ReadonlyArray<{
    case: string;
    yaml: string;
    extra: Partial<EnvironmentCreationInput>;
    steps: ReadonlyArray<EnvironmentCreationStep["kind"]>;
  }>)("plans $case: managed first, runtimes with the container", ({ yaml, extra, steps }) => {
    expect(stepKinds(plan(yaml, extra))).toEqual(steps);
  });

  it("creates the project with its managed services alone, its variables evaluated there", () => {
    const [step] = plan(MATE_TIER);
    if (step?.kind !== "import-project") throw new Error("expected import-project");
    expect(step.yaml).toBe(`#zeropsPreprocessor=on
project:
  name: Acme - Wren
  tags:
    - mate
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>
services:
  - hostname: db
    type: postgresql@17
    priority: 10
`);
  });

  it("adds the managed services, services only, to a project it created", () => {
    const managed = plan(SERVICES_ONLY).find((step) => step.kind === "import-managed");
    expect(managed?.kind === "import-managed" && managed.yaml).toBe(
      "#zeropsPreprocessor=on\nservices:\n  - hostname: db\n    type: postgresql@17\n    priority: 10\n",
    );
  });

  it("hands the runtimes to the container, in one wave, each as it comes up", () => {
    const container = plan(MATE_TIER).find((step) => step.kind === "import-container");
    expect(container?.kind === "import-container" && container.runtimes).toEqual({
      yaml: `#zeropsPreprocessor=on
services:
  - hostname: appdev
    type: nodejs@22
    startWithoutCode: true
  - hostname: appstage
    type: nodejs@22
`,
      services: [
        { hostname: "appdev", role: "dev" },
        { hostname: "appstage", role: "stage" },
      ],
    });
  });

  it("refuses a tier that declares no services: nothing has been merged yet", () => {
    const result = planEnvironmentCreation({
      clientId: "c1",
      role: "dev",
      name: "Acme - Wren",
      recipe: { kind: "tier", tier: "mate", yaml: "project:\n  name: x\n" },
    });
    expect(result).toEqual({ ok: false, reason: "This project has no recipe merged yet." });
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
      role: "prod",
      name: "Aurora - production",
      recipe: { kind: "tier" as const, tier: "production" as const, yaml: recipe },
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
  });

  it("still adds the agent's container after it", () => {
    expect(plan(WHOLE, { withAgent: true }).map((step) => step.kind)).toEqual([
      "import-project",
      "import-container",
      "close-off",
      "share-reach",
      "await-ready",
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
    const steps = plan(WHOLE, { location: "eu-central" });
    expect(steps.map((step) => step.kind)).toEqual([
      "create-project",
      "import-recipe",
      "await-ready",
    ]);
    // Into a project that exists, services only: the platform refuses a
    // project block there (`projectImportProjectIncluded`).
    const [, services] = steps;
    expect(services?.kind === "import-recipe" && services.yaml).toBe(
      "#zeropsPreprocessor=on\nservices:\n  - hostname: app\n",
    );
  });
});
