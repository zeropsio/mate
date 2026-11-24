import type { HqOfferState } from "@t3tools/shared/hqOffers";
import type { ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";
import type { MateVisibility } from "./mateAccess.ts";
import { expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import type { ContainerLevel } from "./environments/containerMachine.ts";
import {
  mateArrivalOf,
  mateServicesToWrite,
  mateState,
  type MateFacts,
  type MateViewerFacts,
} from "./mateState.ts";

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
  offers: { held: true, edit: ALLOWED, detach: ALLOWED, setUp: ALLOWED },
  handsOver: true,
};

const facts = (over: Partial<MateFacts> = {}): MateFacts => ({
  candidate: RUNNING,
  level: { level: "ready", overdue: false },
  arrival: "none",
  deletionGoing: false,
  placementKnown: true,
  viewer: OWNER,
  ...over,
});

// witness: packages/client-runtime/src/zerops/mateState.ts | return going || PROJECT_GOING_STATUSES.has(status); → return PROJECT_GOING_STATUSES.has(status);
it("ZV155: A Mate whose deletion HQ runs is not offered Delete again while the listing still holds it; breaks: a second Delete pressed on a Mate whose first one is under way", () => {
  expect(mateState(facts()).verbs.delete).toBe(true);
  const asked = mateState(facts({ deletionGoing: true }));
  expect(asked.deleting).toBe(true);
  expect(asked.verbs.delete).toBe(false);
});

// witness: packages/client-runtime/src/zerops/mateState.ts | candidate.project.hq === undefined && → false &&
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

// witness: packages/client-runtime/src/zerops/mateState.ts | record?.edit.kind === "allowed" && mate; → record?.edit.kind === "allowed" && mate && candidate.creationFailed === undefined;
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
              viewer: {
                ...OWNER,
                role,
                offers: { held: true, edit, detach, setUp: ALLOWED },
                handsOver,
              },
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
  // A project the platform failed to create uses the same HQ Delete offer as its row's Remove.
  const { service: _service, ...withoutService } = RUNNING;
  const failed = {
    ...withoutService,
    group: "unavailable" as const,
    creationFailed: { message: "" },
  };
  for (const [edit, , deletes] of edits) {
    expect(
      mateState(
        facts({
          candidate: failed,
          arrival: "failed",
          viewer: { ...OWNER, offers: { held: true, edit, detach: ALLOWED, setUp: ALLOWED } },
        }),
      ).verbs.delete,
    ).toBe(deletes);
  }
  for (const offers of [{ held: false, createRecord: ALLOWED } as const, undefined]) {
    expect(
      mateState(facts({ candidate: failed, arrival: "failed", viewer: { ...OWNER, offers } })).verbs
        .delete,
    ).toBe(false);
  }
});

// witness: packages/client-runtime/src/zerops/mateState.ts | : mayWork && viewer.visibility === "open"); → : mayWork);
it("ZV159: Start, Stop, Restart and Redeploy are offered only to a viewer who may operate the Mate, never to one who may only see it or whose role only reads its project, nor to a viewer the surface does not know; breaks: a Read-only viewer's menu or Mate page offers Restart", () => {
  const roles: Readonly<Record<ZeropsOrgRole, boolean>> = {
    OWNER: true,
    ADMIN: true,
    BASIC_USER: true,
    READ_ONLY: false,
    NO_ACCESS: false,
  };
  const visibilities: ReadonlyArray<readonly [MateVisibility | undefined, boolean]> = [
    ["open", true],
    ["listed", false],
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
      expect(mateState(facts({ viewer })).verbs.stop).toBe(operates);
      expect(mateState(facts({ viewer, candidate: stopped })).verbs.start).toBe(operates);
      expect(mateState(facts({ viewer, arrival: "redeploy" })).verbs.redeploy).toBe(operates);
    }
  }
  expect(mateState(facts({ viewer: null })).verbs).toMatchObject({
    start: false,
    stop: false,
    restart: false,
    redeploy: false,
    delete: false,
    access: false,
  });
});

/** A stopped project HQ places nowhere, with no Mate container: Zerops' alone. */
const { hq: _noPlacement, ...PLAIN_PROJECT } = RUNNING.project;
const STOPPED_PLAIN: ZeropsCandidate = {
  key: "p-rye:plain",
  group: "unavailable",
  project: { ...PLAIN_PROJECT, status: "STOPPED" },
};
const plainViewer = (role: ZeropsOrgRole): MateViewerFacts => ({
  role,
  visibility: undefined,
  offers: undefined,
  handsOver: false,
});

