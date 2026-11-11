import { describe, expect, it, vi } from "vite-plus/test";

import type { ProjectServices } from "@t3tools/client-runtime/data";
import { Atom, AtomRegistry } from "effect/reactivity";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import type { RunToEnd } from "@t3tools/client-runtime/data";
import { planEnvironmentCreation, runEnvironmentCreation } from "@t3tools/client-runtime/zerops";

import { pressPlatform, pressRegistration } from "./matePress";
import {
  addedEnvironmentRegistration,
  addedMateBirth,
  environmentProjectName,
  untilServicesSettled,
} from "./useEnvironmentCreation";

describe("addedMateBirth — the birth intent an added Mate is pressed under", () => {
  const record = () => vi.fn(async () => "b-gus");
  const plan = { projectName: "Garden - Gus", displayName: "Gus", agents: [], userRoles: [] };

  it("records the selected tier revision and creation inputs for another device", async () => {
    const recorded = record();
    await addedMateBirth(recorded, {
      groupId: "app-g",
      role: "stage",
      choice: {
        withAgent: true,
        recipe: { kind: "tier", tier: "stage", revision: "revision-a", yaml: "services: []" },
        face: { tint: "rose", shape: "seal" },
      },
      projectName: "Garden - stage",
      displayName: "stage",
      agents: ["codex"],
      userRoles: [{ clientUserId: "member-1", roleCode: "OWNER" }],
    });
    expect(recorded).toHaveBeenCalledWith({
      appId: "app-g",
      face: "rose:seal",
      standUp: false,
      intent: {
        projectName: "Garden - stage",
        recipe: { kind: "tier", id: "group", revision: "revision-a", tier: "stage" },
        agents: ["codex"],
        standUp: false,
        automated: false,
        placement: { role: "stage", name: "stage", chief: false },
        location: null,
        userRoles: [{ clientUserId: "member-1", roleCode: "OWNER" }],
      },
    });
  });

  // F6c (2026-10-03): recorded at HQ before its project exists, so a press cut off between the
  // project and its attach is finished where and as it was asked for, in any browser. Audit B3:
  // with the person's stand-up ask — a dev Mate's — which its attach records with the Mate.
  it.each([
    {
      case: "a dev Mate, asking its stand-up",
      role: "dev" as const,
      recipe: {
        kind: "tier" as const,
        revision: "recipe-revision",
        tier: "mate" as const,
        yaml: "services: []",
      },
      standUp: true,
    },
    {
      case: "a devstage Mate, asking none",
      role: "devstage" as const,
      recipe: {
        kind: "tier" as const,
        revision: "recipe-revision",
        tier: "mate" as const,
        yaml: "services: []",
      },
      standUp: false,
    },
    {
      case: "a stage with its own Mate, asking none",
      role: "stage" as const,
      recipe: { kind: "none" as const },
      standUp: false,
    },
    {
      case: "the first dev Mate without a recipe, awaiting its first task",
      role: "dev" as const,
      recipe: { kind: "none" as const },
      standUp: false,
    },
  ])("records $case, in its application under its face", async ({ role, recipe, standUp }) => {
    const recorded = record();
    expect(
      await addedMateBirth(recorded, {
        groupId: "app-g",
        role,
        choice: { withAgent: true, recipe, face: { tint: "rose", shape: "seal" } },
        ...plan,
      }),
    ).toBe("b-gus");
    // D3: its name is its project's, never HQ's.
    expect(recorded).toHaveBeenCalledWith({
      appId: "app-g",
      face: "rose:seal",
      standUp,
      intent: {
        projectName: "Garden - Gus",
        recipe:
          recipe.kind === "none"
            ? { kind: "none" }
            : { kind: "tier", id: "group", revision: "recipe-revision", tier: "mate" },
        agents: [],
        standUp,
        automated: false,
        placement: { role, name: "Gus", chief: false },
        location: null,
        userRoles: [],
      },
    });
  });

  it("records an automated Mate's birth as automated, so whichever browser finishes it makes it so", async () => {
    const recorded = record();
    await addedMateBirth(recorded, {
      groupId: "app-g",
      role: "dev",
      ...plan,
      choice: {
        withAgent: true,
        recipe: { kind: "tier", revision: "recipe-revision", tier: "mate", yaml: "services: []" },
        face: { tint: "rose", shape: "seal" },
        automated: true,
      },
    });
    expect(recorded).toHaveBeenCalledWith({
      appId: "app-g",
      face: "rose:seal",
      standUp: true,
      automated: true,
      intent: {
        projectName: "Garden - Gus",
        recipe: { kind: "tier", id: "group", revision: "recipe-revision", tier: "mate" },
        agents: [],
        standUp: true,
        automated: true,
        placement: { role: "dev", name: "Gus", chief: false },
        location: null,
        userRoles: [],
      },
    });
  });

  it.each([
    { case: "a stage HQ deploys, with no Mate", role: "stage" as const, withAgent: false },
    { case: "a production", role: "prod" as const, withAgent: false },
    { case: "a dev environment with no agent", role: "dev" as const, withAgent: false },
  ])("records none for $case: no Mate is born", async ({ role, withAgent }) => {
    const recorded = record();
    expect(
      await addedMateBirth(recorded, {
        groupId: "app-g",
        role,
        choice: { withAgent, recipe: { kind: "none" } },
        ...plan,
      }),
    ).toBeUndefined();
    expect(recorded).not.toHaveBeenCalled();
  });
});

