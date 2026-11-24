import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";

import { addedMateBirth, mateSetUpBirth } from "../../zerops/mateBirths.logic.ts";
import { readAccessGrantChanges } from "../../zerops/readAccessRequests.logic.ts";
import { teamMemberChange } from "../settings/teamSettings.logic.ts";
import { newProjectIntent, type NewProjectAsk } from "../../zerops/newProjectBirth.ts";
import { chiefOverviewWay, chiefPageView } from "./chief/chiefTop.logic.ts";
import { hqProjectsChanges } from "./projects/projectPeople.logic.ts";

// witness: apps/web/src/zerops/mateBirths.logic.ts | role: input.kind === "mate" ? "dev" : "stage", → role: "dev",
it("MN64: A stage added with its own Mate is created in the card's application and placed as a stage, and an added Mate as a Mate; breaks: Add stage makes a second dev Mate", () => {
  const added = (kind: "mate" | "devstage") => {
    const birth = addedMateBirth({
      groupId: "app-1",
      role: kind === "mate" ? "dev" : "stage",
      kind,
      choice: { withAgent: true, recipe: { kind: "none" } },
      projectName: "Shop - Stage",
      displayName: "Stage",
      agents: [],
      userRoles: [],
      tier: undefined,
    });
    return [birth.appId, birth.intent.placement];
  };
  expect(added("devstage")).toEqual(["app-1", { role: "stage", name: "Stage", chief: false }]);
  expect(added("mate")).toEqual(["app-1", { role: "dev", name: "Stage", chief: false }]);
});

// witness: apps/web/src/zerops/mateBirths.logic.ts | projectId: input.project.id, → projectId: input.id,
it("MN65: Set up Mate's Create names the project it was pressed on, under the press's own birth id; breaks: HQ makes a new project beside the one the person chose", () => {
  const birth = mateSetUpBirth({
    id: "b1",
    project: { id: "p1", name: "shop", status: "ACTIVE" },
    candidates: [],
    agents: [],
    owner: null,
  });
  expect([birth.id, birth.projectId, birth.intent.placement.role]).toEqual(["b1", "p1", "dev"]);
});

// witness: apps/web/src/zerops/newProjectBirth.ts | chief: ask.chief === true → chief: false
it("MN55: Only a Chief's Create is placed as a Chief; breaks: Set up Chief makes an ordinary Mate, or New project makes a Chief", () => {
  const ask: NewProjectAsk = {
    organizationId: "org-1",
    creator: "cu-1",
    birthId: "b1",
    name: "Shop",
    botName: "Rye",
    face: { tint: "slate", shape: "squircle" },
    locationId: null,
    agents: [],
  };
  expect([
    newProjectIntent({ ...ask, chief: true }).placement.chief,
    newProjectIntent(ask).placement.chief,
  ]).toEqual([true, false]);
});

// witness: apps/web/src/components/zerops/chief/chiefTop.logic.ts | if (own !== null) return { kind: "coming", projectId: own }; → if (own === "never") return { kind: "coming", projectId: own };
it("MN56: The Chief page offers Set up Chief only to a person known to have none, shows one they have coming, and holds its frame while that is unknown; breaks: a person with a Chief is offered a second", () => {
  const view = (own: string | null | undefined) =>
    chiefPageView({ own, setup: { phase: "idle" }, mayCreate: true });
  expect([view(null), view("p1"), view(undefined)]).toEqual([
    { kind: "offer", blocked: undefined },
    { kind: "coming", projectId: "p1" },
    { kind: "reading" },
  ]);
});

// witness: apps/web/src/components/zerops/chief/chiefTop.logic.ts | return threadRef === null → return threadRef !== null
it("MN57: A Chief's Overview opens in its conversation's panel, and on the Overview page where it has none; breaks: the header leads nowhere from a Chief with no conversation", () => {
  const threadRef = {
    environmentId: EnvironmentId.make("env-chief"),
    threadId: ThreadId.make("thread-chief"),
  };
  expect([chiefOverviewWay(null), chiefOverviewWay(threadRef)]).toEqual([
    { kind: "page", to: "/zerops" },
    { kind: "panel", threadRef, panel: "overview" },
  ]);
});

// witness: apps/web/src/components/zerops/projects/projectPeople.logic.ts | set: theirs.map(({ projectId, roleCode }) => ({ projectId, roleCode })), → set: changes.map(({ projectId, roleCode }) => ({ projectId, roleCode })),
it("MN58: An access press starts one change per person, each holding only that person's grants, a dropped grant included; breaks: one person's press changes another's access", () => {
  const members: ReadonlyArray<ZeropsOrganizationMember> = [
    { id: "cu-ada", user: { id: "ada" } },
    { id: "cu-ben", user: { id: "ben" } },
  ];
  expect(
    hqProjectsChanges(
      [
        { clientUserId: "cu-ada", projectId: "p1", roleCode: "READ_ONLY" },
        { clientUserId: "cu-ben", projectId: "p2", roleCode: null },
      ],
      members,
    ),
  ).toEqual([
    { kind: "projects", userId: "ada", set: [{ projectId: "p1", roleCode: "READ_ONLY" }] },
    { kind: "projects", userId: "ben", set: [{ projectId: "p2", roleCode: null }] },
  ]);
});

// witness: apps/web/src/components/settings/teamSettings.logic.ts | const userId = person.userId; → const userId = person.key;
it("MN60: A role, grant or removal pressed on a person's Team page is one change naming them by their Zerops account, and none is sent for a person Zerops names no account of; breaks: HQ is asked to change a membership id it names nobody by", () => {
  const guest = {
    roleCode: "GUEST",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
  };
  expect([
    teamMemberChange({ key: "cu-1", userId: "u1" }, { kind: "role", membership: guest }),
    teamMemberChange({ key: "cu-1", userId: "u1" }, { kind: "remove" }),
    teamMemberChange({ key: "cu-2", userId: undefined }, { kind: "role", membership: guest }),
  ]).toEqual([
    { kind: "role", userId: "u1", membership: guest },
    { kind: "remove", userId: "u1" },
    null,
  ]);
});

// witness: apps/web/src/zerops/readAccessRequests.logic.ts | requestId: request.id → requestId: request.projectId
it("MN61: Granting a read access request starts one readAccess change naming that request; breaks: HQ is asked to grant a request it does not hold, and the asker gets no access", () => {
  expect(
    readAccessGrantChanges(
      { id: "ask-1", userId: "u1", projectId: "p1", askedAt: "2026-11-23T08:00:00Z" },
      "change-1",
    ),
  ).toEqual([{ id: "change-1", change: { kind: "readAccess", requestId: "ask-1" } }]);
});
