import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsResourceOnce } from "./useZeropsDeployedVersion";

describe("readZeropsResourceOnce", () => {
  it("releases the lease and resolves undefined when the signal aborts before settling", async () => {
    let released = false;
    const broker = {
      acquire: () =>
        Effect.acquireRelease(
          Effect.succeed({
            key: "k" as never,
            request: {} as never,
            snapshot: undefined as never,
            changes: undefined as never,
            // Never settles on its own; only interruption (abort) resolves the read.
            awaitSettled: Effect.never,
            retry: undefined as never,
            release: Effect.void,
          }),
          () =>
            Effect.sync(() => {
              released = true;
            }),
        ),
    } as unknown as import("./zeropsDataContext").ZeropsDataContextValue["runtime"]["resources"];
    const controller = new AbortController();
    const pending = readZeropsResourceOnce(broker, {} as never, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(released).toBe(true);
  });
});
