import { describe, expect, it, vi } from "vite-plus/test";

import type { ProjectServices } from "@t3tools/client-runtime/data";
import { Atom, AtomRegistry } from "effect/reactivity";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  addedMateBirth,
  environmentProjectName,
  untilServicesSettled,
} from "./useEnvironmentCreation";

describe("addedMateBirth — the birth intent an added Mate is pressed under", () => {
  const record = () => vi.fn(async () => "b-gus");

  // F6c (2026-10-03): recorded at HQ before its project exists, so a press cut off between the
  // project and its attach is finished where and as it was asked for, in any browser. Audit B3:
  // with the person's stand-up ask — a dev Mate's — which its attach records with the Mate.
  it.each([
    {
      case: "a dev Mate, asking its stand-up",
      role: "dev" as const,
      recipe: { kind: "tier" as const, tier: "mate" as const, yaml: "services: []" },
      standUp: true,
    },
    {
      case: "a devstage Mate, asking none",
      role: "devstage" as const,
      recipe: { kind: "tier" as const, tier: "mate" as const, yaml: "services: []" },
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
      }),
    ).toBe("b-gus");
    // D3: its name is its project's, never HQ's.
    expect(recorded).toHaveBeenCalledWith({ appId: "app-g", face: "rose:seal", standUp });
  });

  it.each([
    { case: "a stage, its agent and all", role: "stage" as const, withAgent: true },
    { case: "a production", role: "prod" as const, withAgent: false },
    { case: "a dev environment with no agent", role: "dev" as const, withAgent: false },
  ])("records none for $case: no Mate is born", async ({ role, withAgent }) => {
    const recorded = record();
    expect(
      await addedMateBirth(recorded, {
        groupId: "app-g",
        role,
        choice: { withAgent, recipe: { kind: "none" } },
      }),
    ).toBeUndefined();
    expect(recorded).not.toHaveBeenCalled();
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

  it("stops where the account it waits in closes", async () => {
    openAccountLifetime("account-1");
    const registry = AtomRegistry.make();
    const waiting = untilServicesSettled(registry, Atom.make(listing({})));
    closeAccountLifetime();
    await expect(waiting).rejects.toThrow("This account session has ended.");
  });
});
