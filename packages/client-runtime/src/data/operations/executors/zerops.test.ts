import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/reactivity";
import { ZeropsApiClient } from "../../../zerops/api.ts";
import { HqError } from "../../../zerops/hq/client.ts";
import { liveProjects } from "../../__fixtures__/account.ts";
import { makeAccountStore, type AccountStore } from "../../store.ts";
import { makeZeropsExecutor } from "./zerops.ts";

function executorFor(
  client: ZeropsApiClient,
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  active: () => boolean,
  viewerOf = () => ({ id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" }),
  hqApiOf: Parameters<typeof makeZeropsExecutor>[0]["hqApiOf"] = () => null,
) {
  return makeZeropsExecutor({
    client,
    hqApiOf,
    store,
    registry,
    active,
    viewerOf,
    readDetail: async () => false,
    demandDetail: () => () => undefined,
    revalidate: () => undefined,
    nowMs: () => 0,
    run: () => Promise.reject(new Error("No nested operation.")),
    makeId: () => "nested",
  });
}

it.effect.each(["closed", "denied", "allowed"] as const)(
  "a queued record write rechecks %s access after its source read",
  (change) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      for (const input of liveProjects("org", [{ id: "p", name: "Before" }])) store.dispatch(input);
      let active = true;
      const writes: string[] = [];
      let name = "Before";
      const client = new ZeropsApiClient({
        baseUrl: "https://api.example.test",
        fetch: async (_url, init) => {
          if (init?.method === "PUT") {
            writes.push("rename");
            name = "After";
          } else {
            if (change === "closed") active = false;
            if (change === "denied")
              store.dispatch({ kind: "access", family: "project", id: "p", access: "denied" });
          }
          return new Response(
            JSON.stringify({ id: "p", clientId: "org", name, status: "ACTIVE", tagList: [] }),
            { status: 200 },
          );
        },
      });
      const executor = executorFor(client, store, registry, () => active);
      const result = yield* Effect.result(
        executor.submit("rename", {
          kind: "rename-project",
          orgId: "org",
          projectId: "p",
          from: "Before",
          name: "After",
        }),
      );
      expect(Result.isSuccess(result)).toBe(change === "allowed");
      if (Result.isFailure(result)) expect(result.failure.outcome).toBe("definitive-refusal");
      expect(writes).toEqual(change === "allowed" ? ["rename"] : []);
      registry.dispose();
    }),
);

it.effect.each(["ended", "lowered"] as const)(
  "hand-over retains its first write but sends no remainder after access is $0",
  (change) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      liveProjects("org", [{ id: "p" }]).forEach(store.dispatch);
      let active = true;
      let roleCode = "ADMIN";
      const writes: string[] = [];
      const client = new ZeropsApiClient({
        baseUrl: "https://api.example.test",
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname;
          if (init?.method === "PUT") writes.push(path);
          if (path.endsWith("/roles"))
            return new Response(
              JSON.stringify({ projectRoleList: [{ projectId: "sibling", roleCode: "OWNER" }] }),
            );
          if (writes.length === 1) {
            if (change === "ended") active = false;
            else roleCode = "READ_ONLY";
          }
          return new Response(
            JSON.stringify({
              id: "p",
              clientId: "org",
              name: "Mate",
              status: "ACTIVE",
              userRoles: [
                { clientUserId: "ada", roleCode: "OWNER" },
                { clientUserId: "bob", roleCode: "OWNER" },
              ],
            }),
          );
        },
      });
      const executor = executorFor(
        client,
        store,
        registry,
        () => active,
        () => ({ id: "org", name: "Org", membershipId: "member", roleCode }),
      );
      const result = yield* Effect.result(
        executor.submit("original", {
          kind: "assign-mate-owner",
          orgId: "org",
          projectId: "p",
          clientUserId: "ada",
        }),
      );
      expect(writes).toEqual(["/api/rest/public/client-user/ada/roles"]);
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result) && !("unobservable" in result.success)) {
        expect(result.success.acceptance).toEqual({
          kind: "accepted",
          result: { previousOwnerIds: ["bob"] },
        });
        expect(result.success.outcome.kind).toBe("failed");
      }
      registry.dispose();
    }),
);

it.effect.each(["assignment", "removal"] as const)(
  "a role write accepted before a denied $0 read-back stays unresolved",
  (step) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      liveProjects("org", [{ id: "p" }]).forEach(store.dispatch);
      const writes: string[] = [];
      const client = new ZeropsApiClient({
        baseUrl: "https://api.example.test",
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname;
          if (init?.method === "PUT") writes.push(path);
          if (path.endsWith("/roles")) return new Response(JSON.stringify({ projectRoleList: [] }));
          if (writes.length >= (step === "assignment" ? 1 : 2))
            return new Response(null, { status: 403 });
          return new Response(
            JSON.stringify({
              id: "p",
              clientId: "org",
              name: "Mate",
              status: "ACTIVE",
              userRoles: [
                { clientUserId: "ada", roleCode: "OWNER" },
                { clientUserId: "bob", roleCode: "OWNER" },
              ],
            }),
          );
        },
      });
      const result = yield* Effect.result(
        executorFor(client, store, registry, () => true).submit("original", {
          kind: "assign-mate-owner",
          orgId: "org",
          projectId: "p",
          clientUserId: "ada",
        }),
      );
      expect(writes).toEqual(
        step === "assignment"
          ? ["/api/rest/public/client-user/ada/roles"]
          : ["/api/rest/public/client-user/ada/roles", "/api/rest/public/client-user/bob/roles"],
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success).toHaveProperty("unobservable.nextActor", "person");
        if (step === "removal" && "unobservable" in result.success)
          expect(result.success.receipt?.acceptance).toEqual({
            kind: "accepted",
            result: { previousOwnerIds: ["bob"] },
          });
      }
      registry.dispose();
    }),
);

