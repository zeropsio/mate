/**
 * The writes a creation makes at HQ: its application, a Mate's birth and its bind, a project's
 * attach, a Mate's record and its close-off, an environment's deploy key. HQ answers each at once;
 * where an answer is lost, HQ's navigation showing its effect — absent at the send — adopts it.
 * HQ keeps no request ids here: nothing is asked by one, and nothing is sent again blindly.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { operationResult, type OperationIntent } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { HqError, type HqStructure } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

type App = HqStructure["apps"][number];
const app = (patch: Partial<App> = {}): App =>
  ({ id: "app-1", name: "Shop", projects: [], births: [], environments: [], ...patch }) as App;

function account(apps: ReadonlyArray<App> = [app()]) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, { structure: { apps: [...apps], ungrouped: [] } as never });
  return store;
}
/** HQ's navigation moves on to these applications. */
const hqSays = (store: AccountStore, apps: ReadonlyArray<App>) =>
  seedHqNavigation(store, ORG, { structure: { apps: [...apps], ungrouped: [] } as never });

const lost = new HqError({ kind: "uncertain", code: "network", message: "HQ's answer was lost." });

function operationsOf(store: AccountStore, api: Partial<HqWrites>, zerops = fakeZerops()) {
  const calls: string[] = [];
  const asked = (name: string) => () => Promise.reject(new Error(`${name} was not expected`));
  const executor = makeHqExecutor({
    apiOf: (orgId) => {
      calls.push(`hq ${orgId}`);
      return {
        updateMate: asked("updateMate"),
        renameApp: asked("renameApp"),
        deleteApp: asked("deleteApp"),
        createApp: asked("createApp"),
        recordBirth: asked("recordBirth"),
        bindBirth: asked("bindBirth"),
        attachProject: asked("attachProject"),
        createMate: asked("createMate"),
        recordClosedOff: asked("recordClosedOff"),
        keepDeployToken: asked("keepDeployToken"),
        commentOnChange: asked("commentOnChange"),
        release: asked("release"),
        rollback: asked("rollback"),
        redeploy: asked("redeploy"),
        addService: asked("addService"),
        mergeChange: asked("mergeChange"),
        closeChange: asked("closeChange"),
        ...api,
      };
    },
    zerops: zerops.client,
  });
  const operations = makeOperations({ store, executors: { hq: executor }, makeId: () => "r1" });
  return { operations, calls, zerops };
}

