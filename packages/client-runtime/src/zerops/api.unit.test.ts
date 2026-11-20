import { ZeropsUserId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  ZeropsApiClient,
  ZeropsApiError,
  readsAsEnabled,
  zeropsClientsFromUser,
  zeropsInvitationsFromUser,
} from "./api.ts";
import { servicePortOrigin } from "./containerAddress.ts";

const project = {
  id: "p1",
  name: "z3-eval",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "26a7",
};
const service = { id: "s1", name: "weatherdash", status: "ACTIVE", subdomainAccess: true };

// witness: packages/client-runtime/src/zerops/containerAddress.ts | return port.port === 80 → return port.port !== 80
it("ZV9: A service port's public origin carries no port segment on port 80 and its own port on every other port, as Zerops serves them", () => {
  expect(servicePortOrigin(project, service, { port: 80, scheme: "http" })).toBe(
    "https://weatherdash-26a7.prg1.zerops.app",
  );
  expect(
    servicePortOrigin(project, { ...service, name: "zcp" }, { port: 8080, scheme: "http" }),
  ).toBe("https://zcp-26a7-8080.prg1.zerops.app");
});

// witness: packages/client-runtime/src/zerops/containerAddress.ts | if (service.subdomainAccess !== true) return undefined; → if (service.subdomainAccess === undefined) return undefined;
it("ZV10: A port has no public origin when its service's subdomain access is off, its scheme is not HTTP, or its project has no public subdomain", () => {
  const port = { port: 80, scheme: "http" };
  expect(servicePortOrigin(project, { ...service, subdomainAccess: false }, port)).toBeUndefined();
  expect(servicePortOrigin(project, service, { port: 3306, scheme: "mysql" })).toBeUndefined();
  expect(
    servicePortOrigin({ id: "p1", name: "z3-eval", status: "ACTIVE" }, service, port),
  ).toBeUndefined();
});

const user = {
  id: ZeropsUserId.make("user-1"),
  email: "a@b.c",
  clientUserList: [
    {
      id: "cu-1",
      clientId: "org-1",
      status: "ACTIVE",
      roleCode: "OWNER",
      client: { id: "org-1", accountName: "Example Org" },
    },
    {
      id: "cu-2",
      clientId: "org-2",
      status: "ACTIVE",
      roleCode: "NO_ACCESS",
      canCreateProjects: true,
      canViewFinances: false,
      client: { id: "org-2", accountName: "Second" },
    },
    { id: "cu-3", clientId: "org-3", status: "INACTIVE" },
    { id: "cu-4", clientId: "org-1", status: "ACTIVE" },
    {
      id: "cu-5",
      clientId: "org-4",
      status: "WAITING_AUTHORIZATION",
      client: { id: "org-4", accountName: "Fourth" },
    },
  ],
};

// witness: packages/client-runtime/src/zerops/api.ts | if (membership.status && membership.status !== "ACTIVE") continue; → if (membership.status === "INACTIVE") continue;
it("ZV11: An account's organizations are those it is an active member of, each once; an inactive membership or an invitation still waiting is not one of them", () => {
  expect(zeropsClientsFromUser(user).map((org) => org.id)).toEqual(["org-1", "org-2"]);
});

// witness: packages/client-runtime/src/zerops/api.ts | membershipId: membership.id, → membershipId: id,
it("ZV12: Each of the account's organizations carries the account's own membership in it: that membership's id, its role and the rights it states", () => {
  const organizations = zeropsClientsFromUser(user);
  expect(organizations[0]).toEqual({
    id: "org-1",
    membershipId: "cu-1",
    name: "Example Org",
    roleCode: "OWNER",
  });
  expect(organizations[1]).toMatchObject({
    id: "org-2",
    membershipId: "cu-2",
    roleCode: "NO_ACCESS",
    canCreateProjects: true,
    canViewFinances: false,
  });
});

// witness: packages/client-runtime/src/zerops/api.ts | if (!id || joined.has(id) || seen.has(id)) continue; → if (!id || seen.has(id)) continue;
it("ZV13: An organization is offered as an invitation only while the account's membership in it waits for authorization and the account is not already an active member of it, each organization once", () => {
  const invitations = zeropsInvitationsFromUser({
    id: ZeropsUserId.make("user-1"),
    email: "a@b.c",
    clientUserList: [
      { id: "cu-1", clientId: "org-1", status: "ACTIVE" },
      {
        id: "cu-5",
        clientId: "org-4",
        status: "WAITING_AUTHORIZATION",
        client: { id: "org-4", accountName: "Fourth" },
      },
      { id: "cu-6", clientId: "org-1", status: "WAITING_AUTHORIZATION" },
      { id: "cu-7", clientId: "org-4", status: "WAITING_AUTHORIZATION" },
    ],
  });
  expect(invitations).toEqual([{ id: "org-4", name: "Fourth" }]);
});

// witness: packages/client-runtime/src/zerops/api.ts | const normalized = value.trim().toLowerCase(); → const normalized = value.trim();
it("ZV14: A Mate flag typed into a service's variables reads as on for 1 or true in any letter case and with surrounding space, and as off for every other spelling", () => {
  for (const value of ["1", "true", "TRUE", " True "]) {
    expect(readsAsEnabled(value), value).toBe(true);
  }
  for (const value of ["0", "false", "yes", "on", ""]) {
    expect(readsAsEnabled(value), value).toBe(false);
  }
});

// witness: packages/client-runtime/src/zerops/api.ts | if (/^\d+$/u.test(value)) return Math.min(RETRY_AFTER_CAP_MS, Number(value) * 1000); → if (/^\d+$/u.test(value)) return Number(value) * 1000;
it("ZV15: A throttled Zerops answer tells its caller to wait as long as its Retry-After asks in seconds, never longer than ten minutes, and not at all when it asks nothing readable", async () => {
  async function expectRetryAfter(headers: Record<string, string>, retryAfterMs: number | null) {
    const client = new ZeropsApiClient({
      fetch: async () => new Response("{}", { status: 429, headers }),
    });
    client.restoreSession({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 432_000,
      userId: "user-1",
    });
    const result = await client.listClientProjects("org-1").catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ZeropsApiError);
    expect(result).toMatchObject({ retryAfterMs });
  }

  await expectRetryAfter({ "Retry-After": "12" }, 12_000);
  await expectRetryAfter({ "Retry-After": "86400" }, 600_000);
  await expectRetryAfter({ "Retry-After": "soon" }, null);
  await expectRetryAfter({}, null);
});
