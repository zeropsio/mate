import { describe, expect, it } from "@effect/vitest";
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
import { makeAccountStore, readsOfState, type AccountStore } from "./store.ts";

const PREPARED: HqLifecycleRecord = {
  requestId: "prepare",
  at: "2026-11-05T14:02:00.000Z",
  intent: { kind: "prepare-mate-deletion", orgId: ORG, hqProjectId: "hq", projectId: "bea" },
  result: { keyTokenId: "exact-key", completion: "seal" },
};

/** What HQ was asked, verb and project, in order. */
type Asked = Array<readonly [string, string]>;

/**
 * An account whose HQ places Bea's Mate and Cyd's stage, the person's role `roleCode`, with the
 * gone projects' finishes followed into its operations and HQ answering each with `answer`.
 */
function account(input: {
  readonly roleCode: string;
  readonly lifecycle?: ReadonlyArray<HqLifecycleRecord>;
  readonly answer?: () => Promise<void>;
}) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({
    running: [],
    projects: [
      { id: "bea", name: "Bea" },
      { id: "cyd", name: "Cyd" },
    ],
  }).forEach(store.dispatch);
  membershipInputs(input.roleCode).forEach(store.dispatch);
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
    ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
  });
  const asked: Asked = [];
  const answer = input.answer ?? (() => Promise.resolve());
  const operations = makeOperations({
    store,
    makeId: () => "unused",
    executors: {
      hq: makeHqExecutor({
        apiOf: () =>
          ({
            completeProjectDeletion: (projectId: string) => {
              asked.push(["deleted", projectId]);
              return answer();
            },
            lifecycleWrite: async (requestId: string, intent: HqLifecycleRecord["intent"]) => {
              asked.push([intent.kind, intent.projectId]);
              await answer();
              return { requestId, intent };
            },
          }) as unknown as HqWrites,
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
  let submissions = 0;
  const stop = finishGoneProjects({
    store,
    orgId: ORG,
    hqProjectId: "hq",
    submit: (finish) => {
      submissions += 1;
      submitted.push(finish);
    },
  });
  const send = Effect.suspend(() =>
    Effect.forEach(
      submitted.splice(0),
      ({ intent, requestId }) => operations.submit(intent, requestId),
      { discard: true },
    ),
  );
  return { store, asked, stop, send, submissions: () => submissions };
}

/** The person's own `project` stream drops it: a frame, no proof yet. */
const dropped = (store: AccountStore, projectId: string) =>
  store.dispatch({
    kind: "membership",
    scope: projectsScope(ORG),
    generation: store.state().streams.get(projectsScope(ORG))?.generation ?? 0,
    delta: { add: [], remove: [projectId] },
  });

/** Their own read of it answers `400 projectNotFound`, which proves it gone. */
const readGone = (store: AccountStore, projectId: string) =>
  store.dispatch({
    kind: "proven-deletion",
    family: "project",
    id: projectId,
    evidence: `GET /project/${projectId} answered 404`,
  });

describe("a project HQ still places that the person's own read proves gone", () => {
  it.effect.each([
    { role: "OWNER", projectId: "bea", asked: [["deleted", "bea"]] },
    { role: "ADMIN", projectId: "cyd", asked: [["deleted", "cyd"]] },
    { role: "BASIC_USER", projectId: "bea", asked: [] },
  ])(
    "HQ is told once by an organization owner or admin, and by nobody else who did not prepare it: $role, $projectId",
    ({ role, projectId, asked }) =>
      Effect.gen(function* () {
        const hq = account({ roleCode: role });
        dropped(hq.store, projectId);
        yield* hq.send;
        // The frame alone proves nothing: HQ is asked nothing before the read.
        expect(hq.asked).toEqual([]);
        // The store moving on before its submission is recorded submits it no second time.
        readGone(hq.store, projectId);
        readGone(hq.store, projectId);
        expect(hq.submissions()).toBe(asked.length);
        yield* hq.send;
        readGone(hq.store, projectId);
        yield* hq.send;
        expect(hq.asked).toEqual(asked);
        hq.stop();
      }),
  );

  it.effect("its preparer tells HQ by their own receipt, whatever their organization role", () =>
    Effect.gen(function* () {
      const hq = account({ roleCode: "BASIC_USER", lifecycle: [PREPARED] });
      dropped(hq.store, "bea");
      readGone(hq.store, "bea");
      yield* hq.send;
      expect(hq.asked).toEqual([["complete-mate-deletion", "bea"]]);
      hq.stop();
    }),
  );

  it.effect.each([{ name: "project_present", status: 409, code: "conflict" }])(
    "HQ refusing the finish ends the attempt for the session and the project stays placed: $name",
    ({ name, status, code }) =>
      Effect.gen(function* () {
        const hq = account({
          roleCode: "OWNER",
          answer: () =>
            Promise.reject(
              new HqError({ kind: "refused", status, code, reason: name, message: name }),
            ),
        });
        readGone(hq.store, "bea");
        yield* hq.send;
        expect(operationProgress.derive(readsOfState(hq.store.state()), "bea:deleted").stage).toBe(
          "refused",
        );
        // Later frames and another account mount of the same session ask nothing again.
        readGone(hq.store, "bea");
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
});