function fakeZerops() {
  const calls: string[] = [];
  return {
    calls,
    client: {
      mintIntegrationToken: async (input: { readonly name: string }) => {
        calls.push(`mint ${input.name}`);
        return { id: "tok-1", token: "secret" };
      },
      deleteIntegrationToken: async (input: { readonly tokenId: string }) => {
        calls.push(`delete ${input.tokenId}`);
      },
    },
  };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");
const record = (store: AccountStore) => store.state().operations.get("r1");

describe("a creation's writes at HQ", () => {
  it.effect.each(["app", "birth"] as const)(
    "a lost $0 answer cannot adopt a preexisting record from an unread baseline",
    (kind) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        liveZerops({ running: [] }).forEach(store.dispatch);
        let sends = 0;
        const { operations } = operationsOf(store, {
          createApp: async () => {
            sends++;
            hqSays(store, [app({ id: "preexisting", name: "Garden" })]);
            throw lost;
          },
          recordBirth: async () => {
            sends++;
            hqSays(store, [
              app({ births: [{ id: "preexisting", face: "face", projectId: null }] }),
            ]);
            throw lost;
          },
        });
        yield* operations.submit(
          kind === "app"
            ? { kind: "create-app", orgId: ORG, name: "Garden" }
            : { kind: "record-birth", orgId: ORG, appId: "app-1", face: "face" },
        );
        expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        expect(sends).toBe(1);
      }),
  );

  it.effect("are done once HQ answers, each with what it answered", () =>
    Effect.gen(function* () {
      const said: string[] = [];
      const cases: ReadonlyArray<readonly [OperationIntent, Partial<HqWrites>, unknown]> = [
        [
          { kind: "create-app", orgId: ORG, name: "Garden" },
          {
            createApp: async (name) => {
              said.push(`app ${name}`);
              return { id: "app-9", name };
            },
          },
          { appId: "app-9" },
        ],
        [
          { kind: "record-birth", orgId: ORG, appId: "app-1", face: "tint:shape" },
          {
            recordBirth: async (birth) => {
              said.push(`birth ${birth.appId} ${birth.face}`);
              return { id: "birth-1", face: birth.face };
            },
          },
          { birthId: "birth-1" },
        ],
        [
          {
            kind: "bind-birth",
            orgId: ORG,
            appId: "app-1",
            birthId: "b1",
            projectId: "p1",
          },
          {
            bindBirth: async (birthId, projectId) => {
              said.push(`bind ${birthId} ${projectId}`);
            },
          },
          undefined,
        ],
        [
          {
            kind: "attach-project",
            orgId: ORG,
            appId: "app-1",
            attach: { projectId: "p1", kind: "stage", created: true },
          },
          {
            attachProject: async (appId, attach) => {
              said.push(`attach ${appId} ${attach.projectId} ${attach.kind}`);
            },
          },
          undefined,
        ],
        [
          { kind: "create-mate-record", orgId: ORG, mate: { projectId: "p1", face: "" } },
          {
            createMate: async (mate) => {
              said.push(`mate ${mate.projectId}`);
            },
          },
          undefined,
        ],
        [
          { kind: "mark-closed-off", orgId: ORG, projectId: "p1" },
          {
            recordClosedOff: async (projectId) => {
              said.push(`closed-off ${projectId}`);
            },
          },
          undefined,
        ],
      ];
      for (const [intent, api, result] of cases) {
        const store = account();
        const { operations, calls } = operationsOf(store, api);
        yield* operations.submit(intent);
        expect(calls).toEqual([`hq ${ORG}`]);
        expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        if (result !== undefined)
          expect(operationResult(record(store), intent.kind as never)).toEqual(result);
      }
      expect(said).toEqual([
        "app Garden",
        "birth app-1 tint:shape",
        "bind b1 p1",
        "attach app-1 p1 stage",
        "mate p1",
        "closed-off p1",
      ]);
    }),
  );

  it.effect(
    "a lost answer adopts the one effect HQ's navigation shows that was absent before",
    () =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<
          readonly [OperationIntent, Partial<HqWrites>, ReadonlyArray<App>, unknown]
        > = [
          [
            { kind: "create-app", orgId: ORG, name: "Garden" },
            { createApp: () => Promise.reject(lost) },
            [app(), app({ id: "app-9", name: "Garden" })],
            { appId: "app-9" },
          ],
          [
            { kind: "record-birth", orgId: ORG, appId: "app-1", face: "tint:shape" },
            { recordBirth: () => Promise.reject(lost) },
            [app({ births: [{ id: "birth-1", face: "tint:shape" }] })],
            { birthId: "birth-1" },
          ],
          [
            {
              kind: "attach-project",
              orgId: ORG,
              appId: "app-1",
              attach: { projectId: "p1", kind: "stage", created: true },
            },
            // HQ holds it attached already: its conflict, like a lost answer, is read in its facts.
            {
              attachProject: () =>
                Promise.reject(
                  new HqError({ kind: "refused", code: "conflict", message: "Attached already." }),
                ),
            },
            [app({ projects: [{ projectId: "p1", name: "p1", kind: "stage", mate: null }] })],
            undefined,
          ],
        ];
        for (const [intent, api, after, result] of cases) {
          const store = account();
          const writes = {
            ...api,
            ...Object.fromEntries(
              Object.entries(api).map(([name, write]) => [
                name,
                (...args: ReadonlyArray<never>) => {
                  hqSays(store, after);
                  return (write as unknown as (...a: ReadonlyArray<never>) => Promise<never>)(
                    ...args,
                  );
                },
              ]),
            ),
          };
          yield* operationsOf(store, writes).operations.submit(intent);
          expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
          if (result !== undefined)
            expect(operationResult(record(store), intent.kind as never)).toEqual(result);
        }
      }),
  );

  it.effect("a lost answer HQ's navigation does not show stays uncertain, never sent again", () =>
    Effect.gen(function* () {
      const store = account();
      let sent = 0;
      yield* operationsOf(store, {
        createApp: () => {
          sent += 1;
          return Promise.reject(lost);
        },
      }).operations.submit({ kind: "create-app", orgId: ORG, name: "Garden" });
      expect(sent).toBe(1);
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      expect(record(store)?.uncertainBecause).toBe("HQ's answer was lost.");
    }),
  );

  it.effect("a refusal keeps HQ's words; an HQ out of reach did not take it", () =>
    Effect.gen(function* () {
      for (const [error, stage] of [
        [
          new HqError({ kind: "refused", code: "forbidden", message: "Only an owner may." }),
          { stage: "refused", reason: "Only an owner may." },
        ],
        [
          new HqError({ kind: "unavailable", code: "network", message: "HQ isn't answering." }),
          { stage: "unsent", next: "send-again", reason: "HQ isn't answering." },
        ],
      ] as const) {
        const store = account();
        yield* operationsOf(store, { createApp: () => Promise.reject(error) }).operations.submit({
          kind: "create-app",
          orgId: ORG,
          name: "Garden",
        });
        expect(progress(store)).toEqual(stage);
      }
    }),
  );
});