describe("a stage added to a group, as its press writes it at HQ", () => {
  const STAGE_TIER = {
    kind: "tier" as const,
    revision: "recipe-revision",
    tier: "stage" as const,
    yaml: "services:\n  - hostname: api\n    startWithoutCode: true\n",
  };
  /**
   * The press of the hook, its writes at Zerops and HQ recorded in order. HQ authorizes a
   * container's key only for a Mate it places (`mate`, `devstage`) or an open birth intent bound to
   * the project (mate-hq `observe/credentials.go`), and refuses any other with `mate_not_in_app`.
   */
  const press = async (choice: {
    readonly withAgent: boolean;
    readonly recipe: typeof STAGE_TIER | { readonly kind: "none" };
  }) => {
    const calls: Array<string> = [];
    const placed = new Set<string>();
    const bound = new Map<string, string>();
    const intent = await addedMateBirth(
      async () => {
        calls.push("record-birth");
        return "b-1";
      },
      {
        groupId: "app-g",
        role: "stage",
        choice,
        projectName: "Acme - stage",
        displayName: "stage",
        agents: [],
        userRoles: [],
      },
    );
    const run = (async (
      op: Parameters<RunToEnd>[0],
      options: Parameters<RunToEnd>[1] & {
        readonly accepted?: (answer: { readonly projectId: string }) => void;
      },
    ) => {
      switch (op.kind) {
        case "create-project":
          calls.push("create-project");
          options.accepted?.({ projectId: "p-stage" });
          return { projectId: "p-stage" };
        case "import-services":
          calls.push("import-services");
          return {};
        case "bind-birth":
          calls.push(`bind-birth ${op.birthId}`);
          bound.set(op.projectId, op.birthId);
          return {};
        case "attach-project":
          calls.push(
            `attach ${op.attach.kind}${op.attach.birth === undefined ? "" : ` closing ${op.attach.birth}`}`,
          );
          if (op.attach.kind === "mate" || op.attach.kind === "devstage")
            placed.add(op.attach.projectId);
          if (op.attach.birth !== undefined) bound.delete(op.attach.projectId);
          return {};
        case "keep-deploy-key":
          calls.push("keep-deploy-key");
          return {};
        case "import-container":
          if (!placed.has(op.projectId) && !bound.has(op.projectId))
            throw new Error("mate_not_in_app");
          calls.push("zcp-authorization", "import-container");
          return { serviceName: "zcp", imported: true };
        default:
          throw new Error(`No ${op.kind} in this press.`);
      }
    }) as RunToEnd;
    const inputs = {
      client: {} as never,
      operations: {
        run,
        untilEnvironment: async () => ({ name: "Acme - stage", keyed: false }),
      } as never,
      organizationId: "org-acme",
    };
    const hq = { projectId: "hq", address: "https://hq.test" };
    const plan = planEnvironmentCreation({
      clientId: "org-acme",
      role: "stage",
      name: "Acme - stage",
      recipe: choice.recipe,
      withAgent: choice.withAgent,
      ...(intent === undefined ? {} : { birth: intent }),
    });
    if (!plan.ok) throw new Error(plan.reason);
    const outcome = await runEnvironmentCreation({
      clientId: "org-acme",
      steps: plan.steps,
      platform: pressPlatform(inputs, {
        register: pressRegistration(
          inputs,
          addedEnvironmentRegistration({ hq, groupId: "app-g", role: "stage", choice, intent }),
        ),
        hq,
        untilServicesSettled: async () => [],
      }),
    });
    return { calls, outcome };
  };

  it("with its own Mate, is born as a Mate that is also the stage: its intent, bound, attached as HQ places a Mate, before its container's key is authorized", async () => {
    const { calls, outcome } = await press({ withAgent: true, recipe: { kind: "none" } });
    expect(outcome.ok).toBe(true);
    expect(calls).toEqual([
      "record-birth",
      "create-project",
      "bind-birth b-1",
      "attach devstage closing b-1",
      "zcp-authorization",
      "import-container",
    ]);
  });

  it("without a Mate, is a stage HQ deploys: no birth, its tier imported, then attached as a stage with its deploy key", async () => {
    const { calls, outcome } = await press({ withAgent: false, recipe: STAGE_TIER });
    expect(outcome.ok).toBe(true);
    expect(calls).toEqual(["create-project", "import-services", "attach stage", "keep-deploy-key"]);
  });
});

