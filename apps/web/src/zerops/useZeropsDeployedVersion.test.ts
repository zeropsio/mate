import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsResource, readZeropsResourceOnce } from "./useZeropsDeployedVersion";

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

  it("answers nothing for a read that did not succeed", async () => {
    await expect(readZeropsResourceOnce(settling(FAILED), {} as never)).resolves.toBeUndefined();
  });
});

const FAILED = {
  status: "failure",
  attempt: 1,
  failure: { kind: "transport", message: "the platform did not answer" },
} as const;

/** A broker whose one lease settles on `snapshot`. */
function settling(snapshot: unknown) {
  return {
    acquire: () =>
      Effect.succeed({
        key: "k" as never,
        request: {} as never,
        snapshot: undefined as never,
        changes: undefined as never,
        awaitSettled: Effect.succeed(snapshot),
        retry: undefined as never,
        release: Effect.void,
      }),
  } as unknown as import("./zeropsDataContext").ZeropsDataContextValue["runtime"]["resources"];
}

describe("readZeropsResource", () => {
  it("rejects a read that did not succeed, rather than answering nothing", async () => {
    await expect(readZeropsResource(settling(FAILED), {} as never)).rejects.toBeDefined();
    await expect(
      readZeropsResource(settling({ status: "released" }), {} as never),
    ).rejects.toBeDefined();
  });

  it("answers a read that succeeded, including a service with no version name", async () => {
    await expect(
      readZeropsResource(settling({ status: "success", attempt: 1, value: "v1" }), {} as never),
    ).resolves.toBe("v1");
    await expect(
      readZeropsResource(
        settling({ status: "success", attempt: 1, value: undefined }),
        {} as never,
      ),
    ).resolves.toBeUndefined();
  });
});
