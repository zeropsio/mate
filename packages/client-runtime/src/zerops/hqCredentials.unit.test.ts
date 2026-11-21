import type { GitCredential } from "@t3tools/shared/hqGit";
import * as DateTime from "effect/DateTime";
import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { makeGitCredentials } from "../data/adapters/hqGitCredentials.ts";
import { gitCredentials } from "../data/projections/gitCredentials.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../data/store.ts";
import { HqError, makeHqApi, type HqApi, type OpenHqSocket } from "./hq/client.ts";

const ADDRESS = "https://hq.example";
const ORG = "org-1";
const noSocket: OpenHqSocket = () => {
  throw new Error("no socket in this case");
};
const answer = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const HOUR = 3_600_000;

const SHA = "a".repeat(40);
const LINK = { appId: "app-1", repo: "app", number: 3 } as const;
const RELEASE = {
  tag: "v0.1.1",
  groupHead: SHA,
  entries: [{ service: "app", sha: "b".repeat(40) }],
};

/** HQ calls besides the door and the three Zerops writes HQ makes for the person in that call. */
const SESSION_ONLY: ReadonlyArray<(api: HqApi) => Promise<unknown> | undefined> = [
  (api) => api.mateTicket("p1"),
  (api) => api.createApp("Acme"),
  (api) => api.renameApp("app-1", "Shop"),
  (api) => api.deleteApp("app-1"),
  (api) => api.attachProject("app-1", { projectId: "p9", projectName: "p9", kind: "stage" }),
  (api) => api.createMate({ projectId: "p1", projectName: "p1", face: "sky" }),
  (api) => api.updateMate("p1", { face: "sky" }),
  (api) => api.deleteBirth("b1"),
  (api) => api.completeProjectDeletion("p1"),
  (api) => api.release("app-1", RELEASE),
  (api) => api.rollback("app-1", "v0.1.0", { groupHead: SHA }),
  (api) => api.mergeChange(LINK, SHA),
  (api) => api.closeChange(LINK, SHA),
  (api) => api.commentOnChange(LINK, "Ship it"),
  (api) => api.keepDeployToken("app-1", "stage", "deploy-token"),
  (api) => api.redeploy("app-1", "stage", { service: "app", sha: SHA }),
  (api) => api.addService("app-1", "stage", "db"),
  (api) => api.setAutoUpdatePolicy(true),
  (api) => api.setChief("p1"),
  (api) => api.gitCredentials("app-1"),
  (api) => api.issueGitCredential("app-1"),
  (api) => api.revokeGitCredential("app-1", "c1"),
  (api) => api.takeOverList("u2"),
  (api) => api.recordReveal({ projectId: "p1", service: "db", key: "PASSWORD" }),
];

// witness: packages/client-runtime/src/zerops/hq/client.ts | { method: "POST", body: JSON.stringify(await withAccess({ ownerUserId })) }, → { method: "POST", body: JSON.stringify({ ownerUserId }) },
it("ZV99: Only HQ's door, creating a Mate, a Mate's hand-over and a take-over replace carry the person's Zerops access token; every other HQ call carries only HQ's session", async () => {
  const requests: Array<{
    readonly call: string;
    readonly text: string;
    readonly bearer: string | null;
  }> = [];
  const api = makeHqApi({
    address: ADDRESS,
    orgId: ORG,
    openSocket: noSocket,
    accessToken: async () => ({ token: "person-token", expiresAt: "2099-01-01T00:00:00.000Z" }),
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      const path = new URL(url).pathname;
      requests.push({
        call: `${init?.method ?? "GET"} ${path}`,
        text: [url, JSON.stringify([...headers.entries()]), String(init?.body ?? "")].join(" "),
        bearer: headers.get("authorization"),
      });
      if (path === "/api/door")
        return answer(200, { session: "session-1", expiresAt: "2099-01-01T00:00:00.000Z" });
      if (path === "/api/structure") return answer(200, { apps: [], ungrouped: [] });
      return answer(201, {});
    },
  });
  const calls = [
    (hq: HqApi) => hq.structure(),
    ...SESSION_ONLY,
    (hq: HqApi) =>
      hq.createBirth({
        id: "b2",
        app: { name: "Acme" },
        face: "sky",
        intent: {
          projectName: "acme",
          recipe: { kind: "none" },
          agents: ["claude-code"],
          standUp: false,
          automated: false,
          placement: { role: "dev", name: "dev", chief: false },
          location: null,
          userRoles: [],
        },
      }),
    (hq: HqApi) => hq.handOver("p1", "user-bob"),
    (hq: HqApi) => hq.takeOver("u2", "t1", "user-bob"),
  ];
  // Only what each call sends is judged: HQ's empty answer need not read as the call's.
  for (const call of calls) await call(api)?.catch(() => undefined);
  expect(
    requests.filter((request) => request.text.includes("person-token")).map((r) => r.call),
  ).toEqual([
    "POST /api/door",
    "POST /api/births",
    "POST /api/mates/p1/hand-over",
    "POST /api/members/u2/take-over/t1",
  ]);
  expect(
    new Set(requests.filter((request) => request.call !== "POST /api/door").map((r) => r.bearer)),
  ).toEqual(new Set(["Bearer session-1"]));
});

