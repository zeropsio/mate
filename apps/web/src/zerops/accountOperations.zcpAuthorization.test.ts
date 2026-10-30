import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore } from "@t3tools/client-runtime/data";
import { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { makeHqApi } from "@t3tools/client-runtime/zerops/hq";
import { liveProjects, membershipInputs } from "@t3tools/client-runtime/data/fixtures";
import { accountOperations } from "./accountOperations";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { holdHqWrites } from "./hqWrites";

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
