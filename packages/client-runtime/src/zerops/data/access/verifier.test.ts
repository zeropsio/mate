import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { ProjectStanding } from "../../../data/projections/projects.ts";
import type { ZeropsProject, ZeropsUser } from "../../api.ts";
import { account, organization, project as projectRef } from "../__fixtures__/index.ts";
import { ZeropsOrganizationId, ZeropsProjectId, type ProjectRef } from "../types.ts";
import type { GrantEvent } from "./grant.ts";
import {
  makeRestAccessVerifier,
  operableProjectAccess,
  RECENT_USER_MS,
  type RestAccessVerifierOptions,
} from "./verifier.ts";

const orgId = organization.organizationId;
const user: ZeropsUser = {
  id: account.accountId,
  email: "person@example.test",
  clientUserList: [{ id: "membership", clientId: orgId, roleCode: "OWNER" }],
};
const project = (id: string, roleCode?: string): ZeropsProject => ({
  id,
  clientId: orgId,
  name: id,
  status: "ACTIVE",
  ...(roleCode === undefined ? {} : { userRoles: [{ clientUserId: "membership", roleCode }] }),
});
const elsewhere: ProjectRef = {
  kind: "project",
  organization: { ...organization, organizationId: ZeropsOrganizationId.make("left-org") },
  projectId: ZeropsProjectId.make("elsewhere"),
};

/** The account's store, as the verifier asks it: every project listed with its row, by default. */
type Standings = (project: ProjectRef) => ProjectStanding;
const listed =
  (roleCode?: string): Standings =>
  (ref) => ({ kind: "listed", project: project(ref.projectId, roleCode) });

const verifierOver = (
  options: {
    readonly fetchUser?: () => Promise<ZeropsUser>;
    readonly standing?: Standings;
    readonly recentUser?: RestAccessVerifierOptions["recentUser"];
  } = {},
) => {
  const users: ZeropsUser[] = [];
  const asked: string[] = [];
  const standing = options.standing ?? listed();
  const verifier = makeRestAccessVerifier({
    client: { fetchUser: options.fetchUser ?? (async () => user) },
    standing: (ref) => {
      asked.push(ref.projectId);
      return standing(ref);
    },
    account,
    onUser: (read) => users.push(read),
    ...(options.recentUser === undefined ? {} : { recentUser: options.recentUser }),
  });
  return { verifier, users, asked };
};

describe("the round's user", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly verifiedAgoMs: number | null;
    readonly reads: number;
  }> = [
    {
      name: "is the one the session verified moments ago, read again by nobody",
      verifiedAgoMs: 1_000,
      reads: 0,
    },
    {
      name: "is read again once the session's is no longer recent",
      verifiedAgoMs: RECENT_USER_MS,
      reads: 1,
    },
    { name: "is read when the session verified none", verifiedAgoMs: null, reads: 1 },
  ];
  for (const testCase of cases) {
    it.effect(testCase.name, () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        let reads = 0;
        const { verifier, users } = verifierOver({
          fetchUser: async () => {
            reads += 1;
            return user;
          },
          recentUser: () =>
            testCase.verifiedAgoMs === null ? null : { user, atMs: now - testCase.verifiedAgoMs },
        });
        yield* verifier.verifyRound({ round: 1, carried: [], report: () => Effect.void });
        expect(reads).toBe(testCase.reads);
        expect(users).toEqual([user]);
      }),
    );
  }
});

const round = Effect.fnUntraced(function* (
  standing: Standings,
  carried: ReadonlyArray<ProjectRef> = [projectRef("a")],
) {
  const events: GrantEvent[] = [];
  const { verifier, users, asked } = verifierOver({ standing });
  const result = yield* Effect.result(
    verifier.verifyRound({
      round: 7,
      carried,
      report: (event) => Effect.sync(() => events.push(event)),
    }),
  );
  const outcomes = new Map(
    events.flatMap((event) =>
      event.type === "ROUND_PROJECT" ? [[event.project.projectId, event.outcome] as const] : [],
    ),
  );
  return { events, outcomes, result, users, asked };
});

