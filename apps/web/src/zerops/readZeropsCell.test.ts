import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsCell, readZeropsCellOnce } from "./readZeropsCell";

describe("readZeropsCellOnce", () => {
  it("releases the lease and resolves undefined when the signal aborts before settling", async () => {
    let released = false;
    const broker = {
      acquire: () =>
        Effect.acquireRelease(
          Effect.succeed({
            key: "k" as never,
            request: {} as never,
            snapshot: undefined as never,
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
    } as unknown as import("./zeropsDataContext").ZeropsDataContextValue["runtime"]["cells"];
    const controller = new AbortController();
    const pending = readZeropsCellOnce(broker, {} as never, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(released).toBe(true);
  });

  it("answers nothing for a read that did not succeed", async () => {
    await expect(readZeropsCellOnce(settling(FAILED), {} as never)).resolves.toBeUndefined();
  });
});

const FAILED = {
  state: "failed",
  failure: { kind: "transport", detail: "Zerops did not answer." },
  atMs: 0,
  attempt: 1,
  retryAtMs: 2_000,
} as const;

/** A read that settled on `value`, fresh or with its revalidation failed. */
const known = (value: string | undefined, fresh = true) => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: fresh
    ? { kind: "settled" }
    : {
        kind: "stale",
        reason: {
          kind: "revalidation-failed",
          failure: FAILED.failure,
          attempt: 1,
          retryAtMs: 2_000,
        },
        sinceMs: 1,
      },
});

/** A broker whose one lease settles on `shown`. */
function settling(shown: unknown) {
  return {
    acquire: () =>
      Effect.succeed({
        key: "k" as never,
        request: {} as never,
        snapshot: undefined as never,
        awaitSettled: Effect.succeed(shown),
        retry: undefined as never,
        release: Effect.void,
      }),
  } as unknown as import("./zeropsDataContext").ZeropsDataContextValue["runtime"]["cells"];
}

describe("readZeropsCell", () => {
  it("an explicit again refreshes a held cell once before awaiting its answer", async () => {
    let retried = 0;
    const broker = {
      acquire: () =>
        Effect.succeed({
          retry: Effect.sync(() => {
            retried += 1;
            return true;
          }),
          awaitSettled: Effect.sync(() => known(retried === 0 ? "old" : "fresh")),
        }),
    } as unknown as Parameters<typeof readZeropsCell>[0];
    await expect(readZeropsCell(broker, {} as never, undefined, true)).resolves.toBe("fresh");
    expect(retried).toBe(1);
  });

  it("rejects a read that did not succeed, rather than answering nothing", async () => {
    await expect(readZeropsCell(settling(FAILED), {} as never)).rejects.toBeDefined();
    await expect(
      readZeropsCell(
        settling({ state: "withheld", reason: "access-lapsed", cause: null }),
        {} as never,
      ),
    ).rejects.toBeDefined();
    await expect(readZeropsCell(settling(known("v0", false)), {} as never)).rejects.toBeDefined();
  });

  it("answers a read that succeeded, including a service with no version name", async () => {
    await expect(readZeropsCell(settling(known("v1")), {} as never)).resolves.toBe("v1");
    await expect(readZeropsCell(settling(known(undefined)), {} as never)).resolves.toBeUndefined();
  });
});
