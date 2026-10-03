import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { ZeropsApiError, type ZeropsProject, type ZeropsUser } from "../../api.ts";
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
  client: Partial<AccessVerifierClient>,
  concurrency = 4,
  recentUser?: RestAccessVerifierOptions["recentUser"],
) => {
  const users: ZeropsUser[] = [];
  const verifier = makeRestAccessVerifier({
    client: {
      fetchUser: async () => user,
      readAccessibleClientProjects: async () => ({ projects: [], direct: false }),
      fetchProject: async (id) => project(id),
      ...client,
    },
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
  client: Partial<AccessVerifierClient>,
  carried: ReadonlyArray<ProjectRef> = [],
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

describe("the REST access verifier's round (DESIGN G1)", () => {
  it.effect("lists every organization before it reads a project, then reports each read", () =>
    Effect.gen(function* () {
      const { events, result, users } = yield* round({
        readAccessibleClientProjects: async () => ({
          projects: [project("a"), project("b")],
          direct: false,
        }),
      });

      expect(result._tag).toBe("Success");
      expect(users).toEqual([user]);
      expect(events.map(({ type }) => type)).toEqual([
        "ROUND_ACCOUNT",
        "ROUND_PROJECT",
        "ROUND_PROJECT",
      ]);
      expect(events[0]).toMatchObject({
        round: 7,
        organizations: [{ organization, mutationsAllowed: true }],
        projects: [projectRef("a"), projectRef("b")],
      });
    }),
  );

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
    ["NO_ACCESS", { role: "NO_ACCESS", mutationsAllowed: false, userRoles: [] }],
    [undefined, { role: "OWNER", mutationsAllowed: true, userRoles: [] }],
  ] as const)(
    "verifies a project the organization's direct list carries with %s overrides from the list itself, reading none",
    ([roleCode, access]) =>
      Effect.gen(function* () {
        const reads: string[] = [];
        const { outcomes } = yield* round({
          readAccessibleClientProjects: async () => ({
            projects: [
              { ...project("a", roleCode), userRoles: project("a", roleCode).userRoles ?? [] },
            ],
            direct: true,
          }),
          fetchProject: async (id) => {
            reads.push(id);
            return project(id);
          },
        });

        expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({
          kind: "verified",
          access: { project: projectRef("a"), ...access },
        });
        expect(reads).toEqual([]);
      }),
  );

  it.effect(
    "a round over a direct list of N projects reads no project, whatever N; a carried project it omits is still read",
    () =>
      Effect.gen(function* () {
        const reads: string[] = [];
        const listed = Array.from({ length: 40 }, (_, index) => ({
          ...project(`p${index}`),
          userRoles: [],
        }));
        const { outcomes } = yield* round(
          {
            readAccessibleClientProjects: async () => ({ projects: listed, direct: true }),
            fetchProject: async (id) => {
              reads.push(id);
              return project(id);
            },
          },
          [projectRef("created")],
        );

        expect(reads).toEqual(["created"]);
        expect(outcomes.size).toBe(41);
      }),
  );

  it.effect(
    "reads each project a searched list names: its overrides are not the project's own",
    () =>
      Effect.gen(function* () {
        const reads: string[] = [];
        yield* round({
          readAccessibleClientProjects: async () => ({
            projects: [{ ...project("a"), userRoles: [] }],
            direct: false,
          }),
          fetchProject: async (id) => {
            reads.push(id);
            return project(id);
          },
        });

        expect(reads).toEqual(["a"]);
      }),
  );

  it.effect("reads a project the direct list carries without its overrides", () =>
    Effect.gen(function* () {
      const reads: string[] = [];
      yield* round({
        readAccessibleClientProjects: async () => ({ projects: [project("a")], direct: true }),
        fetchProject: async (id) => {
          reads.push(id);
          return project(id);
        },
      });

      expect(reads).toEqual(["a"]);
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
      const { outcomes, result } = yield* round({
        readAccessibleClientProjects: async () => ({
          projects: [project("down"), project("up")],
          direct: false,
        }),
        fetchProject: async (id) => {
          if (id === "down") throw new ZeropsApiError("Unavailable", "server", 503);
          return project(id);
        },
      });

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

  it.effect(
    "fails as a round, in the platform's words, when an organization list fails, before any project is read",
    () =>
      Effect.gen(function* () {
        const { events, result } = yield* round({
          readAccessibleClientProjects: async () => {
            throw new ZeropsApiError("Zerops is down for maintenance.", "server", 503);
          },
        });

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            failure: { kind: "server", status: 503 },
            message: "Zerops is down for maintenance.",
          },
        });
        expect(events).toEqual([]);
      }),
  );

  it.effect.each(["fetchUser", "readAccessibleClientProjects"] as const)(
    "an abandoned round aborts its HTTP reads: %s",
    (held) =>
      Effect.gen(function* () {
        const signals: Array<AbortSignal | undefined> = [];
        const reading = Promise.withResolvers<void>();
        /** A read that answers only when its round lets it go. */
        const hang = (signal: AbortSignal | undefined) => {
          signals.push(signal);
          reading.resolve();
          return new Promise<never>(() => undefined);
        };
        const { verifier } = verifierOver(
          held === "fetchUser"
            ? { fetchUser: (signal) => hang(signal) }
            : { readAccessibleClientProjects: (_id, options) => hang(options?.signal) },
        );
        const round = yield* Effect.forkChild(
          verifier.verifyRound({ round: 7, carried: [], report: () => Effect.void }),
        );
        yield* Effect.promise(() => reading.promise);

        yield* Fiber.interrupt(round);

        expect(signals).toHaveLength(1);
        expect(signals[0]?.aborted).toBe(true);
      }),
  );

  it.effect("reads at most `concurrency` projects at once", () =>
    Effect.gen(function* () {
      let inFlight = 0;
      let most = 0;
      yield* round(
        {
          readAccessibleClientProjects: async () => ({
            projects: ["a", "b", "c", "d", "e", "f"].map((id) => project(id)),
            direct: false,
          }),
          fetchProject: async (id) => {
            inFlight++;
            most = Math.max(most, inFlight);
            await Promise.resolve();
            inFlight--;
            return project(id);
          },
        },
        [],
        4,
      );

      expect(most).toBe(4);
    }),
  );
});

// F12, F11 (e2e, 2026-10-03): the project's grants are what HQ's rule and its owner read — a
// member granted OWNER on one project, below their NO_ACCESS org role, and its OWNER after a hand
// over. The row carries them; the round keeps them, whichever read it came from.
describe("the REST access verifier keeps each project's grants", () => {
  const granted = (id: string): ZeropsProject => ({
    ...project(id),
    userRoles: [
      { clientUserId: "membership", roleCode: "BASIC_USER" },
      { clientUserId: "colleague", roleCode: "OWNER" },
    ],
  });

  it.effect.each([
    ["read on its own", false],
    ["carried by the direct list", true],
  ] as const)("from a project %s", ([_name, direct]) =>
    Effect.gen(function* () {
      const { outcomes } = yield* round({
        readAccessibleClientProjects: async () => ({ projects: [granted("a")], direct }),
        fetchProject: async (id) => granted(id),
      });

      expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({
        kind: "verified",
        access: {
          project: projectRef("a"),
          role: "BASIC_USER",
          mutationsAllowed: true,
          userRoles: granted("a").userRoles,
        },
      });
    }),
  );
});

// The KRLS Developer, measured 2026-10-03: refused the organization's list, they read it through
// `/project/search`, whose row names only their own grant; the project's own read names everyone's.
// The round keeps the read's, never the row's: a Mate's OWNER who is somebody else stays its owner.
describe("the REST access verifier over a searched list", () => {
  it.effect("keeps every member's grants from the project's read, not the row's own one", () =>
    Effect.gen(function* () {
      const everyone = [
        { clientUserId: "mate-key", roleCode: "BASIC_USER" },
        { clientUserId: "membership", roleCode: "OWNER" },
      ];
      const searched: ZeropsProject = {
        ...project("cyd"),
        userRoles: [
          {
            id: "role-1",
            clientId: orgId,
            clientUserId: "membership",
            projectId: "cyd",
            roleCode: "OWNER",
            created: "2026-10-03T00:00:00Z",
            lastUpdate: "2026-10-03T00:00:00Z",
          } as { readonly clientUserId: string; readonly roleCode: string },
        ],
      };
      const { outcomes } = yield* round({
        fetchUser: async () => ({
          ...user,
          clientUserList: [{ id: "membership", clientId: orgId, roleCode: "NO_ACCESS" }],
        }),
        readAccessibleClientProjects: async () => ({ projects: [searched], direct: false }),
        fetchProject: async (id) => ({ ...project(id), userRoles: everyone }),
      });

      expect(outcomes.get(ZeropsProjectId.make("cyd"))).toEqual({
        kind: "verified",
        access: {
          project: projectRef("cyd"),
          role: "OWNER",
          mutationsAllowed: true,
          userRoles: everyone,
        },
      });
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
