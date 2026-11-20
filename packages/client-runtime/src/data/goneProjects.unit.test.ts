import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";

import { HqError } from "../zerops/hq/client.ts";
import { liveZerops, ORG } from "./__fixtures__/account.ts";
import { seedHqNavigation } from "./__fixtures__/hqNavigation.ts";
import { membershipInputs } from "./__fixtures__/membership.ts";
import { projectsScope } from "./families/project.ts";
import { finishGoneProjects, type GoneProjectFinish } from "./goneProjects.ts";
import { makeOperations } from "./operations/coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./operations/executors/hq.ts";
import { operationProgress } from "./projections/operation.ts";
import { makeAccountStore, readsOfState } from "./store.ts";

const PREPARED: HqLifecycleRecord = {
  requestId: "prepare",
  at: "2026-11-05T14:02:00.000Z",
  intent: { kind: "prepare-mate-deletion", orgId: ORG, hqProjectId: "hq", projectId: "bea" },
  result: { keyTokenId: "exact-key", completion: "seal" },
};

/** Drives each proposed finish through the operation the account would send to HQ. */
function account({
  roleCode,
  lifecycle = [],
  answer = () => Promise.resolve(),
}: {
  roleCode: string;
  lifecycle?: readonly HqLifecycleRecord[];
  answer?: () => Promise<void>;
}) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({
    running: [],
    projects: [
      { id: "bea", name: "Bea" },
      { id: "cyd", name: "Cyd" },
    ],
  }).forEach(store.dispatch);
  membershipInputs(roleCode).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: "app",
          name: "App",
          projects: [
            { projectId: "bea", name: "Bea", kind: "mate", mate: { face: "" } },
            { projectId: "cyd", name: "Cyd", kind: "stage", mate: null },
          ],
        },
      ],
      ungrouped: [],
    },
    lifecycle,
  });
  const asked: Array<readonly [verb: string, projectId: string]> = [];
  const write = (verb: string, projectId: string) => {
    asked.push([verb, projectId]);
    return answer();
  };
  const api = {
    completeProjectDeletion: (projectId: string) => write("deleted", projectId),
    lifecycleWrite: async (requestId: string, intent: HqLifecycleRecord["intent"]) => {
      await write(intent.kind, intent.projectId);
      return { requestId, intent };
    },
  };
  const operations = makeOperations({
    store,
    makeId: () => "unused",
    executors: {
      hq: makeHqExecutor({
        apiOf: () => api as HqWrites,
        active: () => true,
        hqProjectIdOf: () => "hq",
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("no mint")),
          deleteIntegrationToken: () => Promise.reject(new Error("no retirement")),
        },
      }),
    },
  });
  // What the follower submits, sent by the case: each submission runs to its owner's answer.
  const submitted: GoneProjectFinish[] = [];
  const stop = finishGoneProjects({
    store,
    orgId: ORG,
    hqProjectId: "hq",
    submit: (finish) => submitted.push(finish),
  });
  const send = Effect.suspend(() =>
    Effect.forEach(
      submitted.splice(0),
      ({ intent, requestId }) => operations.submit(intent, requestId),
      { discard: true },
    ),
  );
  const scope = projectsScope(ORG);
  return {
    store,
    asked,
    send,
    stop,
    dropFromList: (projectId: string) =>
      store.dispatch({
        kind: "membership",
        scope,
        generation: store.state().streams.get(scope)?.generation ?? 0,
        delta: { add: [], remove: [projectId] },
      }),
    proveGone: (projectId: string) =>
      store.dispatch({
        kind: "proven-deletion",
        family: "project",
        id: projectId,
        evidence: `GET /project/${projectId} answered 404`,
      }),
  };
}

// witness: packages/client-runtime/src/data/goneProjects.ts | facts !== undefined && finishDeletionPermission(facts, projectId).allow → facts !== undefined
it.effect(
  "ST39: HQ is told once that a placed project is gone, only after the person's own read proves it, and only by an organization owner or admin",
  () =>
    Effect.gen(function* () {
      for (const { role, projectId, asked } of [
        { role: "OWNER", projectId: "bea", asked: [["deleted", "bea"]] },
        { role: "ADMIN", projectId: "cyd", asked: [["deleted", "cyd"]] },
        { role: "BASIC_USER", projectId: "bea", asked: [] },
      ]) {
        const hq = account({ roleCode: role });
        hq.dropFromList(projectId);
        yield* hq.send;
        // The frame alone proves nothing: HQ is asked nothing before the read.
        expect(hq.asked).toEqual([]);
        // The store moving on before its submission is recorded submits it no second time.
        hq.proveGone(projectId);
        hq.proveGone(projectId);
        yield* hq.send;
        hq.proveGone(projectId);
        yield* hq.send;
        expect(hq.asked).toEqual(asked);
        hq.stop();
      }
    }),
);

// witness: packages/client-runtime/src/data/goneProjects.ts | const record = prepared.get(projectId); → const record = prepared.get(key.hqProjectId);
it.effect(
  "ST40: A Mate deletion's preparer tells HQ it is finished by their own receipt, whatever their organization role",
  () =>
    Effect.gen(function* () {
      const hq = account({ roleCode: "BASIC_USER", lifecycle: [PREPARED] });
      hq.dropFromList("bea");
      hq.proveGone("bea");
      yield* hq.send;
      expect(hq.asked).toEqual([["complete-mate-deletion", "bea"]]);
      hq.stop();
    }),
);

// witness: packages/client-runtime/src/data/goneProjects.ts | if (finish !== undefined && read.operation(finish.requestId) === undefined) → if (finish !== undefined)
it.effect(
  "ST41: HQ refusing a gone project's finish ends the attempt for the session, and the project stays placed",
  () =>
    Effect.gen(function* () {
      const hq = account({
        roleCode: "OWNER",
        answer: () =>
          Promise.reject(
            new HqError({
              kind: "refused",
              status: 409,
              code: "conflict",
              reason: "project_present",
              message: "project_present",
            }),
          ),
      });
      hq.proveGone("bea");
      yield* hq.send;
      expect(operationProgress.derive(readsOfState(hq.store.state()), "bea:deleted").stage).toBe(
        "refused",
      );
      // Later frames and another account mount of the same session ask nothing again.
      hq.proveGone("bea");
      yield* hq.send;
      hq.stop();
      const again = finishGoneProjects({
        store: hq.store,
        orgId: ORG,
        hqProjectId: "hq",
        submit: ({ intent }) => hq.asked.push(["again", intent.projectId]),
      });
      expect(hq.asked).toEqual([["deleted", "bea"]]);
      expect(readsOfState(hq.store.state()).fact("placement", "bea").kind).toBe("known");
      again();
    }),
);
