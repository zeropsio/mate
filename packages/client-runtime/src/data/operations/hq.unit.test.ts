import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "../../zerops/hq/client.ts";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { gitEnvironment } from "../__fixtures__/hqWire.ts";
import { seedHqNavigation, type SeededHq } from "../__fixtures__/hqNavigation.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { linkKeys } from "../model.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { HQ_WRITE_KINDS } from "./hqWrites.ts";
import { personaTemplatesScope } from "../families/hqPersonaTemplates.ts";
import { personaTemplateWrite } from "../projections/hqPersonaTemplates.ts";

function account(navigation: SeededHq = {}) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, navigation);
  return store;
}

function operationsOf(store: AccountStore, api: Partial<HqWrites>) {
  return makeOperations({
    store,
    makeId: () => "r1",
    executors: {
      hq: makeHqExecutor({
        store,
        apiOf: () => api as HqWrites,
        active: () => true,
        hqProjectIdOf: () => "hq",
      }),
    },
  });
}

const progress = (store: AccountStore, id: string) =>
  operationProgress.derive(readsOfState(store.state()), id);

type App = NonNullable<SeededHq["structure"]>["apps"][number];
const shop: App = { id: "app-1", name: "Shop", projects: [], births: [], environments: [] };
const lost = new HqError({ kind: "uncertain", code: "network", message: "HQ's answer was lost." });

function hqSays(store: AccountStore, apps: readonly App[]) {
  seedHqNavigation(store, ORG, { structure: { apps, ungrouped: [] } });
}

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | if (app?.operation?.id === intent.id) return [intent.id]; → if (app?.operation?.id === intent.id) return [intent.appId];
it.effect(
  "OP60: A same-name application rename with a lost answer adopts only its own new operation; breaks: a retry already accepted by HQ remains uncertain because the name was already current",
  () =>
    Effect.gen(function* () {
      const previous = {
        id: "failed-1",
        kind: "app_rename",
        phase: "failed",
        at: "2026-11-22T10:00:05Z",
        acceptedAt: "2026-11-22T10:00:00Z",
        failure: {
          step: "rename_projects",
          code: "renames_left",
          at: "2026-11-22T10:00:05Z",
          origin: "hq",
        },
      };
      const store = account({
        structure: { apps: [{ ...shop, operation: previous }], ungrouped: [] },
      });
      yield* operationsOf(store, {
        startAppRename: async (_appId, start) => {
          hqSays(store, [{ ...shop, operation: { ...previous, id: start.id, phase: "renaming" } }]);
          throw lost;
        },
      }).submit({
        kind: "start-app-rename",
        orgId: ORG,
        appId: shop.id,
        id: "retry-1",
        name: shop.name,
      });
      expect(progress(store, "r1")).toMatchObject({ stage: "done", outcome: "succeeded" });

      const unchanged = account({
        structure: { apps: [{ ...shop, operation: previous }], ungrouped: [] },
      });
      yield* operationsOf(unchanged, {
        startAppRename: async () => {
          throw lost;
        },
      }).submit({
        kind: "start-app-rename",
        orgId: ORG,
        appId: shop.id,
        id: "retry-2",
        name: shop.name,
      });
      expect(progress(unchanged, "r1")).toEqual({ stage: "uncertain", next: "ask-owner-again" });
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | await api.setAutoUpdatePolicy(intent.enabled); → await api.setAutoUpdatePolicy(intent.enabled).catch(() => api.setAutoUpdatePolicy(intent.enabled));
it.effect(
  "OP32: A lost policy answer is never sent again, nor adopted from another admin's matching choice",
  () =>
    Effect.gen(function* () {
      const store = account();
      const writes: boolean[] = [];
      const operations = operationsOf(store, {
        setAutoUpdatePolicy: async (enabled) => {
          writes.push(enabled);
          throw lost;
        },
      });
      yield* operations.submit({ kind: "set-auto-update-policy", orgId: ORG, enabled: false });
      const policy = { orgId: ORG, enabled: false, revision: 4 };
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

      yield* operations.retry("r1");
      expect(progress(store, "r1")).toMatchObject({ stage: "uncertain" });
      expect(writes).toEqual([false]);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | yield* Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause, true) }); → yield* Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause) });
