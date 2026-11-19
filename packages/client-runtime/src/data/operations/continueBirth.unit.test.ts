import { expect, it } from "vite-plus/test";
import type { SharedBirth } from "../projections/birthProgress.ts";
import { continueBirth, type ContinueBirthPorts } from "./continueBirth.ts";

const birth: SharedBirth = {
  id: "birth",
  appId: "app",
  appName: "Shop",
  face: "rose:seal",
  projectId: null,
  importProcessId: null,
  placement: "unknown",
  intent: {
    projectName: "Shop - Ada",
    recipe: { kind: "none" },
    agents: ["codex"],
    standUp: false,
    automated: false,
    placement: { role: "dev", name: "Ada", chief: false },
    location: null,
    userRoles: [],
  },
  progress: { phase: "creating-project", next: { kind: "create" }, reason: null },
  canContinue: true,
  canDelete: true,
};

function birthWithBind(): SharedBirth {
  return {
    ...birth,
    progress: { phase: "creating-project", next: { kind: "bind", projectId: "p1" }, reason: null },
  };
}

function binding(canContinue: boolean) {
  let current = birthWithBind();
  const bound: Parameters<ContinueBirthPorts["bind"]>[] = [];
  const runs: Parameters<ContinueBirthPorts["run"]>[] = [];
  const ports = {
    read: () => current,
    bind: async (source, projectId) => {
      bound.push([source, projectId]);
      current = {
        ...current,
        projectId: "p1",
        placement: "unplaced",
        canContinue,
        progress: { phase: "project-created", next: { kind: "import" }, reason: null },
      };
    },
    waitForPlacement: async () => current,
    run: async (source, step) => {
      runs.push([source, step]);
    },
    attach: async () => {},
    recordImport: async () => {},
    registerChief: async () => {},
  } satisfies ContinueBirthPorts;
  return { ports, bound, runs };
}

// witness: packages/client-runtime/src/data/operations/continueBirth.ts | birth = await ports.waitForPlacement(projectId, "bound"); → birth = Object.assign({}, await ports.waitForPlacement(projectId, "bound"), { canContinue: birth.canContinue });
it("OP43: Continue re-reads the bound birth first and stops if the person lost their role", async () => {
  const { ports, bound, runs } = binding(false);
  expect(await continueBirth(ports)).toBe("unavailable");
  expect(bound).toEqual([[birthWithBind(), "p1"]]);
  expect(runs).toEqual([]);
});

// witness: packages/client-runtime/src/data/operations/continueBirth.ts | await ports.run(birth, "import"); → await ports.run(birth, "create");
it("OP44: Continue binds the one proven project and imports only when its placement is current", async () => {
  const { ports, bound, runs } = binding(true);
  expect(await continueBirth(ports)).toBe("started");
  expect(bound).toEqual([[birthWithBind(), "p1"]]);
  const current = ports.read();
  expect(runs).toEqual([[current, "import"]]);
  runs.length = 0;
  expect(
    await continueBirth({ ...ports, read: () => ({ ...current, placement: "unknown" }) }),
  ).toBe("waiting");
  expect(runs).toEqual([]);
});
