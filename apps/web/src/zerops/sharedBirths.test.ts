import { describe, expect, it } from "vite-plus/test";
import type { SharedBirth, SharedBirthState } from "@t3tools/client-runtime/data";
import { Atom, AtomRegistry } from "effect/reactivity";
import { placedSharedBirths, sharedBirthPresentation, waitForBirthPlacement } from "./sharedBirths";

const birth: SharedBirth = {
  id: "b1",
  appId: "a1",
  appName: "Shop",
  face: "",
  projectId: null,
  importProcessId: null,
  placement: "unknown",
  intent: {
    projectName: "Shop - Ada",
    recipe: { kind: "none" },
    agents: [],
    standUp: false,
    automated: false,
    placement: { role: "dev", name: "Ada", chief: false },
    location: null,
    userRoles: [],
  },
  progress: { phase: "creating-project", next: { kind: "unknown" }, reason: null },
  canContinue: false,
  canDelete: true,
};

describe("shared births in the group tree", () => {
  it('Decision: A birth that stopped (closed window, refused request, failed import, container never up, no hello yet) shows the last proven phase and, where known, the Zerops reason, and offers exactly two actions, Continue and Delete; it never renders as an ordinary unreachable Mate and never as "Coming up" for a Mate that is already linked.', () => {
    expect(sharedBirthPresentation(birth)).toMatchObject({
      line: "Creating project · Outcome unknown — waiting for Zerops",
      actions: ["delete"],
    });
    expect(
      sharedBirthPresentation({
        ...birth,
        progress: { phase: "project-created", next: { kind: "import" }, reason: "Quota reached." },
        canContinue: true,
      }),
    ).toMatchObject({ line: "Project created · Quota reached.", actions: ["continue", "delete"] });
    expect(
      sharedBirthPresentation({
        ...birth,
        progress: { phase: "import-accepted", next: { kind: "blocked" }, reason: "No capacity." },
      }),
    ).toMatchObject({ line: "Import accepted · No capacity.", actions: ["delete"] });
    expect(
      sharedBirthPresentation({
        ...birth,
        progress: { phase: "container-starting", next: { kind: "wait" }, reason: null },
        canContinue: true,
      }),
    ).toMatchObject({
      line: "Container starting · Waiting for the Mate to link",
      actions: ["continue", "delete"],
    });
    expect(sharedBirthPresentation({ ...birth, continueRequiresAdmin: true })).toMatchObject({
      line: "Creating project · Outcome unknown — waiting for Zerops · An organization or project administrator can continue.",
    });
  });
  it("keeps one durable row as HQ binds a project, even when this tab has local creation state", () => {
    const local = [
      {
        intent: "b1",
        projectId: "b1",
        startedAt: 123,
        placement: { groupId: "a1", groupName: "Shop", kind: "mate" as const, displayName: "Ada" },
      },
    ];
    expect(placedSharedBirths([birth], local)).toEqual([
      {
        intent: "b1",
        projectId: "b1",
        placement: { groupId: "a1", groupName: "Shop", kind: "mate", displayName: "Ada" },
      },
    ]);
    expect(
      placedSharedBirths(
        [{ ...birth, projectId: "p1" }],
        [...local, { ...local[0]!, projectId: "p1" }],
      ),
    ).toEqual([
      {
        intent: "b1",
        projectId: "p1",
        placement: { groupId: "a1", groupName: "Shop", kind: "mate", displayName: "Ada" },
      },
    ]);
  });
});

it("waits for a birth's binding from the shared source and stops when authority is lost", async () => {
  const registry = AtomRegistry.make();
  const first = {
    ...birth,
    canContinue: true,
    progress: {
      phase: "creating-project" as const,
      next: { kind: "bind" as const, projectId: "p1" },
      reason: null,
    },
  };
  const source = Atom.make<SharedBirthState>({ open: [first], readyProjectIds: [] });
  const options = {
    birthId: "b1",
    projectId: "p1",
    placement: "bound" as const,
    active: () => true,
  };
  const waiting = waitForBirthPlacement(registry, source, options);
  const bound = { ...first, projectId: "p1", placement: "unplaced" as const };
  registry.set(source, { open: [bound], readyProjectIds: [] });
  expect(await waiting).toEqual(bound);

  const attaching = waitForBirthPlacement(registry, source, { ...options, placement: "attached" });
  registry.set(source, { open: [{ ...bound, canContinue: false }], readyProjectIds: [] });
  expect(await attaching).toBeUndefined();
  registry.dispose();
});