it.effect.each(["ended", "allowed"] as const)(
  "exact-key cleanup fences the $0 account again after its source read",
  (change) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const target = { orgId: "org", hqProjectId: "hq", projectId: "p" };
      store.dispatch({
        kind: "operation-recorded",
        requestId: "prepare",
        intent: { kind: "prepare-mate-deletion", ...target },
      });
      store.dispatch({
        kind: "operation-recorded",
        requestId: "complete",
        intent: {
          kind: "complete-mate-deletion",
          ...target,
          preparedRequestId: "prepare",
          completion: "proof",
        },
      });
      for (const requestId of ["prepare", "complete"])
        store.dispatch({
          kind: "operation-receipt",
          receipt: {
            requestId,
            operationId: "p",
            executor: "hq",
            affected: [],
            handles: ["p"],
            acceptance: {
              kind: "accepted",
              ...(requestId === "prepare"
                ? { result: { keyTokenId: "key-1", completion: "proof" } }
                : {}),
            },
            outcome: { kind: "succeeded", evidence: "HQ confirmed deletion" },
          },
        });
      let active = true;
      const deletes: string[] = [];
      const client = new ZeropsApiClient({
        baseUrl: "https://api.example.test",
        fetch: async (url, init) => {
          if (init?.method === "DELETE") {
            deletes.push(new URL(String(url)).pathname);
            return new Response(null, { status: 204 });
          }
          if (change === "ended") active = false;
          return new Response(JSON.stringify({ id: "key-1" }));
        },
      });
      const result = yield* Effect.result(
        executorFor(client, store, registry, () => active).submit("retire", {
          kind: "retire-mate-key",
          orgId: "org",
          projectId: "p",
          tokenId: "key-1",
          preparedRequestId: "prepare",
          completionRequestId: "complete",
        }),
      );
      expect(Result.isSuccess(result)).toBe(change === "allowed");
      expect(deletes).toEqual(
        change === "allowed" ? ["/api/rest/public/client/org/integration-token/key-1"] : [],
      );
      registry.dispose();
    }),
);

it.effect.each([
  "current",
  "account-ended-before",
  "account-ended-during",
  "native-ended-during",
  "refused",
  "unsupported",
  "existing",
] as const)(
  "Mate provisioning uses the captured credential performer and fences $0 authorization",
  (change) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      liveProjects("org", [{ id: "p" }]).forEach(store.dispatch);
      let active = true;
      let currentPerformer = "actual-finisher";
      const order: string[] = [];
      const established: unknown[] = [];
      const client = new ZeropsApiClient({
        baseUrl: "https://api.example.test",
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname;
          if (path.includes("service-stack"))
            return Response.json({
              list:
                change === "existing"
                  ? [
                      {
                        id: "svc",
                        name: "zcp",
                        serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
                      },
                    ]
                  : [],
            });
          if (path.endsWith("integration-token/list")) {
            currentPerformer = "later-viewer";
            return Response.json({ list: [] });
          }
          if (path.endsWith("integration-token") && init?.method === "POST") {
            order.push("mint");
            if (change === "account-ended-before") active = false;
            return Response.json({
              id: "key",
              token: "actual-key",
              createdByUser: { id: "delegating-creator" },
            });
          }
          if (path.includes("first-class-recipe")) {
            order.push("import");
            return Response.json({});
          }
          throw new Error(`Unexpected native request: ${path}`);
        },
      });
      client.restoreSession({ accessToken: "native-person" });
      const executor = executorFor(
        client,
        store,
        registry,
        () => active,
        undefined,
        (orgId) => {
          expect(orgId).toBe("org");
          const captured = currentPerformer;
          if (change === "unsupported") return {};
          return {
            establishZcpAuthorization: async (projectId, context) => {
              order.push("authorize");
              established.push({ performer: captured, projectId, ...context });
              if (change === "account-ended-during") active = false;
              if (change === "native-ended-during") client.forgetSession();
              if (change === "refused")
                throw new HqError({
                  kind: "refused",
                  code: "forbidden",
                  message: "HQ refused ZCP authorization",
                });
            },
          };
        },
      );
      const result = yield* Effect.result(
        executor.submit("provision", {
          kind: "import-container",
          orgId: "org",
          projectId: "p",
          projectName: "Mate",
          agents: [],
        }),
      );
      expect(order).toEqual(
        change === "existing"
          ? []
          : change === "current"
            ? ["mint", "authorize", "import"]
            : change === "account-ended-before" || change === "unsupported"
              ? ["mint"]
              : ["mint", "authorize"],
      );
      expect(established).toEqual(
        change === "existing" || change === "account-ended-before" || change === "unsupported"
          ? []
          : [
              {
                performer: "actual-finisher",
                projectId: "p",
                keyHash: "4b8ea91d2ae14171d28e8d578b07bf090e4d3af8b3c9577549b2fc8c66bad650",
              },
            ],
      );
      expect(Result.isSuccess(result)).toBe(change === "current" || change === "existing");
      if (Result.isFailure(result) && (change === "refused" || change === "unsupported"))
        expect(result.failure).toEqual({
          outcome: "definitive-refusal",
          message:
            change === "unsupported"
              ? "HQ is not ready to record this Mate's ZCP authorization."
              : "HQ refused ZCP authorization",
        });
      registry.dispose();
    }),
);