// witness: packages/client-runtime/src/zerops/hq/client.ts | ...(access.expiresAt === undefined ? {} : { expiresAt: access.expiresAt }), → ...({}),
it("ZV100: HQ's door is handed the person's Zerops access token with its expiry, once per sign-in and renewal, and never an organisation key", async () => {
  let clock = Date.parse("2026-11-04T08:00:00.000Z");
  const signedInAt = clock;
  const doorBodies: unknown[] = [];
  const api = makeHqApi({
    address: ADDRESS,
    orgId: ORG,
    now: () => clock,
    openSocket: noSocket,
    // Zerops' session, renewed once the clock moved: its token and expiry are those of then.
    accessToken: async () => ({
      token: clock === signedInAt ? "access-1" : "access-2",
      expiresAt: iso(clock + 6 * HOUR),
    }),
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/api/door") {
        doorBodies.push(JSON.parse(String(init?.body)));
        return answer(200, {
          session: "session-1",
          expiresAt: iso(clock + 6 * HOUR),
          userId: "u1",
        });
      }
      if (path === "/api/structure") return answer(200, { apps: [], ungrouped: [] });
      return answer(404, { code: "not_found" });
    },
  });
  await api.structure();
  await api.structure();
  clock += 5 * HOUR + 50 * 60_000;
  await api.structure();
  expect(doorBodies).toEqual([
    { accessToken: "access-1", expiresAt: "2026-11-04T14:00:00.000Z", orgId: ORG },
    { accessToken: "access-2", expiresAt: "2026-11-04T19:50:00.000Z", orgId: ORG },
  ]);
});

const key = { orgId: "org", appId: "app" };
const credential: GitCredential = {
  id: "key",
  appId: "app",
  token: "one-time-secret",
  createdAt: "2026-10-07",
  expiresAt: "2026-10-08",
};
const { token: _password, ...metadata } = credential;
const denied = () => new HqError({ kind: "refused", code: "forbidden", message: "Access denied." });

/** Resolves once `holds` is true of the store, checked on each of its changes. */
function once(store: AccountStore, holds: () => boolean) {
  return new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (!holds()) return;
      stop();
      resolve();
    };
    check();
  });
}

