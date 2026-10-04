import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  ZeropsApiError,
  type ZeropsProject,
  type ZeropsUser,
  type ZeropsApiClient,
} from "../../api.ts";
import { account, organization, project as projectRef } from "../__fixtures__/index.ts";
import { ZeropsOrganizationId, ZeropsProjectId, type ProjectRef } from "../types.ts";
import type { GrantEvent } from "./grant.ts";
import {
  makeRestAccessVerifier,
  operableProjectAccess,
  RECENT_USER_MS,
  type AccessVerifierClient,
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

const verifierOver = (
  client: Partial<AccessVerifierClient & Pick<ZeropsApiClient, "readAccessibleClientProjects">>,
  concurrency = 4,
  recentUser?: RestAccessVerifierOptions["recentUser"],
) => {
  const users: ZeropsUser[] = [];
  const verifier = makeRestAccessVerifier({
    client: Object.assign(
      {
        fetchUser: async () => user,
        readAccessibleClientProjects: async () => ({ projects: [], direct: false }),
        fetchProject: async (id: string) => project(id),
      },
      client,
    ),
    account,
    concurrency,
    onUser: (read) => users.push(read),
    ...(recentUser === undefined ? {} : { recentUser }),
  });
  return { verifier, users };
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
        const { verifier, users } = verifierOver(
          {
            fetchUser: async () => {
              reads += 1;
              return user;
            },
          },
          4,
          () =>
            testCase.verifiedAgoMs === null ? null : { user, atMs: now - testCase.verifiedAgoMs },
        );
        yield* verifier.verifyRound({ round: 1, carried: [], report: () => Effect.void });
        expect(reads).toBe(testCase.reads);
        expect(users).toEqual([user]);
      }),
    );
  }
});

const round = Effect.fnUntraced(function* (
  client: Partial<AccessVerifierClient & Pick<ZeropsApiClient, "readAccessibleClientProjects">>,
  carried: ReadonlyArray<ProjectRef> = [projectRef("a")],
  concurrency = 4,
) {
  const events: GrantEvent[] = [];
  const { verifier, users } = verifierOver(client, concurrency);
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
  return { events, outcomes, result, users };
});

describe("targeted renewal", () => {
  it.effect.each([0, 1, 2])(
    "reads selected project detail without listing any of three orgs (outage %s)",
    (outage) =>
      Effect.gen(function* () {
        const reads: string[] = [];
        const clients = ["org-1", "org-2", "org-3"];
        const target = {
          ...projectRef("opened"),
          organization: { ...organization, organizationId: ZeropsOrganizationId.make("org-2") },
        };
        const { verifier } = verifierOver({
          fetchUser: async () => ({
            ...user,
            clientUserList: clients.map((clientId) => ({
              id: clientId,
              clientId,
              roleCode: "OWNER",
            })),
          }),
          readAccessibleClientProjects: async (id) => {
            reads.push(`list:${id}`);
            if (id === clients[outage]) throw new ZeropsApiError("Unavailable", "server", 503);
            return { projects: [], direct: true };
          },
          fetchProject: async (id) => {
            reads.push(`project:${id}`);
            return { ...project(id), clientId: "org-2" };
          },
        });
        const events: GrantEvent[] = [];
        const result = yield* Effect.result(
          verifier.verifyRound({
            round: 1,
            carried: [target],
            report: (event) => Effect.sync(() => events.push(event)),
          }),
        );
        expect(result._tag).toBe("Success");
        expect(reads).toEqual(["project:opened"]);
        expect(events[0]).toMatchObject({ type: "ROUND_ACCOUNT", projects: [target] });
      }),
  );
});

describe("the REST access verifier's round", () => {
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
  ] as const)("verifies a project read with a %s override", ([roleCode, access]) =>
    Effect.gen(function* () {
      const { outcomes } = yield* round({
        readAccessibleClientProjects: async () => ({
          projects: [project("a", roleCode)],
          direct: false,
        }),
        fetchProject: async (id) => project(id, roleCode),
      });

      expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({
        kind: "verified",
        access: { project: projectRef("a"), ...access },
      });
    }),
  );
  it.effect.each([
    ["forbidden", "direct-forbidden"],
    ["not-found", "direct-not-found"],
  ] as const)("a %s project read is that project's denial", ([kind, evidence]) =>
    Effect.gen(function* () {
      const { outcomes } = yield* round({
        readAccessibleClientProjects: async () => ({ projects: [project("a")], direct: false }),
        fetchProject: async () => {
          throw new ZeropsApiError("Gone", kind);
        },
      });

      expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({ kind: "denied", evidence });
    }),
  );

  it.effect("an unavailable project read is that project's failure, and the round goes on", () =>
    Effect.gen(function* () {
      const { outcomes, result } = yield* round(
        {
          readAccessibleClientProjects: async () => ({
            projects: [project("down"), project("up")],
            direct: false,
          }),
          fetchProject: async (id) => {
            if (id === "down") throw new ZeropsApiError("Unavailable", "server", 503);
            return project(id);
          },
        },
        [projectRef("down"), projectRef("up")],
      );

      expect(result._tag).toBe("Success");
      expect(outcomes.get(ZeropsProjectId.make("down"))).toEqual({
        kind: "failed",
        failure: { kind: "server", status: 503 },
      });
      expect(outcomes.get(ZeropsProjectId.make("up"))).toMatchObject({ kind: "verified" });
    }),
  );

  it.effect("reads a carried project the listing omits, in its own organization only", () =>
    Effect.gen(function* () {
      const requested: string[] = [];
      const { events } = yield* round(
        {
          fetchProject: async (id) => {
            requested.push(id);
            return project(id);
          },
        },
        [projectRef("created"), elsewhere],
      );

      expect(events[0]).toMatchObject({ projects: [projectRef("created")] });
      expect(requested).toEqual(["created"]);
    }),
  );
});

describe("the REST access verifier's read of one project between rounds", () => {
  it.effect("judges the read against the membership the last round read", () =>
    Effect.gen(function* () {
      const { verifier } = verifierOver({ fetchProject: async (id) => project(id, "READ_ONLY") });
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
        const reads: string[] = [];
        const { verifier } = verifierOver({
          fetchProject: async (id) => {
            reads.push(id);
            return project(id);
          },
        });

        expect(yield* verifier.verifyProject(projectRef("a"))).toMatchObject({ kind: "failed" });
        expect(reads).toEqual([]);
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