it.effect(
  "OP33: A save over a revision HQ no longer holds offers HQ's version and is never sent again",
  () =>
    Effect.gen(function* () {
      const SAVE = {
        kind: "save-persona-template",
        orgId: ORG,
        templateId: "t-1",
        revision: 2,
        name: "Reviewer",
        description: "Reads every change twice.",
        instructions: "Review before you merge.",
      } as const;

      const store = account();
      const observe = (revision: number, instructions: string) => {
        const scope = personaTemplatesScope(ORG);
        store.dispatch({
          kind: "rows",
          scope,
          generation: readsOfState(store.state()).stream(scope).generation,
          method: "read",
          via: "hq-stream",
          rows: [
            {
              family: "hqPersonaTemplates",
              id: ORG,
              value: {
                templates: [
                  {
                    id: SAVE.templateId,
                    name: SAVE.name,
                    description: SAVE.description,
                    instructions,
                    revision,
                  },
                ],
                unreadable: [],
              },
              revision: { kind: "hq", incarnation: "core", revision },
            },
          ],
        });
      };
      observe(2, SAVE.instructions);
      const revisions: number[] = [];
      const operations = operationsOf(store, {
        savePersonaTemplate: async (_id, input) => {
          revisions.push(input.revision);
          observe(3, "Ship fast.");
          throw new HqError({
            kind: "refused",
            code: "conflict",
            reason: "revision_conflict",
            status: 409,
            message: "Someone else changed this template meanwhile.",
          });
        },
      });
      yield* operations.submit(SAVE);
      yield* operations.retry("r1");
      expect(personaTemplateWrite.derive(readsOfState(store.state()), "r1")).toEqual({
        stage: "conflict",
        current: {
          id: "t-1",
          name: "Reviewer",
          description: "Reads every change twice.",
          instructions: "Ship fast.",
          revision: 3,
        },
      });
      expect(revisions).toEqual([2]);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | ...(intent.mate === undefined ? {} : { mate: intent.mate }), → ...{},
it.effect(
  "OP34: Deleting an application sends HQ one start under one id naming its last Mate, exactly the stages, Zerops projects and productions set to go and the repositories kept, and the web deletes no Mate, stage or production project itself",
  () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const operations = operationsOf(account(), {
        startAppDeletion: async (...args) => {
          sent.push(["start-app-deletion", ...args]);
        },
        startMateDeletion: async (...args) => {
          sent.push(["start-mate-deletion", ...args]);
        },
      });
      yield* operations.submit({
        kind: "start-app-deletion",
        orgId: ORG,
        appId: "app-1",
        id: "op-1",
        mate: "p-mate",
        stages: ["p-stage-a", "p-stage-b"],
        plains: ["p-plain"],
        productions: ["p-prod"],
        keepRepos: ["docs"],
        names: { "p-stage-a": "stage", "p-plain": "plain", "p-prod": "production" },
      });
      expect(sent).toEqual([
        [
          "start-app-deletion",
          "app-1",
          {
            id: "op-1",
            mate: "p-mate",
            stages: ["p-stage-a", "p-stage-b"],
            plains: ["p-plain"],
            productions: ["p-prod"],
            keepRepos: ["docs"],
            names: { "p-stage-a": "stage", "p-plain": "plain", "p-prod": "production" },
          },
        ],
      ]);
      for (const optional of [
        {},
        { names: {}, plains: [], productions: [], keepRepos: [] },
        { plains: [], keepRepos: [] },
      ] as const) {
        const withoutNames: unknown[] = [];
        const next = operationsOf(account(), {
          startAppDeletion: async (...args) => {
            withoutNames.push(args);
          },
        });
        yield* next.submit({
          kind: "start-app-deletion",
          orgId: ORG,
          appId: "app-1",
          id: "op-2",
          stages: [],
          ...optional,
        });
        expect(withoutNames).toEqual([["app-1", { id: "op-2", stages: [] }]]);
      }
    }),
);

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | (read, { appId, start }) => appOf(read, appId)?.operation?.id === start.id, → (read, { appId }) => appOf(read, appId)?.operation !== undefined,
it.effect(
  "OP59: After a lost answer an environment start is adopted only when HQ's navigation shows the application's operation under the id its press fixed, never another operation running there",
  () =>
    Effect.gen(function* () {
      const going = (id: string): App => ({
        ...shop,
        operation: {
          id,
          kind: "environment",
          phase: "accepted",
          at: "2026-11-23T10:00:00.000Z",
          acceptedAt: "2026-11-23T10:00:00.000Z",
        },
      });
      for (const [shownId, adopted] of [
        ["op-1", true],
        ["op-other", false],
      ] as const) {
        const store = account({ structure: { apps: [shop], ungrouped: [] } });
        yield* operationsOf(store, {
          startEnvironment: async () => {
            hqSays(store, [going(shownId)]);
            throw lost;
          },
        }).submit({
          kind: "start-environment",
          orgId: ORG,
          appId: "app-1",
          start: { id: "op-1", tier: "stage", projectId: "p-stage" },
        });
        expect(progress(store, "r1").stage === "done", shownId).toBe(adopted);
      }
    }),
);

// witness: packages/client-runtime/src/data/projections/hqLink.ts | || hqAwaySaidAt(link) === null) return null; → ) return null;
it.effect(
  "OP61: A person's access change pressed before this tab's HQ link first answered is sent to HQ, one pressed while the link is lost after answering or once the sign-in ended is said at once and not sent, and HQ's refusal is said in its words; breaks: a Remove pressed while a member's page is still loading is refused as HQ not reachable",
  () =>
    Effect.gen(function* () {
      const remove = {
        kind: "start-access-changes",
        orgId: ORG,
        changes: [{ id: "op-1", change: { kind: "remove", userId: "user-bob" } }],
      } as const;
      const notAnswered = () => {
        const store = makeAccountStore(AtomRegistry.make());
        liveZerops({ running: [] }).forEach(store.dispatch);
        return store;
      };
      const lostAfterAnswering = () => {
        const store = account();
        store.dispatch({
          kind: "stream",
          key: linkKeys.hq(ORG),
          now: 1_000,
          event: { kind: "fault", fault: { outcome: "transient", message: "reset" }, jitter: 0 },
        });
        return store;
      };
      const inFlight = new HqError({
        kind: "refused",
        code: "conflict",
        reason: "operation_in_flight",
        status: 409,
        message: "A change for this person is still running. Try again once it ends.",
      });
      for (const { name, store, active, refuse, sent, said } of [
        {
          name: "not answered yet",
          store: notAnswered(),
          active: true,
          refuse: false,
          sent: true,
          said: null,
        },
        { name: "live", store: account(), active: true, refuse: false, sent: true, said: null },
        {
          name: "refused by HQ",
          store: account(),
          active: true,
          refuse: true,
          sent: true,
          said: "A change for this person is still running. Try again once it ends.",
        },
        {
          name: "lost after answering",
          store: lostAfterAnswering(),
          active: true,
          refuse: false,
          sent: false,
          said: "HQ is not reachable. Try again shortly.",
        },
        {
          name: "sign-in ended",
          store: account(),
          active: false,
          refuse: false,
          sent: false,
          said: "This Zerops sign-in has ended.",
        },
      ]) {
        const calls: string[] = [];
        const operations = makeOperations({
          store,
          makeId: () => "r1",
          executors: {
            hq: makeHqExecutor({
              store,
              apiOf: () =>
                ({
                  startAccessChanges: async (changes) => {
                    calls.push(...changes.map(({ id }) => id));
                    if (refuse) throw inFlight;
                    return { operations: changes.map(({ id }) => ({ id })) };
                  },
                }) as Partial<HqWrites> as HqWrites,
              active: () => active,
            }),
          },
        });
        yield* operations.submit(remove);
        expect(calls, name).toEqual(sent ? ["op-1"] : []);
        expect(progress(store, "r1"), name).toMatchObject(
          said === null
            ? { stage: "done", outcome: "succeeded" }
            : { stage: "refused", reason: said },
        );
      }
    }),
);

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | operation.failure?.code === "ended"; → operation.continueBy === undefined;
it("OP62: A lost End answer counts as ended only when HQ shows that operation ended or no longer shows it, never while it runs on; breaks: an End that lost to the maker's Continue is reported done while the operation keeps acting", () => {
  const end = HQ_WRITE_KINDS.find((kind) => kind.kind === "end-operation");
  for (const holder of [{ appId: "app" }, { projectId: "project" }]) {
    const intent = { kind: "end-operation", orgId: ORG, id: "op", ...holder } as const;
    const shows = (operation: unknown) =>
      end?.reflected(
        { fact: () => ({ kind: "known", value: { operation } }) } as never,
        intent as never,
        {} as never,
      );
    expect(shows({ id: "op" })).toBe(false);
    expect(shows({ id: "op", continueBy: "maker" })).toBe(false);
    expect(shows({ id: "op", failure: { code: "ended" } })).toBe(true);
    expect(shows(undefined)).toBe(true);
  }
});

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | ].find((shown) => shown?.id === id); → ].slice(0, 1).find((shown) => shown?.id === id);
it.effect(
  "OP63: A lost answer to ending a production's removal is adopted only once HQ shows that removal ended or no longer shows it; breaks: an End HQ never took reads as done while the application stays held",
  () =>
    Effect.gen(function* () {
      const removal = {
        id: "removal-1",
        kind: "production_removal",
        phase: "delete_requested",
        at: "2026-11-23T10:00:05Z",
        acceptedAt: "2026-11-23T10:00:00Z",
        continueBy: "u-maker",
        offers: ["end"],
        failure: {
          step: "delete_project",
          code: "token_expired",
          at: "2026-11-23T10:00:05Z",
          origin: "hq",
        },
      };
      const production = { ...gitEnvironment, jobs: [], operation: removal };
      const held = { ...shop, environments: [production] } as unknown as App;
      const intent = { kind: "end-operation", orgId: ORG, id: removal.id, appId: shop.id } as const;

      const unchanged = account({ structure: { apps: [held], ungrouped: [] } });
      yield* operationsOf(unchanged, {
        endOperation: async () => {
          throw lost;
        },
      }).submit(intent);
      expect(progress(unchanged, "r1")).toEqual({ stage: "uncertain", next: "ask-owner-again" });

      const ended = account({ structure: { apps: [held], ungrouped: [] } });
      yield* operationsOf(ended, {
        endOperation: async () => {
          const { continueBy: _gone, ...open } = removal;
          const stopped = { ...open, offers: [], failure: { ...removal.failure, code: "ended" } };
          hqSays(ended, [
            {
              ...shop,
              environments: [{ ...production, operation: stopped }],
            } as unknown as App,
          ]);
          throw lost;
        },
      }).submit(intent);
      expect(progress(ended, "r1")).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
);

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | const operation = placement.kind === "known" ? placement.value.operation : undefined; → const operation = placement.kind === "known" && placement.value.operation?.failure === undefined ? placement.value.operation : undefined;
it("OP64: After a lost answer a Mate's deletion and an application's deletion are adopted only when HQ's navigation shows the operation under the id their press fixed, whatever its state, or their target gone; breaks: a colleague's running deletion is taken for the person's refused one, or the person's own start that failed at once stays uncertain.", () => {
  for (const intent of [
    { kind: "start-mate-deletion", orgId: ORG, projectId: "p", id: "ours" },
    { kind: "start-app-deletion", orgId: ORG, appId: "a", id: "ours", stages: [] },
  ] as const) {
    const kind = HQ_WRITE_KINDS.find((entry) => entry.kind === intent.kind);
    const operationKind = intent.kind === "start-mate-deletion" ? "mate_deletion" : "app_deletion";
    const failure = { step: "delete", code: "refused", at: "2026-11-23T10:00:00Z", origin: "hq" };
    const cases = [
      [{ kind: "known", value: { operation: { id: "ours", kind: operationKind } } }, true],
      [{ kind: "known", value: { operation: { id: "ours", kind: operationKind, failure } } }, true],
      [
        {
          kind: "known",
          value: { operation: { id: "ours", kind: operationKind, failure, continueBy: "maker" } },
        },
        true,
      ],
      [{ kind: "known", value: { operation: { id: "other", kind: operationKind } } }, false],
      [{ kind: "known", value: {} }, false],
      [{ kind: "unknown" }, false],
      [{ kind: "withheld", reason: "removed" }, true],
      [{ kind: "withheld", reason: "denied" }, false],
    ] as const;
    for (const [fact, expected] of cases) {
      const read = { fact: () => fact };
      expect(
        kind?.reflected(read as never, intent as never, {} as never),
        JSON.stringify([intent.kind, fact]),
      ).toBe(expected);
    }
  }
});