// witness: packages/client-runtime/src/zerops/mateState.ts | ? facts.placementKnown && mayWork → ? facts.placementKnown
it("ZV173: A Read-only person is offered no Start on a stopped project HQ does not place; breaks: a person Zerops refuses is offered a write on a plain project", () => {
  const state = mateState(facts({ candidate: STOPPED_PLAIN, viewer: plainViewer("READ_ONLY") }));
  expect(state.operates).toBe(false);
  expect(state.verbs.start).toBe(false);
});

// witness: packages/client-runtime/src/zerops/mateState.ts | ? facts.placementKnown && mayWork → ? false
it("ZV174: An Owner is offered Start on a stopped project HQ does not place, which has no entry from HQ; breaks: an Owner cannot start their own plain project", () => {
  const state = mateState(facts({ candidate: STOPPED_PLAIN, viewer: plainViewer("OWNER") }));
  expect(state.operates).toBe(true);
  expect(state.verbs.start).toBe(true);
});

// witness: packages/client-runtime/src/zerops/mateState.ts | ? facts.placementKnown && mayWork → ? mayWork
it("ZV175: Before HQ's first answer, and on a placed Mate whose entry has not arrived, nobody is offered a write that needs a role, an Owner included; breaks: a Read-only person is offered Start for as long as HQ takes to answer", () => {
  const before = mateState(
    facts({ candidate: STOPPED_PLAIN, placementKnown: false, viewer: plainViewer("OWNER") }),
  );
  expect([before.operates, before.verbs.start]).toEqual([false, false]);
  const placedStopped: ZeropsCandidate = {
    ...STOPPED_PLAIN,
    project: { ...RUNNING.project, status: "STOPPED" },
  };
  const unentered = mateState(
    facts({ candidate: placedStopped, viewer: { ...OWNER, visibility: undefined } }),
  );
  expect([unentered.operates, unentered.verbs.start]).toEqual([false, false]);
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

// witness: packages/client-runtime/src/zerops/mateState.ts | !isStopped(candidate) && → true &&
it("ZV+1: Stop is offered on a running project that holds its Mate container, never where that container is stopped, where the platform is starting or stopping either, or where the project holds no container; breaks: a Mate whose container is stopped offers Stop beside Start", () => {
  const { service: _service, ...containerless } = RUNNING;
  for (const [project, service, stop] of [
    ["ACTIVE", "ACTIVE", true],
    ["ACTIVE", "FAILED", true],
    ["ACTIVE", "STOPPED", false],
    ["ACTIVE", "STOPPING", false],
    ["ACTIVE", "STARTING", false],
    ["STOPPED", "STOPPED", false],
    ["STOPPING", "ACTIVE", false],
    ["STARTING", "STOPPED", false],
    ["ACTIVE", undefined, false],
  ] as const) {
    const candidate: ZeropsCandidate = {
      ...containerless,
      project: { ...RUNNING.project, status: project },
      ...(service === undefined ? {} : { service: { id: "s-zcp", name: "zcp", status: service } }),
    };
    expect(mateState(facts({ candidate })).verbs.stop).toBe(stop);
  }
});

// witness: packages/client-runtime/src/zerops/mateState.ts | ...touched.filter((service) => !isZcpService(service)), → ...touched,
it("ZV+3: A Mate's Stop writes each running service of its project and its Start each stopped one, never a platform service, its Mate container last; breaks: a Stop refused partway has stopped the Mate's own computer and left its app running", () => {
  const services = [
    { id: "zcp", name: "zcp", status: "ACTIVE", base: "zcp@1" },
    { id: "appdev", name: "appdev", status: "ACTIVE", base: "nodejs@24" },
    { id: "core", name: "core", status: "ACTIVE", isSystem: true },
    { id: "db", name: "db", status: "STOPPED", base: "postgresql@17" },
    { id: "appstage", name: "appstage", status: "ACTIVE", base: "nodejs@24" },
  ];
  expect(mateServicesToWrite("stop", services)).toEqual(["appdev", "appstage", "zcp"]);
  expect(
    mateServicesToWrite(
      "start",
      services.map((service) => ({ ...service, status: "STOPPED" })),
    ),
  ).toEqual(["appdev", "db", "appstage", "zcp"]);
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
