import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { HqError } from "../../zerops/hq/client.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

const orgId = "org";
const appId = "tea-shop";
const zerops = {
  mintIntegrationToken: async () => {
    throw new Error("Mirroring through the app mints no keys.");
  },
  deleteIntegrationToken: async () => {
    throw new Error("Mirroring through the app deletes no keys.");
  },
};
const intent = {
  kind: "connect-git-remote-via-app",
  orgId,
  appId,
  repo: "appdev",
  repository: "acme/tea-shop",
} as const;

function rig(api: Partial<HqWrites>) {
  const store = makeAccountStore(AtomRegistry.make());
  const operations = makeOperations({
    store,
    makeId: () => "request",
    executors: { hq: makeHqExecutor({ apiOf: () => api as HqWrites, zerops }) },
  });
  const scope = `hq:${orgId}:hq-app-detail:${appId}` as const;
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
  let revision = 0;
  const publish = (remote: Record<string, unknown> | null, follows?: string) =>
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: 1 }],
      reset: true,
      rows: [
        {
          family: "hqAppDetail",
          id: `${appId}/repos`,
          revision: { kind: "hq", incarnation: "i", revision: ++revision },
          value: {
            kind: "repos",
            value: [
              {
                name: "appdev",
                mainHead: null,
                updatedAt: null,
                remote,
                ...(follows === undefined ? {} : { follows }),
              },
            ],
          } as never,
        },
      ],
      removals: [],
    });
  const stage = () => operationProgress.derive(readsOfState(store.state()), "request");
  return { store, operations, publish, stage };
}

describe("mirroring a repository through the organization's GitHub app", () => {
  it.effect("asks HQ for that repository, and says it is saving until HQ's record shows it", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const r = rig({
        repoRemoteViaApp: async (...args) => {
          sent.push(args);
        },
      });
      yield* r.operations.submit(intent);
      expect(sent).toEqual([[appId, "appdev", { repository: "acme/tea-shop" }]]);
      expect(r.stage().stage).not.toBe("done");
      r.publish({
        url: "https://github.com/acme/tea-shop.git",
        repositoryId: "7",
        keptAt: "2026-10-17T09:00:00Z",
        keptBy: "Acme Mate",
        expiresAt: null,
        invalidSince: null,
        via: "app",
      });
      expect(r.stage()).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );

  it.effect("says HQ's refusal in its words", () =>
    Effect.gen(function* () {
      const r = rig({
        repoRemoteViaApp: async () => {
          throw new HqError({
            kind: "refused",
            code: "repository_not_installed",
            status: 409,
            message: "Acme Mate is not installed on acme/tea-shop.",
          });
        },
      });
      yield* r.operations.submit(intent);
      expect(r.stage()).toMatchObject({ stage: "refused" });
    }),
  );

  it.effect("asks for an update where HQ cannot mirror through the app", () =>
    Effect.gen(function* () {
      const r = rig({});
      yield* r.operations.submit(intent);
      expect(r.stage()).toMatchObject({ stage: "refused" });
    }),
  );
});

describe("following a GitHub repository whose code HQ keeps", () => {
  const follow = {
    kind: "follow-github-repository",
    orgId,
    appId,
    repo: "appdev",
    url: "https://github.com/acme/tea-shop",
  } as const;

  it.effect("asks HQ to follow that address, and ends on HQ's answer", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const r = rig({
        followRepoUpstream: async (...args) => {
          sent.push(args);
        },
      });
      yield* r.operations.submit(follow);
      expect(sent).toEqual([[appId, "appdev", { url: "https://github.com/acme/tea-shop" }]]);
      expect(r.stage()).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );

  it.effect.each([
    {
      name: "HQ's refusal",
      api: {
        followRepoUpstream: async () => {
          throw new HqError({
            kind: "refused",
            code: "remote_refused",
            status: 403,
            message: "Only the organization's owner or admin can change this.",
          });
        },
      },
    },
    { name: "an HQ that cannot follow one", api: {} },
  ])("is refused by $name", ({ api }) =>
    Effect.gen(function* () {
      const r = rig(api);
      yield* r.operations.submit(follow);
      expect(r.stage()).toMatchObject({ stage: "refused" });
    }),
  );
});

describe("stopping a repository's GitHub follow", () => {
  const stop = {
    kind: "stop-following-github-repository",
    orgId,
    appId,
    repo: "appdev",
  } as const;

  it.effect("asks HQ to stop, and says it is stopping until HQ's record no longer follows it", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const r = rig({
        unfollowRepoUpstream: async (...args) => {
          sent.push(args);
        },
      });
      r.publish(null, "https://github.com/acme/tea-shop.git");
      yield* r.operations.submit(stop);
      expect(sent).toEqual([[appId, "appdev"]]);
      expect(r.stage().stage).not.toBe("done");
      r.publish(null);
      expect(r.stage()).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );

  it.effect.each([
    {
      name: "HQ's refusal",
      api: {
        unfollowRepoUpstream: async () => {
          throw new HqError({
            kind: "refused",
            code: "remote_refused",
            status: 403,
            message: "Only the organization's owner or admin can change this.",
          });
        },
      },
    },
    { name: "an HQ that cannot stop one", api: {} },
  ])("is refused by $name", ({ api }) =>
    Effect.gen(function* () {
      const r = rig(api);
      yield* r.operations.submit(stop);
      expect(r.stage()).toMatchObject({ stage: "refused" });
    }),
  );
});
