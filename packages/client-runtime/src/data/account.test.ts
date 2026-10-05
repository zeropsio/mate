import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { fixtureWire } from "./__fixtures__/zeropsWire.ts";
import { observeAccount, startZeropsNavigation } from "./account.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { linkKeys } from "./model.ts";
import { streamOf } from "./reducer.ts";
import { makeAccountStore } from "./store.ts";

/** The navigation runs on its own runtime: real time passes for it. */
const turns = Effect.sleep(20);

describe("startZeropsNavigation", () => {
  it.live("observes the organization's running work until stopped, then lets its demand go", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        Effect.succeed(request.body?.wsOutputType === "listStream" ? { items: [] } : {}),
      );
      const navigation = startZeropsNavigation({
        orgId: "org",
        store,
        wire: fixture.wire,
        repairSession: Effect.void,
      });
      yield* turns;
      expect(streamOf(store.state(), runningScope("org")).phase).toBe("live");

      navigation.stop();
      yield* turns;
      expect(streamOf(store.state(), linkKeys.zerops("org")).demanded).toBe(false);
      expect(streamOf(store.state(), runningScope("org")).demanded).toBe(false);
    }),
  );
});

describe("observeAccount", () => {
  const HISTORY_PATH = "/project/p1/process?limit=100";
  it.live(
    "reads a detail held before an organization is shown once it is, and again on a switch",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire((request) =>
          Effect.succeed(
            request.method === "GET"
              ? { status: 200, body: { list: [] } }
              : request.body?.wsOutputType === "listStream"
                ? { items: [] }
                : {},
          ),
        );
        const account = observeAccount({ store, wire: fixture.wire, repairSession: Effect.void });
        const release = account.demandDetail({
          family: "process",
          listing: "history",
          ownerId: "p1",
        });
        const reads = () =>
          fixture.requests.filter((request) => request.path === HISTORY_PATH).length;
        yield* turns;
        expect(reads()).toBe(0);

        account.show("org-a");
        yield* turns;
        expect(reads()).toBe(1);
        expect(streamOf(store.state(), historyScope("org-a", "p1")).phase).toBe("live");

        account.show("org-b");
        yield* turns;
        expect(reads()).toBe(2);
        expect(streamOf(store.state(), historyScope("org-a", "p1")).demanded).toBe(false);
        expect(streamOf(store.state(), historyScope("org-b", "p1")).phase).toBe("live");

        release();
        yield* turns;
        expect(streamOf(store.state(), historyScope("org-b", "p1")).demanded).toBe(false);
        account.show(null);
        yield* turns;
        expect(streamOf(store.state(), linkKeys.zerops("org-b")).demanded).toBe(false);
      }),
  );
});
