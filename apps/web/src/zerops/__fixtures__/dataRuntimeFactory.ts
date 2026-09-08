/**
 * A fake `MakeZeropsDataRuntime` for `ZeropsDataProvider` ownership tests
 * (M8): records every create/shutdown call so a test can assert counts and
 * order without standing up a real adapter stack. Lives outside `*.test.*`
 * only for consistency with the other fixtures in this directory — it does
 * not itself run `Effect.runSync`/`runPromise`.
 */
import type { AccountScope, ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";

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
 */
export function makeFakeRuntimeFactory(
  options: { readonly resolveMode?: "immediate" | "manual" } = {},
) {
  const handles: FakeRuntimeHandle[] = [];
  const factory: MakeZeropsDataRuntime = ({ scope, signal }) => {
    const shutdownReasons: ShutdownReason[] = [];
    const runtime = {
      scope,
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
