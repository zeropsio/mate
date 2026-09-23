/**
 * A fake `MakeZeropsDataRuntime` for `ZeropsDataProvider` ownership tests
 * (M8): records every create/shutdown call so a test can assert counts and
 * order without standing up a real adapter stack. Lives outside `*.test.*`
 * only for consistency with the other fixtures in this directory — it does
 * not itself run `Effect.runSync`/`runPromise`.
 */
import {
  initialGrant,
  type AccessGrantView,
  type AccountScope,
  type ManagedZeropsDataRuntime,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { MakeZeropsDataRuntime } from "../ZeropsDataProvider";

export type ShutdownReason = "logout" | "account-replaced" | "application-close";

export interface FakeRuntimeHandle {
  readonly scope: AccountScope;
  readonly runtime: ManagedZeropsDataRuntime;
  readonly shutdownReasons: ShutdownReason[];
  readonly signal: AbortSignal;
  resolve: (() => void) | null;
  reject: ((cause: unknown) => void) | null;
  settled: boolean;
}

/**
 * `resolveMode` controls how each call settles:
 * - "immediate" (default): resolves on the next microtask.
 * - "manual": the test drives resolution/rejection itself via the returned
 *   handle, held in `handles`.
 *
 * `startGrant` is what starting each runtime's grant does; by default nothing.
 */
export function makeFakeRuntimeFactory(
  options: {
    readonly resolveMode?: "immediate" | "manual";
    readonly startGrant?: Effect.Effect<void>;
  } = {},
) {
  const handles: FakeRuntimeHandle[] = [];
  const factory: MakeZeropsDataRuntime = ({ scope, signal }) => {
    const shutdownReasons: ShutdownReason[] = [];
    // A grant that never verifies: these tests own the runtime's lifetime, not its access.
    const view: AccessGrantView = {
      machine: initialGrant({ hidden: false, online: true }, { wall: 0, mono: 0 }),
      failure: null,
      overdue: false,
    };
    const runtime = {
      scope,
      access: {
        start: () => options.startGrant ?? Effect.void,
        signal: () => Effect.void,
        listen: () => Effect.void,
        view: Atom.make(view),
        changes: Stream.make(view),
        invalidations: Stream.empty,
        mounted: Effect.void,
      },
      listen: () => Effect.void,
      shutdown: (reason: ShutdownReason) => Effect.sync(() => shutdownReasons.push(reason)),
    } as unknown as ManagedZeropsDataRuntime;
    const handle: FakeRuntimeHandle = {
      scope,
      runtime,
      shutdownReasons,
      signal,
      resolve: null,
      reject: null,
      settled: false,
    };
    handles.push(handle);
    const promise = new Promise<ManagedZeropsDataRuntime>((resolve, reject) => {
      handle.resolve = () => {
        if (handle.settled) return;
        handle.settled = true;
        resolve(runtime);
      };
      handle.reject = (cause) => {
        if (handle.settled) return;
        handle.settled = true;
        reject(cause);
      };
    });
    if (options.resolveMode !== "manual") queueMicrotask(() => handle.resolve?.());
    return promise;
  };
  return { factory, handles };
}