describe("the access verifier's round", () => {
  it.effect.each([
    [
      "OWNER",
      {
        role: "OWNER",
        mutationsAllowed: true,
        userRoles: [{ clientUserId: "membership", roleCode: "OWNER" }],
      },
    ],
    [
      "READ_ONLY",
      {
        role: "READ_ONLY",
        mutationsAllowed: false,
        userRoles: [{ clientUserId: "membership", roleCode: "READ_ONLY" }],
      },
    ],
    // Hidden from the viewer: its grants are not theirs to know.
    ["NO_ACCESS", { role: "NO_ACCESS", mutationsAllowed: false, userRoles: [] }],
  ] as const)("verifies a listed project's row with a %s override", ([roleCode, access]) =>
    Effect.gen(function* () {
      const { outcomes } = yield* round(listed(roleCode));

      expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({
        kind: "verified",
        access: { project: projectRef("a"), ...access },
      });
    }),
  );

  it.effect("judges a Developer's project on the own grant its listing row names", () =>
    Effect.gen(function* () {
      const developer: ZeropsUser = {
        ...user,
        clientUserList: [{ id: "membership", clientId: orgId, roleCode: "NO_ACCESS" }],
      };
      const events: GrantEvent[] = [];
      const verifier = makeRestAccessVerifier({
        client: { fetchUser: async () => developer },
        standing: (ref) => ({
          kind: "listed",
          project: { ...project(ref.projectId), viewerRoleCode: "OWNER" },
        }),
        account,
        onUser: () => {},
      });
      yield* verifier.verifyRound({
        round: 1,
        carried: [projectRef("a")],
        report: (event) => Effect.sync(() => events.push(event)),
      });
      expect(events.find((event) => event.type === "ROUND_PROJECT")).toMatchObject({
        outcome: { kind: "verified", access: { role: "OWNER", mutationsAllowed: true } },
      });
    }),
  );

  // A row holds the viewer's own grant a later listing named beside everybody's an earlier own
  // read brought (`keepUnsaid`): the own grant is the newer word on the viewer.
  it.effect.each([
    {
      name: "a grant lowered since the own read: the listing's lower one",
      everybody: "BASIC_USER",
      own: "READ_ONLY",
      expected: { role: "READ_ONLY", mutationsAllowed: false },
    },
    {
      name: "a project handed over by another admin: the listing's own one",
      everybody: "OWNER",
      own: "BASIC_USER",
      expected: { role: "BASIC_USER", mutationsAllowed: true },
    },
    {
      name: "an override granted since the own read: the listing's higher one",
      everybody: "READ_ONLY",
      own: "ADMIN",
      expected: { role: "ADMIN", mutationsAllowed: true },
    },
  ])("judges a Developer on the newer of both grants — $name", ({ everybody, own, expected }) =>
    Effect.gen(function* () {
      const developer: ZeropsUser = {
        ...user,
        clientUserList: [{ id: "membership", clientId: orgId, roleCode: "NO_ACCESS" }],
      };
      const verifier = makeRestAccessVerifier({
        client: { fetchUser: async () => developer },
        standing: (ref) => ({
          kind: "listed",
          project: { ...project(ref.projectId, everybody), viewerRoleCode: own },
        }),
        account,
        onUser: () => {},
      });
      yield* verifier.verifyRound({ round: 1, carried: [], report: () => Effect.void });
      expect(yield* verifier.verifyProject(projectRef("a"))).toMatchObject({
        kind: "verified",
        access: { ...expected, userRoles: [{ clientUserId: "membership", roleCode: own }] },
      });
    }),
  );

  it.effect.each([
    ["denied", "direct-forbidden"],
    ["deleted", "direct-not-found"],
  ] as const)("a project the store holds %s is that project's denial", ([kind, evidence]) =>
    Effect.gen(function* () {
      const { outcomes } = yield* round(() => ({ kind }));

      expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({ kind: "denied", evidence });
    }),
  );

  it.effect(
    "a project the store does not know yet is that project's failure, and the round goes on",
    () =>
      Effect.gen(function* () {
        const { outcomes, result } = yield* round(
          (ref) => (ref.projectId === "unread" ? { kind: "unknown" } : listed()(ref)),
          [projectRef("unread"), projectRef("up")],
        );

        expect(result._tag).toBe("Success");
        expect(outcomes.get(ZeropsProjectId.make("unread"))).toMatchObject({
          kind: "failed",
          failure: { kind: "transport" },
        });
        expect(outcomes.get(ZeropsProjectId.make("up"))).toMatchObject({ kind: "verified" });
      }),
  );

  it.effect("judges a carried project in its own organization only", () =>
    Effect.gen(function* () {
      const { events, asked } = yield* round(listed(), [projectRef("created"), elsewhere]);

      expect(events[0]).toMatchObject({ projects: [projectRef("created")] });
      expect(asked).toEqual(["created"]);
    }),
  );
});

describe("the access verifier's judgement of one project between rounds", () => {
  it.effect("judges the store's row against the membership the last round read", () =>
    Effect.gen(function* () {
      const { verifier } = verifierOver({ standing: listed("READ_ONLY") });
      yield* verifier.verifyRound({ round: 1, carried: [], report: () => Effect.void });

      expect(yield* verifier.verifyProject(projectRef("a"))).toEqual({
        kind: "verified",
        access: {
          project: projectRef("a"),
          role: "READ_ONLY",
          mutationsAllowed: false,
          userRoles: [{ clientUserId: "membership", roleCode: "READ_ONLY" }],
        },
      });
    }),
  );

  it.effect(
    "fails, never verifies, before a round has read a membership for its organization",
    () =>
      Effect.gen(function* () {
        const { verifier, asked } = verifierOver();

        expect(yield* verifier.verifyProject(projectRef("a"))).toMatchObject({ kind: "failed" });
        expect(asked).toEqual([]);
      }),
  );
});

describe("AL-08 / AL-10 authoritative project access", () => {
  const membership = { id: orgId, membershipId: "membership", name: "Org", roleCode: "OWNER" };
  const read = (roleCode?: string): ZeropsProject => project("project", roleCode);

  // A READ_ONLY project is listed, never opened (D5): it keeps its place in
  // the tree so a colleague can name the Mate they want access to, and its row
  // says whose it is.
  it.each([
    ["OWNER", { role: "OWNER", visibility: "open" }],
    ["ADMIN", { role: "ADMIN", visibility: "open" }],
    ["BASIC_USER", { role: "BASIC_USER", visibility: "open" }],
    ["READ_ONLY", { role: "READ_ONLY", visibility: "listed" }],
    ["NO_ACCESS", null],
  ] as const)("classifies one project read with a %s override", (roleCode, expected) => {
    expect(operableProjectAccess(read(roleCode), membership)).toEqual(
      expected === null ? null : { project: read(roleCode), ...expected },
    );
  });

  it("hides a project of another organization, and an override it cannot match to a membership", () => {
    expect(operableProjectAccess(read(), { ...membership, id: "different" })).toBeNull();
    expect(operableProjectAccess(read("OWNER"), { ...membership, membershipId: "" })).toBeNull();
  });
});
