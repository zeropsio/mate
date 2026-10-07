/**
 * The writes a creation makes at Zerops after its project, each answered at once: an import of a
 * whole project, of services, of a Mate's container, and a project's hardening. Each is done when
 * Zerops answers; a lost answer is never sent again.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops, ORG, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { projectsScope } from "../families/project.ts";
import { operationResult, type OperationIntent } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { makeOperations } from "./coordinator.ts";
import { creationWritesExecutor, type CreationWritesPlatform } from "./executors/creationWrites.ts";

function account(projects: ReadonlyArray<{ readonly id: string; readonly name?: string }> = []) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [], projects }).forEach(store.dispatch);
  return store;
}

function projectAppears(store: AccountStore, id: string, name: string) {
  store.dispatch({
    kind: "membership",
    scope: projectsScope(ORG),
    generation: 1,
    delta: { add: [id], remove: [] },
  });
  store.dispatch({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      { family: "project", id, value: projectValue({ id, name }), revision: zeropsVersion(1) },
    ],
  });
}

const notCalled = () => Promise.reject(new Error("not called"));

function operationsOf(store: AccountStore, platform: Partial<CreationWritesPlatform>) {
  const submit = creationWritesExecutor({
    importProject: notCalled,
    importServicesIntoProject: notCalled,
    importDevelopmentContainer: notCalled,
    hardenMate: notCalled,
    readProjectEnv: notCalled,
    ...platform,
  });
  return makeOperations({ store, executors: { zerops: { submit } }, makeId: () => "r1" });
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");
const record = (store: AccountStore) => store.state().operations.get("r1");

const IMPORT_PROJECT = {
  kind: "import-project",
  orgId: ORG,
  name: "shop-prod",
  yaml: "project: shop-prod",
} as const;

describe("a creation's writes at Zerops", () => {
  it.effect("are done once Zerops answers, each with what it answered", () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const cases: ReadonlyArray<
        readonly [OperationIntent, Partial<CreationWritesPlatform>, unknown]
      > = [
        [
          IMPORT_PROJECT,
          {
            importProject: async (clientId, yaml) => {
              calls.push(["importProject", clientId, yaml]);
              return { projectId: "p9" };
            },
          },
          { projectId: "p9" },
        ],
        [
          { kind: "import-services", orgId: ORG, projectId: "p9", yaml: "services: []" },
          {
            importServicesIntoProject: async (projectId, yaml) => {
              calls.push(["importServices", projectId, yaml]);
              return [];
            },
          },
          undefined,
        ],
        [
          {
            kind: "import-container",
            orgId: ORG,
            projectId: "p9",
            projectName: "shop-mate",
            agents: ["claude-code"],
            setupRuntimesYaml: "runtimes",
          },
          {
            importDevelopmentContainer: async (input) => {
              calls.push(["importContainer", input]);
              return { serviceName: "zcp", imported: true, processId: "proc-zcp" };
            },
          },
          { serviceName: "zcp", imported: true, processId: "proc-zcp" },
        ],
        [
          { kind: "harden-project", orgId: ORG, projectId: "p9", keyTokenId: "tok-1" },
          {
            hardenMate: async (clientId, projectId, keyTokenId) => {
              calls.push(["harden", clientId, projectId, keyTokenId]);
              return { keyNotLowered: "Zerops refused." };
            },
          },
          { keyNotLowered: "Zerops refused." },
        ],
      ];
      for (const [intent, platform, result] of cases) {
        const store = account();
        yield* operationsOf(store, platform).submit(intent);
        expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        expect(operationResult(record(store), intent.kind as never)).toEqual(result);
      }
      expect(calls).toEqual([
        ["importProject", ORG, "project: shop-prod"],
        ["importServices", "p9", "services: []"],
        [
          "importContainer",
          {
            clientId: ORG,
            projectId: "p9",
            projectName: "shop-mate",
            agents: ["claude-code"],
            setupRuntimesYaml: "runtimes",
          },
        ],
        ["harden", ORG, "p9", "tok-1"],
      ]);
    }),
  );

  it.effect("a hardening asked to confirm reads the project closed off, writing only if not", () =>
    Effect.gen(function* () {
      for (const [reads, written, outcome] of [
        [["service"], false, { stage: "done", outcome: "succeeded" }],
        [["none", "service"], true, { stage: "done", outcome: "succeeded" }],
        [
          ["none", "none"],
          true,
          { stage: "refused", reason: "The project does not read as closed off yet." },
        ],
        [
          [undefined],
          false,
          { stage: "refused", reason: "The project's isolation could not be read." },
        ],
      ] as const) {
        const store = account();
        const queue = [...reads];
        let hardened = false;
        yield* operationsOf(store, {
          readProjectEnv: async () => {
            const value = queue.shift();
            return value === undefined ? [] : [{ key: "envIsolation", content: value }];
          },
          hardenMate: async () => {
            hardened = true;
            return { keyNotLowered: null };
          },
        }).submit({ kind: "harden-project", orgId: ORG, projectId: "p9", confirm: true });
        expect(hardened).toBe(written);
        expect(progress(store)).toMatchObject(outcome);
      }
    }),
  );

  it.effect("a lost import of a project adopts the one project of its name that appeared", () =>
    Effect.gen(function* () {
      const store = account([{ id: "p1", name: "shop-prod" }]);
      yield* operationsOf(store, {
        importProject: async () => {
          projectAppears(store, "p9", "shop-prod");
          throw new ZeropsApiError("Zerops may have accepted this operation.", "uncertain");
        },
      }).submit(IMPORT_PROJECT);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(operationResult(record(store), "import-project")).toEqual({ projectId: "p9" });
    }),
  );

  it.effect("a lost answer otherwise stays uncertain with what it said, never sent again", () =>
    Effect.gen(function* () {
      const store = account();
      let sent = 0;
      yield* operationsOf(store, {
        importServicesIntoProject: async () => {
          sent += 1;
          throw new ZeropsApiError("Zerops may have accepted this operation.", "uncertain");
        },
      }).submit({ kind: "import-services", orgId: ORG, projectId: "p9", yaml: "services: []" });
      expect(sent).toBe(1);
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      expect(record(store)?.uncertainBecause).toBe("Zerops may have accepted this operation.");
    }),
  );

  it.effect("a refusal keeps what Zerops said", () =>
    Effect.gen(function* () {
      const store = account();
      yield* operationsOf(store, {
        importServicesIntoProject: async () => {
          throw new ZeropsApiError("serviceStackNameUnavailable", "invalid-input", 400);
        },
      }).submit({ kind: "import-services", orgId: ORG, projectId: "p9", yaml: "services: []" });
      expect(progress(store)).toEqual({
        stage: "refused",
        reason: "serviceStackNameUnavailable",
      });
    }),
  );
});
