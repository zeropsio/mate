/**
 * A fake `ZeropsResourceBroker.acquire` for a single resource kind, used to
 * test `useZeropsResource` consumers without a real runtime. Lives outside
 * `*.test.*` on purpose: it runs `Effect.runSync`/`Effect.runPromise`
 * directly, which `no-manual-effect-runtime-in-tests` forbids in test files.
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type {
  OrganizationLocationsResourceRequest,
  ZeropsResourceLease,
  ZeropsResourceRequest,
  ZeropsResourceSnapshot,
  ZeropsResourceValue,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsLocation } from "@t3tools/client-runtime/zerops";

/** Generic fake resource broker for one resource kind (its value type is derived from `Request`). */
export class FakeResourceBroker<Request extends ZeropsResourceRequest> {
  acquisitions = 0;
  current: ZeropsResourceSnapshot<ZeropsResourceValue<Request>> = { status: "loading", attempt: 1 };
  private readonly queue = Effect.runSync(
    Queue.unbounded<ZeropsResourceSnapshot<ZeropsResourceValue<Request>>>(),
  );

  publish(snapshot: ZeropsResourceSnapshot<ZeropsResourceValue<Request>>): Promise<void> {
    this.current = snapshot;
    return Effect.runPromise(Queue.offer(this.queue, snapshot)).then(() => undefined);
  }

  acquire = (request: Request): Effect.Effect<ZeropsResourceLease<Request>> => {
    this.acquisitions += 1;
    return Effect.succeed({
      key: request.kind as never,
      request,
      snapshot: Effect.sync(() => this.current),
      changes: Stream.fromQueue(this.queue),
      awaitSettled: Effect.sync(() => this.current) as never,
      retry: Effect.succeed(false) as never,
      release: Effect.void,
    });
  };
}

export type LocationsSnapshot = ZeropsResourceSnapshot<ReadonlyArray<ZeropsLocation>>;

/** @deprecated Kept for existing callers; prefer `FakeResourceBroker` directly. */
export class FakeLocationsBroker extends FakeResourceBroker<OrganizationLocationsResourceRequest> {}
