import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/unstable/reactivity";
import { ZeropsApiClient } from "../../../zerops/api.ts";
import { liveProjects } from "../../__fixtures__/account.ts";
import { makeAccountStore } from "../../store.ts";
import { makeZeropsExecutor } from "./zerops.ts";

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
      const executor = makeZeropsExecutor({
        client,
        store,
        registry,
        active: () => active,
        viewerOf: () => ({ id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" }),
        readDetail: async () => false,
        demandDetail: () => () => undefined,
        revalidate: () => undefined,
        debtOf: () => {
          throw new Error("No credentials in this operation.");
        },
        nowMs: () => 0,
        run: () => Promise.reject(new Error("No nested operation.")),
        makeId: () => "nested",
        hqCore: () => Promise.reject(new Error("No HQ artifact.")),
      });
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
