import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/reactivity";
import { ZeropsApiClient } from "../../zerops/api.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { makeZeropsExecutor } from "./executors/zerops.ts";

function executorFor(client: ZeropsApiClient, store: AccountStore, active: () => boolean) {
  return makeZeropsExecutor({
    client,
    store,
    active,
    viewerOf: () => ({ id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" }),
    readDetail: async () => false,
    demandDetail: () => () => undefined,
    revalidate: () => undefined,
  });
}

// witness: packages/client-runtime/src/data/operations/executors/zerops.ts | startProject(source.door, id, check) → startProject(source.door, id)
it.effect(
  "OP22: A queued Zerops Start checks access and ownership after token renewal and cannot start a project newly held by HQ",
  () =>
    Effect.gen(function* () {
      const startAfter = (change: "closed" | "denied" | "placed" | "allowed") =>
        Effect.gen(function* () {
          const registry = AtomRegistry.make();
          const store = makeAccountStore(registry);
          for (const input of liveProjects("org", [{ id: "p", name: "Before" }]))
            store.dispatch(input);
          let active = true;
          const requests: string[] = [];
          const session = {
            accessToken: "access-before",
            refreshToken: "refresh",
            expiresAt: "2099-01-01T00:00:00Z",
            expiresIn: 3600,
            userId: "user",
          };
          const client = new ZeropsApiClient({
            baseUrl: "https://api.example.test",
            fetch: async (url, init) => {
              const path = new URL(url).pathname;
              if (path.endsWith("/auth/refresh") && init?.method === "POST") {
                requests.push("refresh");
                if (change === "closed") active = false;
                if (change === "denied")
                  store.dispatch({ kind: "access", family: "project", id: "p", access: "denied" });
                if (change === "placed")
                  seedHqNavigation(store, "org", {
                    structure: {
                      apps: [],
                      ungrouped: [{ projectId: "p", name: "Project", mate: { face: "" } }],
                    },
                  });
                return Response.json({ ...session, accessToken: "access-after" });
              }
              expect(path).toMatch(/\/project\/p\/start$/u);
              expect(init?.method).toBe("PUT");
              const bearer = new Headers(init?.headers).get("Authorization");
              requests.push(`start with ${bearer}`);
              return bearer === "Bearer access-before"
                ? Response.json({}, { status: 401 })
                : Response.json({});
            },
          });
          client.restoreSession(session);
          const executor = executorFor(client, store, () => active);
          const result = yield* Effect.result(
            executor.submit("start", {
              kind: "start-project",
              orgId: "org",
              projectId: "p",
            }),
          );
          if (Result.isFailure(result)) expect(result.failure.outcome).toBe("definitive-refusal");
          registry.dispose();
          return { accepted: Result.isSuccess(result), requests };
        });
      const refused = ["start with Bearer access-before", "refresh"];
      expect(yield* startAfter("closed")).toEqual({ accepted: false, requests: refused });
      expect(yield* startAfter("denied")).toEqual({ accepted: false, requests: refused });
      expect(yield* startAfter("placed")).toEqual({ accepted: false, requests: refused });
      expect(yield* startAfter("allowed")).toEqual({
        accepted: true,
        requests: [...refused, "start with Bearer access-after"],
      });
    }),
);
