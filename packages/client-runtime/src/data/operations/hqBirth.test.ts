/**
 * HQ's birth's writes at Zerops: each asks first where it stands and writes only what is missing;
 * a journal slot and a domain's sync end as their processes do; a lost answer is never sent again.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { operationResult, type OperationIntent } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { makeOperations } from "./coordinator.ts";
import { hqBirthExecutor, type HqBirthWritesPlatform } from "./executors/hqBirth.ts";
import { HQ_BIRTH_SLOT_TAKEN } from "./hqBirth.ts";

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  return store;
}

const notCalled = () => Promise.reject(new Error("not called"));

function operationsOf(store: AccountStore, platform: Partial<HqBirthWritesPlatform>) {
  const submit = hqBirthExecutor(
    {
      createProjectEnv: notCalled,
      hasServiceVariable: notCalled,
      listIntegrationTokens: notCalled,
      mintIntegrationToken: notCalled,
      regenerateIntegrationToken: notCalled,
      writeServiceSecret: notCalled,
      listPublicHttpRoutings: notCalled,
      createPublicHttpRouting: notCalled,
      syncPublicHttpRouting: notCalled,
      listOrganizationMembers: notCalled,
      ...platform,
    },
    (bytes) => bytes.fill(7),
  );
  return makeOperations({ store, executors: { zerops: { submit } }, makeId: () => "r1" });
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");
const record = (store: AccountStore) => store.state().operations.get("r1");

const processRow = (store: AccountStore, id: string, status: string, version: number) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id,
        value: processValue({ id, projectId: "hq", status, actionName: "project.env" }),
        revision: zeropsVersion(version),
      },
    ],
  });

const NOTE: OperationIntent = {
  kind: "hq-birth-note",
  orgId: ORG,
  projectId: "hq",
  key: "MATE_HQ_BIRTH_RECORD_1",
  content: "{}",
};

describe("hq-birth-note", () => {
  it.effect("writes its slot, and the slot's env process ends it", () =>
    Effect.gen(function* () {
      for (const [status, outcome] of [
        ["FINISHED", { stage: "done", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            outcome: "failed",
            reason:
              "Zerops could not save HQ's setup record (FAILED). Inspect its env process in Zerops, then press Again.",
          },
        ],
      ] as const) {
        const store = account();
        const calls: unknown[] = [];
        yield* operationsOf(store, {
          createProjectEnv: async (...args) => {
            calls.push(args);
            return { processId: "env-1" };
          },
        }).submit(NOTE);
        expect(calls).toEqual([["hq", "MATE_HQ_BIRTH_RECORD_1", "{}"]]);
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "env-1" });
        processRow(store, "env-1", status, 2);
        expect(progress(store)).toMatchObject(outcome);
      }
    }),
  );

  it.effect(
    "is refused where another write took its slot first, and uncertain where unanswered",
    () =>
      Effect.gen(function* () {
        for (const [answer, outcome] of [
          [
            Promise.reject(new ZeropsApiError("Env key is not unique.", "invalid-input", 400)),
            { stage: "refused", reason: HQ_BIRTH_SLOT_TAKEN },
          ],
          [Promise.reject(new ZeropsApiError("No answer.", "network")), { stage: "uncertain" }],
          [Promise.resolve({ processId: "" }), { stage: "uncertain" }],
        ] as const) {
          const store = account();
          answer.catch(() => {});
          yield* operationsOf(store, { createProjectEnv: () => answer }).submit(NOTE);
          expect(progress(store)).toMatchObject(outcome);
        }
      }),
  );
});

const TOKENS = (names: ReadonlyArray<string>) =>
  names.map((name, index) => ({ id: `tok-${index + 1}`, name }) as never);

describe("hq-org-token", () => {
  const INTENT: OperationIntent = {
    kind: "hq-org-token",
    orgId: ORG,
    projectId: "hq",
    serviceId: "svc",
  };
  const NAME = "mate-hq-org:hq";

  it.effect("writes Core's token once: minted, or a value-lost one regenerated", () =>
    Effect.gen(function* () {
      for (const [held, tokens, writes, result] of [
        [true, [], [], { tokenId: null }],
        [false, [], ["mint READ_ONLY", "secret svc HQ_ORG_TOKEN minted"], { tokenId: "tok-new" }],
        [
          false,
          [NAME],
          ["regenerate tok-1", "secret svc HQ_ORG_TOKEN regenerated"],
          { tokenId: "tok-1" },
        ],
      ] as const) {
        const store = account();
        const calls: string[] = [];
        yield* operationsOf(store, {
          hasServiceVariable: async ({ key }) => key === "HQ_ORG_TOKEN" && held,
          listIntegrationTokens: async () => TOKENS(tokens),
          mintIntegrationToken: async ({ name, roleCode }) => {
            calls.push(`mint ${roleCode}`);
            expect(name).toBe(NAME);
            return { id: "tok-new", token: "minted" };
          },
          regenerateIntegrationToken: async ({ tokenId }) => {
            calls.push(`regenerate ${tokenId}`);
            return "regenerated";
          },
          writeServiceSecret: async ({ clientId, serviceId, key, content }) => {
            expect(clientId).toBe(ORG);
            calls.push(`secret ${serviceId} ${key} ${content}`);
          },
        }).submit(INTENT);
        expect(calls).toEqual(writes);
        expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        expect(operationResult(record(store), "hq-org-token")).toEqual(result);
      }
    }),
  );

  it.effect(
    "is refused where two tokens bear its name or variables still sync; a lost mint is uncertain",
    () =>
      Effect.gen(function* () {
        for (const [platform, outcome] of [
          [
            { listIntegrationTokens: async () => TOKENS([NAME, NAME]) },
            {
              stage: "refused",
              reason: `More than one token is named ${NAME}. Delete them in Zerops.`,
            },
          ],
          [
            {
              listIntegrationTokens: async () => TOKENS([]),
              mintIntegrationToken: async () => ({ id: "tok-new", token: "minted" }),
              writeServiceSecret: () =>
                Promise.reject(
                  new ZeropsApiError("Sync running.", "invalid-input", 400, "userDataSyncRunning"),
                ),
            },
            {
              stage: "refused",
              reason: "Variables still syncing. Press Again to continue HQ's setup.",
            },
          ],
          [
            {
              listIntegrationTokens: async () => TOKENS([]),
              mintIntegrationToken: () =>
                Promise.reject(new ZeropsApiError("No answer.", "network")),
            },
            { stage: "uncertain" },
          ],
        ] as const) {
          const store = account();
          yield* operationsOf(store, {
            hasServiceVariable: async () => false,
            ...(platform as Partial<HqBirthWritesPlatform>),
          }).submit(INTENT);
          expect(progress(store)).toMatchObject(outcome);
        }
      }),
  );
});

describe("hq-key-secret", () => {
  it.effect("draws HQ's key and writes it only where HQ's service holds none", () =>
    Effect.gen(function* () {
      for (const [held, writes] of [
        [true, []],
        [
          false,
          [`secret svc HQ_KEY_SECRET ${btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))}`],
        ],
      ] as const) {
        const store = account();
        const calls: string[] = [];
        yield* operationsOf(store, {
          hasServiceVariable: async ({ key }) => key === "HQ_KEY_SECRET" && held,
          writeServiceSecret: async ({ clientId, serviceId, key, content }) => {
            expect(clientId).toBe(ORG);
            calls.push(`secret ${serviceId} ${key} ${content}`);
          },
        }).submit({ kind: "hq-key-secret", orgId: ORG, serviceId: "svc" });
        expect(calls).toEqual(writes);
        expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
      }
    }),
  );
});

describe("route-hq-domain", () => {
  const INTENT: OperationIntent = {
    kind: "route-hq-domain",
    orgId: ORG,
    projectId: "hq",
    serviceId: "svc",
    domain: "hq.example",
  };
  const routing = (isSynced: boolean) => ({
    id: "route-1",
    isSynced,
    domains: [{ domainName: "hq.example", sslStatus: undefined, sslError: undefined }],
  });

  it.effect(
    "routes the domain once and syncs it where it is not in place; the sync's process ends it",
    () =>
      Effect.gen(function* () {
        for (const [listed, writes, result, settled] of [
          [[routing(true)], [], { processId: null }, { stage: "done", outcome: "succeeded" }],
          [[routing(false)], ["sync"], { processId: "sync-1" }, { stage: "accepted" }],
          [
            [],
            ["create hq.example 8080 svc", "sync"],
            { processId: "sync-1" },
            { stage: "accepted" },
          ],
        ] as const) {
          const store = account();
          const calls: string[] = [];
          let created = false;
          yield* operationsOf(store, {
            listPublicHttpRoutings: async () =>
              created ? [routing(false)] : (listed as ReadonlyArray<ReturnType<typeof routing>>),
            createPublicHttpRouting: async (_projectId, { domains, locations }) => {
              created = true;
              calls.push(
                `create ${domains.join()} ${locations[0]?.port} ${locations[0]?.serviceStackId}`,
              );
            },
            syncPublicHttpRouting: async () => {
              calls.push("sync");
              return { processId: "sync-1" };
            },
          }).submit(INTENT);
          expect(calls).toEqual(writes);
          expect(progress(store)).toMatchObject(settled);
          expect(operationResult(record(store), "route-hq-domain")).toEqual(result);
        }
        const store = account();
        yield* operationsOf(store, {
          listPublicHttpRoutings: async () => [routing(false)],
          syncPublicHttpRouting: async () => ({ processId: "sync-1" }),
        }).submit(INTENT);
        processRow(store, "sync-1", "FAILED", 2);
        expect(progress(store)).toMatchObject({
          stage: "done",
          outcome: "failed",
          reason:
            "Zerops could not put HQ's domain in place. Inspect its sync process in Zerops, then press Again.",
        });
      }),
  );
});

describe("mark-official-hq", () => {
  const INTENT: OperationIntent = {
    kind: "mark-official-hq",
    orgId: ORG,
    projectId: "hq",
    address: "https://hq.example",
  };
  const NAME = "mate-hq:hq:https://hq.example";
  const anchor = (name: string) => ({ roleCode: "ADMIN", user: { fullName: name } });

  it.effect("mints the mark once, and none where another project is marked already", () =>
    Effect.gen(function* () {
      for (const [members, tokens, writes, outcome] of [
        [[], [], ["mint ADMIN"], { stage: "done", outcome: "succeeded" }],
        [[], [NAME], [], { stage: "done", outcome: "succeeded" }],
        [
          [anchor("mate-hq:other:https://other.example")],
          [],
          [],
          { stage: "refused", reason: "This organization has an HQ already." },
        ],
      ] as const) {
        const store = account();
        const calls: string[] = [];
        yield* operationsOf(store, {
          listOrganizationMembers: async () => members as never,
          listIntegrationTokens: async () => TOKENS(tokens),
          mintIntegrationToken: async ({ name, roleCode }) => {
            calls.push(`mint ${roleCode}`);
            expect(name).toBe(NAME);
            return { id: "tok-anchor", token: "goes nowhere" };
          },
        }).submit(INTENT);
        expect(calls).toEqual(writes);
        expect(progress(store)).toMatchObject(outcome);
      }
    }),
  );
});