describe("a write HQ answers as already done", () => {
  it.effect(
    "a Mate's record HQ holds already stands, and a Mate it holds none of has no close-off to mark",
    () =>
      Effect.gen(function* () {
        for (const [intent, api] of [
          [
            { kind: "create-mate-record", orgId: ORG, mate: { projectId: "p1", face: "" } },
            {
              createMate: () =>
                Promise.reject(
                  new HqError({ kind: "refused", code: "conflict", message: "It has a record." }),
                ),
            },
          ],
          [
            { kind: "mark-closed-off", orgId: ORG, projectId: "p1" },
            {
              recordClosedOff: () =>
                Promise.reject(
                  new HqError({
                    kind: "refused",
                    code: "mate_not_found",
                    message: "No such Mate.",
                  }),
                ),
            },
          ],
        ] as const) {
          const store = account();
          yield* operationsOf(store, api).operations.submit(intent);
          expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        }
      }),
  );
});

describe("keep-deploy-key", () => {
  const KEY = {
    kind: "keep-deploy-key",
    orgId: ORG,
    appId: "app-1",
    projectId: "p-stage",
    environmentName: "stage",
  } as const;

  it.effect("mints the environment's own token and hands it to HQ", () =>
    Effect.gen(function* () {
      const store = account();
      const kept: string[] = [];
      const { operations, zerops } = operationsOf(store, {
        keepDeployToken: async (appId, name, token) => {
          kept.push(`${appId} ${name} ${token}`);
        },
      });
      yield* operations.submit(KEY);
      expect(zerops.calls).toEqual(["mint mate-hq-deploy:stage:p-stage"]);
      expect(kept).toEqual(["app-1 stage secret"]);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );

  it.effect("takes back a token HQ refused, saying HQ's refusal", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, zerops } = operationsOf(store, {
        keepDeployToken: () =>
          Promise.reject(
            new HqError({ kind: "refused", code: "forbidden", message: "Not yours to keep." }),
          ),
      });
      yield* operations.submit(KEY);
      expect(zerops.calls).toEqual(["mint mate-hq-deploy:stage:p-stage", "delete tok-1"]);
      expect(progress(store)).toEqual({ stage: "refused", reason: "Not yours to keep." });
    }),
  );

  it.effect("keeps a token whose handoff was lost, adopted once HQ shows the key held", () =>
    Effect.gen(function* () {
      const environment = (keyHeld: boolean) => ({
        projectId: "p-stage",
        tier: "stage",
        name: "stage",
        sources: [],
        order: 0,
        keyHeld,
        keyInvalid: false,
        can: {},
        jobs: [],
        release: null,
        birth: null,
      });
      const store = account([app({ environments: [environment(false)] as never })]);
      const { operations, zerops } = operationsOf(store, {
        keepDeployToken: () => {
          hqSays(store, [app({ environments: [environment(true)] as never })]);
          return Promise.reject(lost);
        },
      });
      yield* operations.submit(KEY);
      expect(zerops.calls).toEqual(["mint mate-hq-deploy:stage:p-stage"]);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );
});

describe("changing a Mate's face", () => {
  const saysFace = (store: AccountStore, face: string) =>
    seedHqNavigation(store, ORG, {
      structure: { apps: [], ungrouped: [{ projectId: "p1", name: "p1", mate: { face } }] },
    });
  it.effect(
    "keeps a lost answer uncertain and adopts only the newly reflected face without another write",
    () =>
      Effect.gen(function* () {
        const store = account();
        saysFace(store, "slate:squircle");
        let sends = 0;
        const { operations } = operationsOf(store, {
          updateMate: async () => {
            sends++;
            throw lost;
          },
        });
        yield* operations.submit({
          kind: "update-mate-face",
          orgId: ORG,
          projectId: "p1",
          face: "blue:circle",
        });
        expect(progress(store).stage).toBe("uncertain");
        yield* operations.retry("r1");
        expect(sends).toBe(1);
        saysFace(store, "blue:circle");
        yield* operations.retry("r1");
        expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        expect(sends).toBe(1);
      }),
  );
  it.effect("retains HQ's refusal until a deliberate new attempt", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, {
        updateMate: async () => {
          throw new HqError({
            kind: "refused",
            code: "forbidden",
            message: "HQ refused this face.",
          });
        },
      });
      yield* operations.submit({
        kind: "update-mate-face",
        orgId: ORG,
        projectId: "p1",
        face: "blue:circle",
      });
      expect(progress(store)).toMatchObject({ stage: "refused", reason: "HQ refused this face." });
      yield* operations.retry("r1");
      expect(progress(store).stage).toBe("refused");
    }),
  );
});

