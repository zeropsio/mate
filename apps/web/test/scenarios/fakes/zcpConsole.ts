import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { SpawnDataConsole } from "../../../../server/src/zerops/ZeropsDataConsole.ts";
import { deadline, serve } from "../harness/http.ts";

/** The external zcp schema protocol only: the Mate routes and normalizes these HTTP bodies. */
export const ordersConsole = Effect.fn("ordersConsole")(function* () {
  const requested = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const requests: string[] = [];
  let starts = 0;
  const token = "scenario-console-token";
  const http = yield* Effect.acquireRelease(
    Effect.promise(() =>
      serve(async (request) => {
        requests.push(`${request.method} ${request.url.pathname}`);
        expect(request.headers.authorization).toBe(`Bearer ${token}`);
        if (request.url.pathname === "/api/refresh") {
          expect(request.method).toBe("POST");
          return { body: {} };
        }
        if (request.url.pathname === "/api/services")
          return {
            body: {
              project: { id: "Ada", name: "Ada" },
              allowWrites: false,
              services: [
                {
                  hostname: "ordersdb",
                  type: "postgresql@16",
                  family: "postgres",
                  support: "supported",
                  status: "ACTIVE",
                  actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
                },
              ],
            },
          };
        expect(request.url.searchParams.get("service")).toBe("ordersdb");
        if (request.url.pathname === "/api/tree")
          return {
            body: {
              nextCursor: "",
              nodes: [
                {
                  name: "orders",
                  kind: "tabular",
                  path: { service: "ordersdb", segments: ["public", "orders"] },
                  hasChildren: false,
                },
              ],
            },
          };
        if (request.url.pathname === "/api/table") {
          expect(request.url.searchParams.get("segs")).toBe('["public","orders"]');
          requested.resolve();
          await released.promise;
          return {
            body: {
              columns: [
                {
                  name: "order_id",
                  dataType: "uuid",
                  pk: true,
                  editable: false,
                  reason: "Read-only schema",
                  sortable: true,
                  sortReason: "",
                },
              ],
              rows: [],
              nextCursor: "",
              rowKeyCols: ["order_id"],
              bestEffort: false,
              numbered: false,
            },
          };
        }
        throw new Error(`Unexpected console source ${request.method} ${request.url.pathname}`);
      }),
    ),
    (http) =>
      Effect.promise(async () => {
        released.resolve();
        await http.close();
      }),
  );
  const spawn: SpawnDataConsole = () => {
    starts += 1;
    let exited = false;
    let onExit: ((code: number | null) => void) | undefined;
    const end = () => {
      if (!exited) {
        exited = true;
        onExit?.(0);
      }
    };
    return {
      onStdout: (listener) =>
        listener(
          `${JSON.stringify({
            url: http.origin,
            sessionToken: token,
            allowWrites: false,
          })}\n`,
        ),
      onStderr: () => {},
      onError: () => {},
      onExit: (listener) => {
        onExit = listener;
      },
      endStdin: end,
      kill: end,
    };
  };
  return {
    spawn,
    requests,
    starts: () => starts,
    requested: () => deadline(requested.promise, "zcp table request"),
    release: released.resolve,
  };
});
