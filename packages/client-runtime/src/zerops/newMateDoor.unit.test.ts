import { expect, it } from "vite-plus/test";
import type { ZeropsCandidate } from "./candidates.ts";
import type { EnvironmentCreationStep } from "./createEnvironment.ts";
import type { ZeropsGroupPendingMember } from "./groups.ts";
import type { HqPlacement } from "./hq/placement.ts";
import {
  newMateDoor,
  newMateDoorMates,
  newMateGate,
  newMateRecipeChange,
  pressThrough,
} from "./newMateDoor.ts";
import type { FlowPullRequest } from "./projectFlow.ts";
import type { EnvironmentCreationStepProgress } from "./runEnvironmentCreation.ts";

const CLEO = { projectId: "cleo-project", name: "Cleo" };
const JUNO = { projectId: "juno-project", name: "Juno" };
const doorInput = {
  groupName: "Beviro",
  recipe: "absent",
  mates: [CLEO],
  change: undefined,
  rereading: false,
} as const;

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | if (mates.length === 0) return { kind: "open", recipe: "none" }; → if (mates.length === 1) return { kind: "open", recipe: "none" };
it("ZV22: A project takes another Mate while its recipe is being read or stands on main, an open change to it or not, and a project with no Mate yet takes its first without a recipe", () => {
  const present = { ...doorInput, recipe: "present" } as const;
  expect(newMateDoor(present)).toMatchObject({ kind: "open", recipe: "recipe" });
  expect(newMateDoor({ ...present, change: { number: 11, mate: "Cleo" } })).toMatchObject({
    kind: "open",
    recipe: "recipe",
  });
  expect(newMateDoor({ ...doorInput, recipe: "loading" })).toMatchObject({
    kind: "open",
    recipe: "reading",
  });
  const first = { ...doorInput, mates: [] };
  expect(newMateDoor(first)).toMatchObject({ kind: "open", recipe: "none" });
  expect(newMateDoor({ ...first, change: { number: 11, mate: undefined } })).toMatchObject({
    kind: "open",
    recipe: "none",
  });
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | action: { kind: "retry", label: "Try again", busy: input.rereading }, → action: { kind: "retry", label: "Try again", busy: false },
it("ZV23: A project whose recipe cannot be read takes no Mate, not even its first, and offers only to read it again, shown busy while that read runs", () => {
  const unreadable = { ...doorInput, recipe: "unreadable" } as const;
  expect(newMateDoor(unreadable)).toMatchObject({
    kind: "closed",
    action: { kind: "retry", busy: false },
  });
  expect(newMateDoor({ ...unreadable, rereading: true })).toMatchObject({
    kind: "closed",
    action: { kind: "retry", busy: true },
  });
  expect(newMateDoor({ ...unreadable, mates: [] })).toMatchObject({
    kind: "closed",
    action: { kind: "retry", busy: false },
  });
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | if (change !== undefined) { → if (change !== undefined && change.number < 0) {
it("ZV24: Without a recipe on main, a project whose Mates have one waiting in an open change takes no Mate and offers that change", () => {
  expect(newMateDoor({ ...doorInput, change: { number: 11, mate: "Cleo" } })).toMatchObject({
    kind: "closed",
    action: { kind: "change", number: 11 },
  });
  expect(
    newMateDoor({ ...doorInput, mates: [CLEO, JUNO], change: { number: 12, mate: undefined } }),
  ).toMatchObject({
    kind: "closed",
    action: { kind: "change", number: 12 },
  });
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | if (writer !== undefined && others.length === 0) { → if (writer !== undefined) {
it("ZV25: Without a recipe on main or a change holding it, the one Mate setting the project up is offered to open; while several are, nothing is offered", () => {
  expect(newMateDoor(doorInput)).toMatchObject({
    kind: "closed",
    action: { kind: "mate", projectId: "cleo-project" },
  });
  expect(newMateDoor({ ...doorInput, mates: [CLEO, JUNO] })).toMatchObject({
    kind: "closed",
    action: undefined,
  });
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | if (input.recipe !== "absent" || changes === undefined) return null; → if (changes === undefined) return null;
it("ZV26: Add a Mate stands off before it is pressed only where the recipe is read as absent, the project's changes are read and the door is closed; while either is unread, or the recipe cannot be read, Add stays on", () => {
  const NOVA = { projectId: "nova-project", name: "Nova" };
  const TEA = { projectId: "tea-project", name: "Tea" };
  const gate = {
    groupName: "Shop Front",
    recipe: "absent",
    mates: [NOVA],
    changes: [],
    mateName: () => undefined,
  } as const;
  expect(newMateGate(gate)).toBeTypeOf("string");
  expect(newMateGate({ ...gate, mates: [NOVA, TEA] })).toBeTypeOf("string");
  expect(newMateGate({ ...gate, recipe: "present" })).toBeNull();
  expect(newMateGate({ ...gate, recipe: "loading" })).toBeNull();
  expect(newMateGate({ ...gate, recipe: "unreadable" })).toBeNull();
  expect(newMateGate({ ...gate, changes: undefined })).toBeNull();
  expect(newMateGate({ ...gate, mates: [] })).toBeNull();
});

/** An open change on the project's repositories, as HQ streams it. */
function change(overrides: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "group",
    number: 11,
    title: "Mate: the group's import files",
    kind: "recipe",
    mateProjectId: "cleo-project",
    url: "https://hq.example.test/changes/beviro/group/11",
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "abc1234",
    baseBranch: "main",
    line: "#11",
    updatedAt: "2026-09-30T10:00:00Z",
    ...overrides,
  };
}

const names: Readonly<Record<string, string>> = { "cleo-project": "Cleo" };
const mateName = (id: string) => names[id];

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | if (first === undefined || pull.number < first.number) first = pull; → if (first === undefined || pull.number > first.number) first = pull;
it("ZV27: The change the recipe waits in is the open recipe proposal opened first; a code change or another change to the recipe is never it", () => {
  const proposal = (pullRequests: ReadonlyArray<FlowPullRequest>) =>
    newMateRecipeChange({ flow: { changesKnown: true, pullRequests }, mateName });
  expect(
    proposal([
      change({ repository: "appdev", kind: "code", number: 4, title: "Add a due date" }),
      change(),
    ]),
  ).toEqual({ number: 11, mate: "Cleo" });
  expect(proposal([change({ number: 14 }), change({ number: 12 })])).toEqual({
    number: 12,
    mate: "Cleo",
  });
  expect(proposal([change({ title: "Add a stage tier" })])).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | if (flow === undefined || !flow.changesKnown) return undefined; → if (flow === undefined) return undefined;
it("ZV28: No change is known to hold the recipe before the forge has answered for the project", () => {
  expect(
    newMateRecipeChange({ flow: { changesKnown: false, pullRequests: [change()] }, mateName }),
  ).toBeUndefined();
  expect(newMateRecipeChange({ flow: undefined, mateName })).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | .filter((member) => member.kind === "mate" && !held.has(member.projectId)) → .filter((member) => member.kind === "mate")
it("ZV29: A project's Mates are its listed Mates in the listing's order, then those still coming up that the listing does not hold yet, each once; its stage and production are not Mates", () => {
  /** A project of Beviro, placed by HQ as `kind`; a Mate under the name HQ records, if any. */
  function listed(
    id: string,
    kind: HqPlacement["kind"],
    name = `Beviro - ${id}`,
  ): { readonly item: ZeropsCandidate } {
    const hq: HqPlacement = {
      appId: "beviro",
      appName: "Beviro",
      kind,
      mate: kind === "mate" ? { face: "" } : null,
    };
    return {
      item: {
        key: `${id}:zcp`,
        project: {
          id,
          name,
          status: "ACTIVE",
          tagList: kind === "mate" ? ["mate"] : [],
          hq,
        },
        group: "ready",
        service: { id: "zcp", name: "zcp", status: "ACTIVE" },
      },
    };
  }
  function coming(
    projectId: string,
    kind: ZeropsGroupPendingMember["kind"],
    name: string,
  ): ZeropsGroupPendingMember {
    return { projectId, kind, name, startedAt: 0 };
  }

  const mates = newMateDoorMates({
    environments: [
      listed("cleo-project", "mate", "Cleo"),
      listed("stage-project", "stage"),
      listed("beviro-project", "mate"),
    ],
    pending: [
      coming("wren-project", "mate", "Wren"),
      coming("cleo-project", "mate", "Cleo"),
      coming("prod-project", "production", "Beviro - production"),
    ],
  });
  expect(mates).toEqual([
    { projectId: "cleo-project", name: "Cleo" },
    { projectId: "beviro-project", name: "beviro-project" },
    { projectId: "wren-project", name: "Wren" },
  ]);
});

// witness: packages/client-runtime/src/zerops/newMateDoor.ts | (step.kind === "register" && state === "failed"), → (step.kind === "register" && state === "done"),
it("ZV30: A Mate's press needs the browser no longer once every step before the wait is done and its registration went through or was refused", () => {
  // As a Mate's press runs (F6b): its record in its application before its one import.
  const plan: ReadonlyArray<EnvironmentCreationStep> = [
    { kind: "create-project", name: "Beviro - Ivo", tagList: [], location: undefined },
    { kind: "register" },
    { kind: "import-container", agents: [] },
    { kind: "await-ready", withAgent: true },
  ];
  const at = (states: ReadonlyArray<EnvironmentCreationStepProgress["state"]>, error?: string) =>
    plan.map((step, index) => ({
      step,
      state: states[index]!,
      ...(error !== undefined && states[index] === "failed" ? { error } : {}),
    }));

  expect(pressThrough(at(["done", "running", "queued", "queued"]))).toBe(false);
  expect(pressThrough(at(["done", "done", "running", "queued"]))).toBe(false);
  expect(pressThrough(at(["done", "done", "done", "running"]))).toBe(true);
  expect(pressThrough(at(["done", "failed", "done", "running"]))).toBe(true);
});