describe("environmentProjectName — what an environment's project is created as", () => {
  it.each([
    {
      case: "a Mate, in full under its application",
      role: "dev",
      typed: "Rune",
      name: "SPN - Rune",
      shown: "Rune",
    },
    {
      case: "a Mate typed with its application's prefix, never doubled",
      role: "dev",
      typed: "SPN - Rune",
      name: "SPN - Rune",
      shown: "Rune",
    },
    {
      case: "a stage, as the person named it",
      role: "stage",
      typed: "SPN - stage",
      name: "SPN - stage",
      shown: "stage",
    },
    {
      case: "a production named another way",
      role: "prod",
      typed: "Live",
      name: "Live",
      shown: "Live",
    },
  ] as const)("$case", ({ role, typed, name, shown }) => {
    expect(environmentProjectName(role, "SPN", typed)).toEqual({ name, shown });
  });
});

describe("untilServicesSettled — an environment's services, waited on as the account observes them", () => {
  const listing = (patch: Partial<ProjectServices>): ProjectServices => ({
    services: undefined,
    live: true,
    reconnecting: false,
    ...patch,
  });
  const service = (name: string, status: string) =>
    ({ id: name, name, status, projectId: "p1" }) as unknown as NonNullable<
      ProjectServices["services"]
    >[number];

  it("waits through none and one still creating, and settles once every one has", async () => {
    const registry = AtomRegistry.make();
    const listed = Atom.make(listing({}));
    let settled: unknown;
    const waiting = untilServicesSettled(registry, listed).then((value) => (settled = value));
    for (const next of [
      listing({ services: [] }),
      listing({ services: [service("app", "CREATING"), service("db", "ACTIVE")] }),
    ]) {
      registry.set(listed, next);
      await Promise.resolve();
      expect(settled).toBeUndefined();
    }
    registry.set(
      listed,
      listing({ services: [service("app", "READY_TO_DEPLOY"), service("db", "ACTIVE")] }),
    );
    await waiting;
    expect(settled).toEqual([
      { name: "app", status: "READY_TO_DEPLOY" },
      { name: "db", status: "ACTIVE" },
    ]);
  });

  it("stops where Zerops refused the listing", async () => {
    const registry = AtomRegistry.make();
    const listed = Atom.make(listing({ unavailableReason: "forbidden" }));
    await expect(untilServicesSettled(registry, listed)).rejects.toThrow(
      "Zerops refused to say how the environment's services stand.",
    );
  });

  it("waits on Zerops pushes alone: no timer runs while it waits, and the frame that brings every service ACTIVE ends it", async () => {
    vi.useFakeTimers();
    try {
      const registry = AtomRegistry.make();
      const listed = Atom.make(listing({ services: [service("zcp", "CREATING")] }));
      // The listing observed as the account's store observes it: the registry's own timers.
      const observed = registry.subscribe(listed, () => undefined, { immediate: true });
      const registryTimers = vi.getTimerCount();
      let settled: unknown;
      const waiting = untilServicesSettled(registry, listed).then((value) => (settled = value));
      expect(vi.getTimerCount()).toBe(registryTimers);
      registry.set(
        listed,
        listing({ services: [service("zcp", "ACTIVE"), service("db", "ACTIVE")] }),
      );
      await waiting;
      expect(settled).toEqual([
        { name: "zcp", status: "ACTIVE" },
        { name: "db", status: "ACTIVE" },
      ]);
      observed();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops where the account it waits in closes", async () => {
    openAccountLifetime("account-1");
    const registry = AtomRegistry.make();
    const waiting = untilServicesSettled(registry, Atom.make(listing({})));
    closeAccountLifetime();
    await expect(waiting).rejects.toThrow("This account session has ended.");
  });
});
