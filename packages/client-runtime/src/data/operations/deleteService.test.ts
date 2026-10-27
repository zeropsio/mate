// @effect-diagnostics nodeBuiltinImport:off -- the guard reads the repository's source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import { deleteServiceExecutor } from "./executors/serviceWrites.ts";

const DELETE = { kind: "delete-service", orgId: ORG, projectId: "p1", serviceId: "s1" } as const;

describe("delete-service", () => {
  it.effect("asks Zerops to delete the one service and is followed by its delete process", () =>
    Effect.gen(function* () {
      const store = accountOf(
        liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }),
      );
      const calls: Array<string> = [];
      const operations = zeropsOperations(
        store,
        deleteServiceExecutor({
          deleteService: async (serviceId) => {
            calls.push(serviceId);
            return { processId: "proc-delete" };
          },
        }),
      );
      yield* operations.submit(DELETE);
      expect(calls).toEqual(["s1"]);
      expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-delete" });
      store.dispatch({
        kind: "rows",
        scope: runningScope(ORG),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "process",
            id: "proc-delete",
            value: processValue({
              id: "proc-delete",
              projectId: "p1",
              status: "FINISHED",
              actionName: "stack.delete",
              serviceStackIds: ["s1"],
            }),
            revision: zeropsVersion(1),
          },
        ],
      });
      expect(progressOf(store)).toEqual({
        stage: "done",
        operationId: "proc-delete",
        outcome: "succeeded",
      });
    }),
  );
});

const ROOT = NodePath.resolve(import.meta.dirname, "../../../../..");
/** Each source file under `dir`, tests and fixtures aside, whose text matches `pattern`. */
const sourcesMatching = (dir: string, pattern: RegExp) =>
  NodeFS.readdirSync(NodePath.join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter(
      (file) =>
        /\.tsx?$/u.test(file) &&
        !/\.test\.tsx?$/u.test(file) &&
        !file.includes("__fixtures__") &&
        !file.includes("node_modules"),
    )
    .filter((file) => pattern.test(NodeFS.readFileSync(NodePath.join(ROOT, dir, file), "utf8")))
    .map((file) => `${dir}/${file}`)
    .sort();

describe("HQ deletes a service only from a person's Delete action", () => {
  it("the only caller of a service's deletion is the Delete a person confirms", () => {
    const where = (pattern: RegExp) => [
      ...sourcesMatching("packages/client-runtime/src", pattern),
      ...sourcesMatching("apps/web/src", pattern),
      ...sourcesMatching("apps/mobile/src", pattern),
    ];
    // Zerops' delete: called by the executor and the wiring that hands it the client alone.
    expect(where(/\.deleteService\(/u)).toEqual([
      "packages/client-runtime/src/data/operations/executors/serviceWrites.ts",
      "packages/client-runtime/src/data/operations/executors/zerops.ts",
    ]);
    expect(where(/deleteServiceExecutor\(/u)).toEqual([
      "packages/client-runtime/src/data/operations/executors/serviceWrites.ts",
      "packages/client-runtime/src/data/operations/executors/zerops.ts",
    ]);
    // The operation is asked by one hook, and the hook only by the confirmed Delete.
    expect(where(/kind: "delete-service",\s+orgId/u)).toEqual([
      "apps/web/src/zerops/deleteService.ts",
    ]);
    expect(where(/useDeleteService\(/u)).toEqual([
      "apps/web/src/components/zerops/StopTierStops.tsx",
      "apps/web/src/zerops/deleteService.ts",
    ]);
  });
});
