import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "../../zerops/hq/client.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { autoUpdatePolicySettings } from "../projections/hqAutoUpdatePolicy.ts";
import { makeAutoUpdatePolicyReads, observeAutoUpdatePolicy } from "./hqAutoUpdatePolicy.ts";

function setup() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const read = (admin = true, orgId = "org") =>
    autoUpdatePolicySettings.derive(readsOfState(store.state()), { orgId, admin });
  const until = (accept: () => boolean) =>
    Effect.callback<void>((resume) => {
      const stop = store.subscribe(() => {
        if (accept()) {
          stop();
          resume(Effect.void);
        }
      });
      if (accept()) {
        stop();
        resume(Effect.void);
      }
      return Effect.sync(stop);
    });
  return { store, read, until };
}

describe("organization automatic-update evidence", () => {
  it.effect("shares demand, keeps unknown unknown and reads again when settings reopen", () =>
    Effect.gen(function* () {
      const { store, read, until } = setup();
      let calls = 0;
      const answer = Promise.withResolvers<{ orgId: string; enabled: boolean; revision: number }>();
      const reader = makeAutoUpdatePolicyReads(store, {
        autoUpdatePolicy: () => {
          calls++;
          return answer.promise;
        },
      });
      expect(read()).toMatchObject({ enabled: null, editable: false });
      const release = reader.demand("org");
      const release2 = reader.demand("org");
      answer.resolve({ orgId: "org", enabled: true, revision: 0 });
      yield* until(() => read().editable);
      expect(calls).toBe(1);
      expect(read(false)).toMatchObject({ enabled: true, editable: false, words: "On" });
      expect(read(true, "other")).toMatchObject({ enabled: null, editable: false });
      release();
      release2();
      const reopened = reader.demand("org");
      yield* until(() => calls === 2 && read().editable);
      reopened();
      reader.close();
    }),
  );

  it.effect("keeps a confirmed toggle when an older GET arrives afterwards", () =>
    Effect.gen(function* () {
      const { store, read, until } = setup();
      const answer = Promise.withResolvers<{ orgId: string; enabled: boolean; revision: number }>();
      const reader = makeAutoUpdatePolicyReads(store, {
        autoUpdatePolicy: () => answer.promise,
      });
      reader.demand("org");
      observeAutoUpdatePolicy(store, { orgId: "org", enabled: false, revision: 2 });
      answer.resolve({ orgId: "org", enabled: true, revision: 1 });
      yield* until(() => read().editable);
      expect(read()).toMatchObject({ enabled: false, words: "Off" });
      reader.close();
    }),
  );

  it.effect("withholds refused policy, stops recovery and recovers on an explicit read", () =>
    Effect.gen(function* () {
      const { store, read, until } = setup();
      let refused = true;
      let calls = 0;
      const reader = makeAutoUpdatePolicyReads(store, {
        autoUpdatePolicy: async () => {
          calls++;
          if (refused)
            throw new HqError({
              kind: "refused",
              code: "forbidden",
              message: "Membership was removed.",
            });
          return { orgId: "org", enabled: false, revision: 1 };
        },
      });
      reader.demand("org");
      yield* until(() => read().error !== null);
      expect(read()).toMatchObject({
        enabled: null,
        editable: false,
        error: "Membership was removed.",
        retryRead: true,
      });
      expect(calls).toBe(1);
      refused = false;
      reader.again("org");
      yield* until(() => read().editable);
      expect(read()).toMatchObject({ enabled: false, error: null });
      reader.close();
    }),
  );

  it.effect("does not publish an answer after its account closes", () =>
    Effect.gen(function* () {
      const { store, read } = setup();
      const started = Promise.withResolvers<void>();
      const answer = Promise.withResolvers<{ orgId: string; enabled: boolean; revision: number }>();
      const reader = makeAutoUpdatePolicyReads(store, {
        autoUpdatePolicy: () => {
          started.resolve();
          return answer.promise;
        },
      });
      reader.demand("org");
      yield* Effect.promise(() => started.promise);
      reader.close();
      answer.resolve({ orgId: "org", enabled: true, revision: 1 });
      yield* Effect.yieldNow;
      expect(read().enabled).toBeNull();
    }),
  );
});
