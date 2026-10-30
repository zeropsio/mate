import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import {
  makeAccountStore,
  makeObserveCredential,
  observeCredential,
  readsOfState,
} from "@t3tools/client-runtime/data";
import { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { makeHqApi } from "@t3tools/client-runtime/zerops/hq";
import { liveProjects, membershipInputs } from "@t3tools/client-runtime/data/fixtures";
import { accountOperations } from "./accountOperations";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { holdHqWrites } from "./hqWrites";

const OBSERVE_KEY = { orgId: "org", projectId: "p" };
const NONE = { authorized: false, userId: null, expiresAt: null };
const AUTH = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function automaticStatusRig(options: {
  readonly read: (number: number) => Promise<typeof NONE | typeof AUTH>;
  readonly establish: () => Promise<void>;
}) {
  openAccountLifetime("person");
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  [...liveProjects("org", [{ id: "p" }]), ...membershipInputs("ADMIN", false)].forEach(
    store.dispatch,
  );
  const calls: string[] = [];
  let reads = 0;
  const api = makeHqApi({
    address: "https://hq.example.test",
    orgId: "org",
    accessToken: async () => "person-native-access",
    openSocket: () => {
      throw new Error("No stream needed");
    },
    fetch: async (url) => {
      if (url.endsWith("/api/door"))
        return Response.json({ session: "person", expiresAt: "later" });
      if (url.endsWith("/observe-credential")) {
        calls.push("read");
        return Response.json(await options.read(++reads));
      }
      if (url.endsWith("/zcp-authorization")) {
        calls.push("authorize");
        await options.establish();
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected HQ request ${new URL(url).pathname}`);
    },
  });
  const releaseWriter = holdHqWrites("org", api, "hq");
  const client = new ZeropsApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path.includes("service-stack")) return Response.json({ list: [] });
      if (path.endsWith("integration-token/list")) return Response.json({ list: [] });
      if (path.endsWith("process/search")) return Response.json({ items: [] });
      if (path.endsWith("integration-token") && init?.method === "POST") {
        calls.push("mint");
        return Response.json({ id: "new-key", token: "actual-key" });
      }
      if (path.includes("integration-token/")) return Response.json({});
      if (path.includes("first-class-recipe")) {
        calls.push("import");
        return Response.json({});
      }
      throw new Error(`Unexpected native request ${path}`);
    },
  });
  client.restoreSession({ accessToken: "native-person" });
  const operations = accountOperations(
    store,
    registry,
    client,
    () => () => {},
    () => {},
    async () => true,
  );
  const status = makeObserveCredential({ store, api });
  const view = () => observeCredential.derive(readsOfState(store.state()), OBSERVE_KEY);
  const until = (predicate: () => boolean) =>
    new Promise<void>((resolve) => {
      const stop = store.subscribe(() => check());
      const check = () => {
        if (!predicate()) return;
        stop();
        resolve();
      };
      check();
    });
  const intent = {
    kind: "import-container" as const,
    ...OBSERVE_KEY,
    projectName: "Mate",
    agents: [],
  };
  return {
    store,
    calls,
    status,
    view,
    until,
    operations,
    intent,
    acknowledged: () =>
      readsOfState(store.state()).fact("hqObserveCredentialRequest", JSON.stringify(["org", "p"]))
        .kind === "known",
    close: async () => {
      status.close();
      releaseWriter();
      registry.dispose();
      await closeAccountLifetime();
    },
  };
}

it("an older metadata read cannot overwrite an acknowledged authorization", async () => {
  const first = deferred<typeof NONE>();
  const firstStarted = deferred<void>();
  const r = automaticStatusRig({
    read: (number) => {
      if (number > 1) return Promise.resolve(AUTH);
      firstStarted.resolve();
      return first.promise;
    },
    establish: async () => {},
  });
  const release = r.status.demand(OBSERVE_KEY);
  try {
    await firstStarted.promise;
    const writing = r.operations.submit(r.intent);
    await writing;
    const afterAck: Array<ReturnType<typeof r.view>["metadata"]> = [];
    const stop = r.store.subscribe(() => afterAck.push(r.view().metadata));
    first.resolve(NONE);
    await writing;
    await r.until(() => {
      const metadata = r.view().metadata;
      return metadata.state === "known" && !metadata.stale;
    });
    stop();
    expect(afterAck).not.toContainEqual({ state: "known", value: NONE, stale: false });
    expect(r.view().metadata).toEqual({ state: "known", value: AUTH, stale: false });
    expect(r.calls.filter((call) => call === "authorize")).toEqual(["authorize"]);
  } finally {
    release();
    await r.close();
  }
});

it("a metadata read begun during authorization cannot replace its later acknowledged authority", async () => {
  const authorization = deferred<void>();
  const asked = deferred<void>();
  const during = deferred<typeof NONE>();
  const duringStarted = deferred<void>();
  const r = automaticStatusRig({
    read: (number) => {
      if (number === 1) return Promise.resolve(NONE);
      if (number > 2) return Promise.resolve(AUTH);
      duringStarted.resolve();
      return during.promise;
    },
    establish: () => {
      asked.resolve();
      return authorization.promise;
    },
  });
  const release = r.status.demand(OBSERVE_KEY);
  try {
    await r.until(() => r.view().metadata.state === "known");
    const writing = r.operations.submit(r.intent);
    await asked.promise;
    r.status.again(OBSERVE_KEY);
    await duringStarted.promise;
    authorization.resolve();
    await writing;
    const afterAck: Array<ReturnType<typeof r.view>["metadata"]> = [];
    const stop = r.store.subscribe(() => afterAck.push(r.view().metadata));
    during.resolve(NONE);
    await writing;
    await r.until(() => {
      const metadata = r.view().metadata;
      return metadata.state === "known" && !metadata.stale;
    });
    stop();
    expect(afterAck.length).toBeGreaterThan(0);
    expect(afterAck).not.toContainEqual({ state: "known", value: NONE, stale: false });
    expect(r.view().metadata).toEqual({ state: "known", value: AUTH, stale: false });
  } finally {
    release();
    await r.close();
  }
});

it("a lost authorization answer stays unresolved and cannot automatically issue again", async () => {
  const r = automaticStatusRig({
    read: async () => NONE,
    establish: async () => {
      throw new TypeError("offline");
    },
  });
  const release = r.status.demand(OBSERVE_KEY);
  try {
    await r.until(() => r.view().metadata.state === "known");
    const answer = await r.operations.submit(r.intent, "original-provisioning");
    expect(answer.progress).toEqual({ stage: "uncertain", next: "ask-owner-again" });
    expect(r.store.state().operations.get(answer.requestId)?.receipt).toBeNull();
    await r.operations.submit(r.intent, answer.requestId);
    await r.operations.askAgain(answer.requestId);
    const reread = r.until(() => r.calls.filter((call) => call === "read").length > 1);
    r.status.again(OBSERVE_KEY);
    await reread;
    expect(r.calls.filter((call) => call === "authorize")).toEqual(["authorize"]);
    expect(r.calls).not.toContain("import");
    expect(r.acknowledged()).toBe(false);
    expect(r.operations.readProgress(answer.requestId)).toEqual({
      stage: "uncertain",
      next: "ask-owner-again",
    });
  } finally {
    release();
    await r.close();
  }
});

it.each(["mint", "regenerate"] as const)(
  "real account provisioning captures the %s performer before native awaits and never binds a later viewer or delegation creator",
  async (credential) => {
    openAccountLifetime("actual-finisher");
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    [...liveProjects("org", [{ id: "p" }]), ...membershipInputs("ADMIN", false)].forEach(
      store.dispatch,
    );
    const order: string[] = [];
    const authorizations: unknown[] = [];
    const writer = (person: string) =>
      makeHqApi({
        address: "https://hq.example.test",
        orgId: "org",
        accessToken: async () => "person-native-access",
        openSocket: () => {
          throw new Error("No stream needed");
        },
        fetch: async (url, init) => {
          if (url.endsWith("/api/door"))
            return Response.json({ session: person, expiresAt: "later" });
          order.push("authorize");
          authorizations.push({
            path: new URL(url).pathname,
            person: new Headers(init?.headers).get("authorization"),
            body: JSON.parse(String(init?.body)),
          });
          return new Response(null, { status: 204 });
        },
      });
    const release = holdHqWrites("org", writer("actual-finisher"), "hq");
    let releaseNext = () => {};
    const token = {
      id: "earlier",
      name: "zcp-Mate",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "p", roleCode: "BASIC_USER" }],
      createdByUser: { id: "birthmaker-delegator" },
    };
    const client = new ZeropsApiClient({
      baseUrl: "https://api.example.test",
      fetch: async (url, init) => {
        const path = new URL(url).pathname;
        if (path.includes("service-stack")) {
          releaseNext = holdHqWrites("org", writer("later-viewer"), "hq");
          return Response.json({ list: [] });
        }
        if (path.endsWith("integration-token/list"))
          return Response.json({ list: credential === "regenerate" ? [token] : [] });
        if (path.endsWith("process/search")) return Response.json({ items: [] });
        if (path.endsWith("integration-token") && init?.method === "POST") {
          order.push("key");
          return Response.json({ id: "new-key", token: "actual-key" });
        }
        if (path.endsWith("regenerate")) {
          order.push("key");
          return Response.json({ token: "actual-key" });
        }
        if (path.includes("integration-token/")) return Response.json({});
        if (path.includes("first-class-recipe")) {
          order.push("import");
          return Response.json({});
        }
        throw new Error(`Unexpected native request ${path}`);
      },
    });
    client.restoreSession({ accessToken: "native-person" });
    try {
      const operations = accountOperations(
        store,
        registry,
        client,
        () => () => {},
        () => {},
        async () => true,
      );
      const answer = await operations.submit({
        kind: "import-container",
        orgId: "org",
        projectId: "p",
        projectName: "Mate",
        agents: [],
      });
      expect(answer.evidence).toBe("Zerops answered the write.");
      expect(order).toEqual(["key", "authorize", "import"]);
      expect(authorizations).toEqual([
        {
          path: "/api/mates/p/zcp-authorization",
          person: "Bearer actual-finisher",
          body: { keyHash: "4b8ea91d2ae14171d28e8d578b07bf090e4d3af8b3c9577549b2fc8c66bad650" },
        },
      ]);
      expect(JSON.stringify([...store.state().operations])).not.toContain("actual-key");
    } finally {
      releaseNext();
      release();
      registry.dispose();
      await closeAccountLifetime();
    }
  },
);

it.each([false, true])(
  "without an HQ writer an existing container=%s makes no authorization request",
  async (existing) => {
    openAccountLifetime("finisher");
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    [...liveProjects("org", [{ id: "p" }]), ...membershipInputs("ADMIN", false)].forEach(
      store.dispatch,
    );
    const writes: string[] = [];
    const client = new ZeropsApiClient({
      baseUrl: "https://api.example.test",
      fetch: async (url, init) => {
        const path = new URL(url).pathname;
        if (path.includes("service-stack"))
          return Response.json({
            list: existing
              ? [
                  {
                    id: "svc",
                    name: "zcp",
                    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
                  },
                ]
              : [],
          });
        if (path.endsWith("integration-token/list")) return Response.json({ list: [] });
        if (init?.method === "POST" && path.endsWith("integration-token")) {
          writes.push("mint");
          return Response.json({ id: "key", token: "actual-key" });
        }
        if (path.includes("first-class-recipe")) {
          writes.push("import");
          return Response.json({});
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    });
    client.restoreSession({ accessToken: "native-person" });
    try {
      const operations = accountOperations(
        store,
        registry,
        client,
        () => () => {},
        () => {},
        async () => true,
      );
      const result = await operations.submit({
        kind: "import-container",
        orgId: "org",
        projectId: "p",
        projectName: "Mate",
        agents: [],
      });
      expect(writes).toEqual(existing ? [] : ["mint"]);
      expect(store.state().operations.get(result.requestId)?.receipt?.acceptance).toEqual(
        existing
          ? { kind: "accepted", result: { serviceName: "zcp", imported: false } }
          : { kind: "refused", reason: "HQ is not ready to record this Mate's ZCP authorization." },
      );
    } finally {
      registry.dispose();
      await closeAccountLifetime();
    }
  },
);
