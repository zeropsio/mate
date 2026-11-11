import type { SharedBirth } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";
import { continuedBirthPlan } from "./continueBirth.logic";

const birth: SharedBirth = {
  id: "birth",
  appId: "app",
  appName: "Shop",
  face: "",
  projectId: null,
  importProcessId: null,
  placement: "unknown",
  canContinue: true,
  canDelete: true,
  progress: { phase: "creating-project", next: { kind: "create" }, reason: null },
  intent: {
    projectName: "Shop - Ada",
    recipe: { kind: "none" },
    agents: ["codex"],
    standUp: false,
    automated: false,
    placement: { role: "dev", name: "Ada", chief: false },
    location: "prg1",
    userRoles: [{ clientUserId: "member", roleCode: "OWNER" }],
  },
};
const yaml = "services:\n  - hostname: api\n    startWithoutCode: true\n";
const recipe = { revision: "original", tier: "mate" as const, yaml };

describe("a continued birth's original plan", () => {
  it("Decision: The creation intent needed to continue from another device (recipe id + revision, tier, selected agents, stand-up/automated, placement; nothing secret) is stored in the birth's intent object at POST /api/births and is what Continue uses; it never re-reads a mutable current `main` of the recipe as if it were the original plan.", () => {
    const tier = {
      ...birth,
      intent: {
        ...birth.intent!,
        recipe: {
          kind: "tier" as const,
          id: "group" as const,
          revision: "original",
          tier: "mate" as const,
        },
      },
    };
    expect(continuedBirthPlan(tier, "org", undefined, "OWNER").ok).toBe(false);
    expect(continuedBirthPlan(tier, "org", { ...recipe, revision: "new-main" }, "OWNER").ok).toBe(
      false,
    );
    const plan = continuedBirthPlan(tier, "org", recipe, "OWNER");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map(({ kind }) => kind)).toEqual([
      "create-project",
      "register",
      "import-container",
      "await-ready",
    ]);
    expect(plan.steps[0]).toMatchObject({
      kind: "create-project",
      name: "Shop - Ada",
      location: "prg1",
      birth: "birth",
      userRoles: [{ clientUserId: "member", roleCode: "OWNER" }],
    });
    expect(plan.steps[2]).toMatchObject({
      kind: "import-container",
      agents: ["codex"],
      tier: { managed: [], runtimes: expect.any(Array) },
    });
    const imported = plan.steps[2];
    expect(imported?.kind === "import-container" && imported.tier?.yaml).toContain("hostname: api");
  });

  // witness: packages/client-runtime/src/zerops/projectAccess.ts | : list.filter((entry) => asOrgRole(entry.roleCode) !== "OWNER"); → : list;
  it("drops its maker's recorded owner marker when an admin continues it, which Zerops refuses them", () => {
    const ada = { clientUserId: "ada", roleCode: "READ_ONLY" };
    const plan = continuedBirthPlan(
      { ...birth, intent: { ...birth.intent!, userRoles: [...birth.intent!.userRoles, ada] } },
      "org",
      undefined,
      "ADMIN",
    );
    expect(plan.ok && plan.steps[0]).toMatchObject({ kind: "create-project", userRoles: [ada] });
  });

  it.each([
    { name: "A clean Mate", role: "dev" as const, tier: null },
    { name: "D stage with a Mate", role: "stage" as const, tier: "stage" as const },
  ])("reconstructs $name with one create and one combined import", ({ role, tier }) => {
    const intent = {
      ...birth.intent!,
      placement: { ...birth.intent!.placement, role },
      recipe:
        tier !== null
          ? { kind: "tier" as const, id: "group" as const, revision: "original", tier }
          : { kind: "none" as const },
    };
    const plan = continuedBirthPlan(
      { ...birth, intent },
      "org",
      tier === null ? undefined : { ...recipe, tier },
      "OWNER",
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map(({ kind }) => kind)).toEqual([
      "create-project",
      "register",
      "import-container",
      "await-ready",
    ]);
  });
});
