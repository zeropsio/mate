import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { fixtureWire } from "./__fixtures__/zeropsWire.ts";
import { startZeropsNavigation } from "./account.ts";
import { runningScope } from "./families/process.ts";
import { linkKeys } from "./model.ts";
import { streamOf } from "./reducer.ts";
import { makeAccountStore } from "./store.ts";

/** The navigation runs on its own runtime: real time passes for it. */
const turns = Effect.sleep(1);

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
