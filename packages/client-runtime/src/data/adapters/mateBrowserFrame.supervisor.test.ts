import { describe, expect, it } from "@effect/vitest";
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { mateBrowserFrameScope } from "../families/mateBrowserFrame.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore } from "../store.ts";
import { startMateBrowserFrames } from "./mateBrowserFrame.ts";

describe("browser frame supervision", () => {
  it.live("a definitive refusal survives remount and never reopens automatically", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      let opens = 0;
      const wire = {
        open: Stream.unwrap(
          Effect.sync(() => {
            opens++;
            return Stream.fail(
              new EnvironmentAuthorizationError({
                message: "denied",
                requiredScope: "orchestration:read",
              }),
            );
          }),
        ),
      };
      const first = startMateBrowserFrames({ environmentId: "mate", store, wire });
      yield* settle;
      expect(streamOf(store.state(), mateBrowserFrameScope("mate")).phase).toBe("refused");
      first.stop();
      const second = startMateBrowserFrames({ environmentId: "mate", store, wire });
      yield* settle;
      expect(opens).toBe(1);
      second.stop();
      store.close();
      registry.dispose();
    }),
  );
});