describe("organization automatic-update writes", () => {
  it.effect("returns the committed policy in the receipt", () =>
    Effect.gen(function* () {
      const store = account();
      const policy = { orgId: ORG, enabled: false, revision: 3 };
      const { operations } = operationsOf(store, { setAutoUpdatePolicy: async () => policy });
      yield* operations.submit({ kind: "set-auto-update-policy", orgId: ORG, enabled: false });
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(record(store)?.receipt?.acceptance).toEqual({ kind: "accepted", result: { policy } });
    }),
  );
  it.effect(
    "never repeats or adopts a lost policy answer from another admin's matching boolean",
    () =>
      Effect.gen(function* () {
        const store = account();
        let sends = 0;
        const { operations } = operationsOf(store, {
          setAutoUpdatePolicy: async () => {
            sends++;
            throw lost;
          },
        });
        yield* operations.submit({ kind: "set-auto-update-policy", orgId: ORG, enabled: false });
        observePolicy(store, { orgId: ORG, enabled: false, revision: 4 });
        yield* operations.retry("r1");
        expect(progress(store)).toMatchObject({ stage: "uncertain" });
        expect(sends).toBe(1);
      }),
  );
  it.effect(
    "a deliberate fresh policy change completes without resolving the earlier lost answer",
    () =>
      Effect.gen(function* () {
        const store = account();
        let sends = 0;
        const { operations } = operationsOf(store, {
          setAutoUpdatePolicy: async (enabled) => {
            if (++sends === 1) throw lost;
            return { orgId: ORG, enabled, revision: 5 };
          },
        });
        yield* operations.submit(
          { kind: "set-auto-update-policy", orgId: ORG, enabled: false },
          "r1",
        );
        observePolicy(store, { orgId: ORG, enabled: false, revision: 4 });
        yield* operations.retry("r1");
        yield* operations.submit(
          { kind: "set-auto-update-policy", orgId: ORG, enabled: true },
          "r2",
        );
        expect(progress(store).stage).toBe("uncertain");
        expect(operationProgress.derive(readsOfState(store.state()), "r2")).toMatchObject({
          stage: "done",
          outcome: "succeeded",
        });
        expect(sends).toBe(2);
      }),
  );
  it.effect("keeps HQ's refusal reason for a policy change", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, {
        setAutoUpdatePolicy: async () => {
          throw new HqError({
            kind: "refused",
            code: "forbidden",
            message: "Only organization admins may change this policy.",
          });
        },
      });
      yield* operations.submit({ kind: "set-auto-update-policy", orgId: ORG, enabled: false });
      expect(progress(store)).toEqual({
        stage: "refused",
        reason: "Only organization admins may change this policy.",
      });
    }),
  );
});

function observePolicy(
  store: ReturnType<typeof makeAccountStore>,
  policy: { orgId: string; enabled: boolean; revision: number },
) {
  const scope = `hq:${policy.orgId}:auto-update-policy` as const;
  store.dispatch({
    kind: "rows",
    scope,
    generation: readsOfState(store.state()).stream(scope).generation,
    method: "read",
    via: "hq-stream",
    rows: [
      {
        family: "hqAutoUpdatePolicy",
        id: policy.orgId,
        value: policy,
        revision: { kind: "hq", incarnation: "core", revision: policy.revision },
      },
    ],
  });
}