/** The person's credential host over an account store, with HQ answering through `api`. */
function host(api: Parameters<typeof makeGitCredentials>[0]["api"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let id = 0;
  const credentials = makeGitCredentials({ store, api, makeId: () => `request-${++id}` });
  return {
    store,
    credentials,
    read: () => gitCredentials.derive(readsOfState(store.state()), key),
    /** Every fact and operation record the account holds, as text. */
    held: () =>
      JSON.stringify([...store.state().facts.values(), ...store.state().operations.values()]),
    close: () => {
      credentials.close();
      registry.dispose();
    },
  };
}

// witness: packages/client-runtime/src/data/adapters/hqGitCredentialReads.ts | family: "hqGitCredentialRequest", → family: "hqGitCredentials",
it("ZV101: A Git password is erased when its account loses access, and an issue answered after the account closed is dropped", async () => {
  let refusing = false;
  const active = host({
    gitCredentials: async () => {
      if (refusing) throw denied();
      return [metadata];
    },
    issueGitCredential: async () => credential,
    revokeGitCredential: async () => {},
  });
  const view = active.credentials.demand(key);
  await active.credentials.issue(key);
  expect(active.read().action).toEqual({ kind: "issued", credential });
  refusing = true;
  const answered = once(active.store, () => {
    const shown = active.read().credentials;
    return shown.state === "withheld" || ("stale" in shown && shown.stale);
  });
  active.credentials.again(key);
  await answered;
  expect(active.read().credentials).toEqual({ state: "withheld" });
  expect(active.read().action).toEqual({ kind: "idle" });
  view();
  active.close();

  let answerIssue!: (value: GitCredential) => void;
  let asked!: () => void;
  const issuing = new Promise<void>((resolve) => {
    asked = resolve;
  });
  const closing = host({
    gitCredentials: async () => [metadata],
    issueGitCredential: () => {
      asked();
      return new Promise((resolve) => {
        answerIssue = resolve;
      });
    },
    revokeGitCredential: async () => {},
  });
  const held = closing.credentials.demand(key);
  const issue = closing.credentials.issue(key);
  await issuing;
  closing.credentials.close();
  answerIssue(credential);
  await issue;
  expect(closing.read().action.kind).not.toBe("issued");
  expect(closing.held()).not.toContain(credential.token);
  held();
  closing.close();
});

// witness: packages/client-runtime/src/data/adapters/hqGitCredentials.ts | id === undefined && → id === "never" &&
it("ZV102: An issue whose answer was lost stays uncertain across a remount and never creates a second password", async () => {
  let issues = 0;
  let revokes = 0;
  const r = host({
    gitCredentials: async () => [metadata],
    issueGitCredential: async () => {
      issues++;
      throw new HqError({ kind: "uncertain", code: "network", message: "Lost answer." });
    },
    revokeGitCredential: async () => {
      revokes++;
    },
  });
  const first = r.credentials.demand(key);
  await r.credentials.issue(key);
  first();
  const remount = r.credentials.demand(key);
  await r.credentials.issue(key);
  expect(issues).toBe(1);
  expect(r.read().action.kind).toBe("unresolved");
  await r.credentials.revoke(key, metadata.id);
  expect(revokes).toBe(1);
  await r.credentials.issue(key);
  expect(issues).toBe(1);
  expect(r.read().action.kind).toBe("unresolved");
  remount();
  r.close();
});

// witness: packages/client-runtime/src/zerops/hq/client.ts | : { Authorization: `Bearer ${token}` }; → : {};
it("ZV103: A Git password is issued, listed and revoked through the person's session and never travels in a URL", async () => {
  const record = {
    id: "id-1",
    appId: "app",
    createdAt: "2026-10-04T10:00:00Z",
    expiresAt: "2026-10-04T22:00:00Z",
  };
  const calls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
  const api = makeHqApi({
    address: ADDRESS,
    orgId: ORG,
    openSocket: noSocket,
    accessToken: async () => ({ token: "access" }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/api/door")
        return answer(200, { session: "own", expiresAt: "2099-01-01T00:00:00.000Z" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return answer(200, { ...record, token: "test-password" });
      return answer(200, { credentials: [record] });
    },
  });
  expect(await api.issueGitCredential("app")).toEqual({ ...record, token: "test-password" });
  expect(await api.gitCredentials("app")).toEqual([record]);
  await api.revokeGitCredential("app", "id-1");
  expect(
    calls
      .filter((call) => new URL(call.url).pathname !== "/api/door")
      .map((call) => [
        new URL(call.url).pathname,
        call.init?.method ?? "GET",
        new Headers(call.init?.headers).get("authorization"),
      ]),
  ).toEqual([
    ["/api/apps/app/git-credentials", "POST", "Bearer own"],
    ["/api/apps/app/git-credentials", "GET", "Bearer own"],
    ["/api/apps/app/git-credentials/id-1", "DELETE", "Bearer own"],
  ]);
  expect(calls.filter((call) => call.url.includes("test-password"))).toEqual([]);
});
