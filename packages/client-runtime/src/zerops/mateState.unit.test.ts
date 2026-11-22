import type { HqOfferState } from "@t3tools/shared/hqOffers";
import type { RoleMateVisibility, ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";
import { expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import type { ContainerLevel } from "./environments/containerMachine.ts";
import { mateArrivalOf, mateState, type MateFacts, type MateViewerFacts } from "./mateState.ts";

const ALLOWED: HqOfferState = { kind: "allowed" };
const REFUSED: HqOfferState = { kind: "refused", reason: "not yours" };
const UNSAID: HqOfferState = { kind: "unknown" };

/** A running Mate in an active project, placed by HQ in an application. */
const RUNNING: ZeropsCandidate = {
  key: "p-rye:s-zcp",
  group: "connected",
  project: {
    id: "p-rye",
    name: "bakery-rye",
    status: "ACTIVE",
    hq: { appId: "app-bakery", appName: "Bakery", kind: "mate", mate: null },
  },
  service: { id: "s-zcp", name: "zcp", status: "ACTIVE" },
};

/** The project's OWNER, whom HQ offers the record and leaving its application. */
const OWNER: MateViewerFacts = {
  role: "OWNER",
  visibility: "open",
  offers: { held: true, edit: ALLOWED, detach: ALLOWED },
  handsOver: true,
};

const facts = (over: Partial<MateFacts> = {}): MateFacts => ({
  candidate: RUNNING,
  level: { level: "ready", overdue: false },
  arrival: "none",
  pressed: false,
  deleteAsked: false,
  placementKnown: true,
  viewer: OWNER,
  ...over,
});

// witness: packages/client-runtime/src/zerops/mateState.ts | return asked || PROJECT_GOING_STATUSES.has(status); → return PROJECT_GOING_STATUSES.has(status);
it("ZV155: A Mate this tab asked the platform to delete is not offered Delete again while the listing still holds it; breaks: a second Delete pressed on a Mate whose first one is under way", () => {
  expect(mateState(facts()).verbs.delete).toBe(true);
  const asked = mateState(facts({ deleteAsked: true }));
  expect(asked.deleting).toBe(true);
  expect(asked.verbs.delete).toBe(false);
});

// witness: packages/client-runtime/src/zerops/mateState.ts | facts.placementKnown && → false &&
it("ZV157: A Mate the platform is deleting, or one HQ's current placement does not hold while no birth or press brings it up, is read so and offers no verb at all; breaks: a Mate whose row reads Deleting… or Not in this HQ still offers Restart and Delete in its menu", () => {
  const { hq: _placed, ...unplacedProject } = RUNNING.project;
  const unplaced: ZeropsCandidate = { ...RUNNING, project: unplacedProject };
  const rows: ReadonlyArray<
    readonly [Partial<MateFacts>, { deleting: boolean; outsideHq: boolean; menu: "none" | "verbs" }]
  > = [
    [{}, { deleting: false, outsideHq: false, menu: "verbs" }],
    ...(["DELETING", "DELETED"] as const).map(
      (status) =>
        [
          { candidate: { ...RUNNING, project: { ...RUNNING.project, status } } },
          { deleting: true, outsideHq: false, menu: "none" },
        ] as const,
    ),
    [{ candidate: unplaced }, { deleting: false, outsideHq: true, menu: "none" }],
    // HQ's placement not current yet: nothing says it is outside.
    [
      { candidate: unplaced, placementKnown: false },
      { deleting: false, outsideHq: false, menu: "verbs" },
    ],
    // Something brings it up: HQ's record follows.
    [
      { candidate: unplaced, pressed: true },
      { deleting: false, outsideHq: false, menu: "verbs" },
    ],
    [
      { candidate: unplaced, arrival: "failed" },
      { deleting: false, outsideHq: false, menu: "verbs" },
    ],
  ];
  for (const [over, expected] of rows) {
    const state = mateState(facts(over));
    expect({ deleting: state.deleting, outsideHq: state.outsideHq, menu: state.menu }).toEqual(
      expected,
    );
    if (state.menu === "none") {
      expect(Object.values(state.verbs).every((verb) => verb === false || verb === "no")).toBe(
        true,
      );
    }
  }
});

// witness: packages/client-runtime/src/zerops/mateState.ts | record?.edit.kind === "allowed" && mate && candidate.creationFailed === undefined; → record !== undefined && mate && candidate.creationFailed === undefined;
it("ZV158: Delete, Change face and Move are offered only where HQ offers the viewer the Mate's record (edit_mate_record), drawn held while HQ has not said, and Leave as HQ offers its detach; Rename only to its project's OWNER or ADMIN, Hand over only to an organization owner or admin; breaks: a project admin HQ refuses the record is offered Delete", () => {
  const roles: Readonly<Record<ZeropsOrgRole, boolean>> = {
    OWNER: true,
    ADMIN: true,
    BASIC_USER: false,
    READ_ONLY: false,
    NO_ACCESS: false,
  };
  const edits: ReadonlyArray<readonly [HqOfferState, "offered" | "held" | "no", boolean]> = [
    [ALLOWED, "offered", true],
    [UNSAID, "held", false],
    [REFUSED, "no", false],
  ];
  for (const [role, renames] of Object.entries(roles) as ReadonlyArray<[ZeropsOrgRole, boolean]>) {
    for (const [edit, hqVerb, deletes] of edits) {
      for (const [detach, leave] of edits) {
        for (const handsOver of [true, false]) {
          const { verbs } = mateState(
            facts({
              viewer: { ...OWNER, role, offers: { held: true, edit, detach }, handsOver },
            }),
          );
          expect(verbs).toMatchObject({
            delete: deletes,
            face: hqVerb,
            move: hqVerb,
            leave,
            rename: renames,
            assign: handsOver,
          });
        }
      }
    }
  }
  // HQ holds no record of it, or has not said at all: none of its record's verbs.
  for (const offers of [{ held: false, createRecord: ALLOWED } as const, undefined]) {
    expect(mateState(facts({ viewer: { ...OWNER, offers } })).verbs).toMatchObject({
      delete: false,
      face: "no",
      move: "no",
      leave: "no",
    });
  }
  // A Mate in no application has nothing to leave.
  const ungrouped = {
    ...RUNNING,
    project: {
      ...RUNNING.project,
      hq: { appId: null, appName: null, kind: "mate" as const, mate: {} },
    },
  };
  expect(mateState(facts({ candidate: ungrouped })).verbs.leave).toBe("no");
  // A project the platform failed to create is its row's Remove, never Delete.
  const failed = { ...RUNNING, group: "unavailable" as const, creationFailed: { message: "" } };
  expect(mateState(facts({ candidate: failed })).verbs.delete).toBe(false);
});

// witness: packages/client-runtime/src/zerops/mateState.ts | viewer.visibility !== "listed" && → true &&
it("ZV159: Start, Restart and Redeploy are offered only to a viewer who may operate the Mate, never to one who may only see it or whose role only reads its project, nor to a viewer the surface does not know; breaks: a Read-only viewer's menu or Mate page offers Restart", () => {
  const roles: Readonly<Record<ZeropsOrgRole, boolean>> = {
    OWNER: true,
    ADMIN: true,
    BASIC_USER: true,
    READ_ONLY: false,
    NO_ACCESS: false,
  };
  const visibilities: ReadonlyArray<readonly [RoleMateVisibility | undefined, boolean]> = [
    ["open", true],
    [undefined, true],
    ["listed", false],
    ["hidden", false],
  ];
  const stopped: ZeropsCandidate = {
    ...RUNNING,
    group: "unavailable",
    service: { id: "s-zcp", name: "zcp", status: "STOPPED" },
  };
  for (const [role, roleOperates] of Object.entries(roles) as ReadonlyArray<
    [ZeropsOrgRole, boolean]
  >) {
    for (const [visibility, seen] of visibilities) {
      const viewer = { ...OWNER, role, visibility };
      const operates = roleOperates && seen;
      expect(mateState(facts({ viewer })).verbs.restart).toBe(operates);
      expect(mateState(facts({ viewer, candidate: stopped })).verbs.start).toBe(operates);
      expect(mateState(facts({ viewer, arrival: "redeploy" })).verbs.redeploy).toBe(operates);
    }
  }
  expect(mateState(facts({ viewer: null })).verbs).toMatchObject({
    start: false,
    restart: false,
    redeploy: false,
    delete: false,
    access: false,
  });
});

// witness: packages/client-runtime/src/zerops/mateState.ts | (level === undefined || !COMING_UP.has(level.level) || level.overdue), → (level === undefined || !COMING_UP.has(level.level) || true),
it("ZV160: Restart is offered on an active project and container unless the platform or our own verb is already bringing it up and has not run past its cap, and Start only on a stopped Mate the platform is not moving; breaks: the menu offers a second Restart while the first is still coming up", () => {
  const restarts: Readonly<Record<ContainerLevel["level"], boolean>> = {
    unknown: true,
    ready: true,
    creating: false,
    provisioning: false,
    booting: true,
    restarting: false,
    updating: false,
    "needs-enable": true,
    "needs-update": true,
    "not-yet-available": true,
    inactive: true,
  };
  for (const [level, restart] of Object.entries(restarts) as ReadonlyArray<
    [ContainerLevel["level"], boolean]
  >) {
    expect(mateState(facts({ level: { level, overdue: false } })).verbs.restart).toBe(restart);
    // Past its cap, a stuck start is the person's to restart.
    expect(mateState(facts({ level: { level, overdue: true } })).verbs.restart).toBe(true);
  }
  expect(mateState(facts({ level: undefined })).verbs.restart).toBe(true);
  // The platform's word on its container: only ACTIVE in an ACTIVE project restarts.
  for (const [project, service, restart] of [
    ["ACTIVE", "ACTIVE", true],
    ["ACTIVE", "STOPPED", false],
    ["STOPPED", "ACTIVE", false],
    ["ACTIVE", "RESTARTING", false],
  ] as const) {
    const candidate = {
      ...RUNNING,
      project: { ...RUNNING.project, status: project },
      service: { id: "s-zcp", name: "zcp", status: service },
    };
    expect(mateState(facts({ candidate })).verbs.restart).toBe(restart);
  }
  // A row without `service` has no container in its project.
  const starts: ReadonlyArray<readonly [Partial<ZeropsCandidate>, boolean]> = [
    [{ group: "unavailable", service: { id: "s", name: "zcp", status: "STOPPED" } }, true],
    [
      {
        group: "unavailable",
        project: { ...RUNNING.project, status: "STOPPED" },
      },
      true,
    ],
    [{ group: "ready", service: { id: "s", name: "zcp", status: "STOPPED" } }, false],
    [
      {
        group: "unavailable",
        project: { ...RUNNING.project, status: "STOPPED" },
        service: { id: "s", name: "zcp", status: "STARTING" },
      },
      false,
    ],
    [
      {
        group: "unavailable",
        project: { ...RUNNING.project, status: "STOPPING" },
        service: { id: "s", name: "zcp", status: "STOPPED" },
      },
      false,
    ],
    [
      {
        group: "unavailable",
        project: { ...RUNNING.project, status: "STOPPED" },
        missingContainer: true,
      },
      false,
    ],
    [
      {
        group: "unavailable",
        service: { id: "s", name: "zcp", status: "STOPPED" },
        creationFailed: { message: undefined },
      },
      false,
    ],
  ];
  const { service: _service, ...containerless } = RUNNING;
  for (const [over, start] of starts) {
    const candidate = { ...(over.service === undefined ? containerless : RUNNING), ...over };
    expect(mateState(facts({ candidate })).verbs.start).toBe(start);
  }
});

// witness: packages/client-runtime/src/zerops/mateState.ts | if (facts.arrival === "coming") return state("setup", { ...NO_VERBS, delete: remove }); → if (false) return state("setup", { ...NO_VERBS, delete: remove });
it("ZV161: A Mate whose shared birth is open holds its birth's own menu, one still coming up holds Delete alone, and one whose container has no deployment offers Redeploy and no Start; breaks: a Mate whose setup stalls offers Restart beside Delete", () => {
  expect(mateArrivalOf(undefined)).toBe("none");
  expect(mateArrivalOf({ kind: "coming", birth: { attention: false } })).toBe("birth");
  expect(mateArrivalOf({ kind: "coming" })).toBe("coming");
  expect(mateArrivalOf({ kind: "failed", verb: "redeploy" })).toBe("redeploy");
  expect(mateArrivalOf({ kind: "failed", verb: "remove" })).toBe("failed");

  const birth = mateState(facts({ arrival: "birth" }));
  expect(birth.menu).toBe("birth");
  expect(birth.verbs.restart).toBe(false);

  const coming = mateState(facts({ arrival: "coming" }));
  expect(coming.menu).toBe("setup");
  expect(
    Object.entries(coming.verbs).filter(([, verb]) => verb !== false && verb !== "no"),
  ).toEqual([["delete", true]]);

  const stoppedNoDeploy = {
    ...RUNNING,
    group: "unavailable" as const,
    service: { id: "s-zcp", name: "zcp", status: "STOPPED" },
  };
  const redeploy = mateState(facts({ candidate: stoppedNoDeploy, arrival: "redeploy" }));
  expect(redeploy.verbs.redeploy).toBe(true);
  expect(redeploy.verbs.start).toBe(false);
  expect(mateState(facts({ candidate: stoppedNoDeploy })).verbs.redeploy).toBe(false);
});
