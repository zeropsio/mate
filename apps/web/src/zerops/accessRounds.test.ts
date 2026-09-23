import {
  ZeropsApiError,
  type ZeropsProject,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type GrantEvent,
  type OrganizationRef,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { runAccessRound, type AccessRoundClient } from "./accessRounds";

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account"),
};
const organizationRef = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account,
  organizationId: ZeropsOrganizationId.make(organizationId),
});
const projectRef = (organizationId: string, projectId: string): ProjectRef => ({
  kind: "project",
  organization: organizationRef(organizationId),
  projectId: ZeropsProjectId.make(projectId),
});
const user: ZeropsUser = {
  id: "account",
  email: "person@example.test",
  clientUserList: [{ id: "membership", clientId: "org", roleCode: "OWNER" }],
};
const project = (id: string, roleCode?: string): ZeropsProject => ({
  id,
  clientId: "org",
  name: id,
  status: "ACTIVE",
  ...(roleCode === undefined ? {} : { userRoles: [{ clientUserId: "membership", roleCode }] }),
});

async function round(
  client: Partial<AccessRoundClient>,
  carried: ReadonlyArray<ProjectRef> = [],
  concurrency = 4,
) {
  const events: GrantEvent[] = [];
  const result = await runAccessRound({
    client: {
      fetchUser: async () => user,
      listAccessibleClientProjects: async () => [],
      fetchProject: async (id) => project(id),
      ...client,
    },
    round: 7,
    carried,
    concurrency,
    organizationRef,
    projectRef,
    onUser: () => undefined,
    onProject: () => undefined,
    dispatch: (event) => events.push(event),
  });
  const outcomes = new Map(
    events.flatMap((event) =>
      event.type === "ROUND_PROJECT" ? [[event.project.projectId, event.outcome] as const] : [],
    ),
  );
  return { events, outcomes, reads: result.reads };
}

describe("an access round (DESIGN G1)", () => {
  it("lists every organization before it reads a project, then reports each read", async () => {
    const { events, reads } = await round({
      listAccessibleClientProjects: async () => [project("a"), project("b")],
    });

    expect(events.map(({ type }) => type)).toEqual([
      "ROUND_ACCOUNT",
      "ROUND_PROJECT",
      "ROUND_PROJECT",
    ]);
    expect(events[0]).toMatchObject({
      round: 7,
      organizations: [{ organization: organizationRef("org"), mutationsAllowed: true }],
      projects: [projectRef("org", "a"), projectRef("org", "b")],
    });
    expect(reads).toBe(4);
  });

  it.each([
    ["OWNER", { role: "OWNER", mutationsAllowed: true }],
    ["READ_ONLY", { role: "READ_ONLY", mutationsAllowed: false }],
    ["NO_ACCESS", { role: "NO_ACCESS", mutationsAllowed: false }],
  ] as const)("verifies a project read with a %s override", async (roleCode, access) => {
    const { outcomes } = await round({
      listAccessibleClientProjects: async () => [project("a", roleCode)],
      fetchProject: async (id) => project(id, roleCode),
    });

    expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({
      kind: "verified",
      access: { project: projectRef("org", "a"), ...access },
    });
  });

  it.each([
    ["forbidden", "direct-forbidden"],
    ["not-found", "direct-not-found"],
  ] as const)("a %s project read is that project's denial", async (kind, evidence) => {
    const { outcomes } = await round({
      listAccessibleClientProjects: async () => [project("a")],
      fetchProject: async () => {
        throw new ZeropsApiError("Gone", kind);
      },
    });

    expect(outcomes.get(ZeropsProjectId.make("a"))).toEqual({ kind: "denied", evidence });
  });

  it("an unavailable project read is that project's failure, and the round goes on", async () => {
    const { outcomes } = await round({
      listAccessibleClientProjects: async () => [project("down"), project("up")],
      fetchProject: async (id) => {
        if (id === "down") throw new ZeropsApiError("Unavailable", "server", 503);
        return project(id);
      },
    });

    expect(outcomes.get(ZeropsProjectId.make("down"))).toEqual({
      kind: "failed",
      failure: { kind: "server", status: 503 },
    });
    expect(outcomes.get(ZeropsProjectId.make("up"))).toMatchObject({ kind: "verified" });
  });

  it("reads a carried project the listing omits, in its own organization only", async () => {
    const requested: string[] = [];
    const { events } = await round(
      {
        fetchProject: async (id) => {
          requested.push(id);
          return project(id);
        },
      },
      [projectRef("org", "created"), projectRef("left-org", "elsewhere")],
    );

    expect(events[0]).toMatchObject({ projects: [projectRef("org", "created")] });
    expect(requested).toEqual(["created"]);
  });

  it("fails as a round when an organization list fails, before any project is read", async () => {
    const events: GrantEvent[] = [];
    await expect(
      runAccessRound({
        client: {
          fetchUser: async () => user,
          listAccessibleClientProjects: async () => {
            throw new ZeropsApiError("Unavailable", "server", 503);
          },
          fetchProject: async (id) => project(id),
        },
        round: 1,
        carried: [],
        concurrency: 4,
        organizationRef,
        projectRef,
        onUser: () => undefined,
        onProject: () => undefined,
        dispatch: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({ kind: "server" });
    expect(events).toEqual([]);
  });

  it("reads at most `concurrency` projects at once", async () => {
    let inFlight = 0;
    let most = 0;
    await round(
      {
        listAccessibleClientProjects: async () =>
          ["a", "b", "c", "d", "e", "f"].map((id) => project(id)),
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
  });
});
