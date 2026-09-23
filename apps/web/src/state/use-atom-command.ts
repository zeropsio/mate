import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { captureAccountLifetime } from "../zerops/accountLifetime";
import { ZeropsDataContext } from "../zerops/zeropsDataContext";
import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  CAPABILITY_WAIT_MS,
  CapabilityRefusal,
  grantCapabilities,
} from "@t3tools/client-runtime/zerops/data";
import { useCallback, useContext, useMemo } from "react";

const SIGN_IN_ENDED = new CapabilityRefusal({
  allowed: false,
  reason: "epoch-closed",
  waitable: false,
});

/**
 * Runs a command once the account's own evidence admits it, waiting for a
 * waitable refusal as long as a command waits (DESIGN §4.3, D4(b)). A refusal
 * comes back as the command's typed failure, for its caller to show; a result
 * that arrives after its account closed is interrupted, never shown.
 */
export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E | CapabilityRefusal>> {
  const registry = useContext(RegistryContext);
  const data = useContext(ZeropsDataContext);
  const capabilities = useMemo(
    () => (data === null ? null : grantCapabilities(data.runtime.access)),
    [data],
  );
  const label = typeof options === "string" ? options : (options?.label ?? command.label);
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);

  return useCallback(
    async (value: W) => {
      const alive = captureAccountLifetime();
      if (!alive()) return AsyncResult.failure(Cause.interrupt(0));
      const refusal =
        capabilities === null
          ? SIGN_IN_ENDED
          : await Effect.runPromise(
              capabilities
                .await({ kind: "account" }, { withinMs: CAPABILITY_WAIT_MS })
                .pipe(Effect.match({ onFailure: (refused) => refused, onSuccess: () => null })),
            );
      if (!alive()) return AsyncResult.failure(Cause.interrupt(0));
      if (refusal !== null) return AsyncResult.failure(Cause.fail(refusal));
      const result = await runAtomCommand(registry, command, value, {
        label,
        reportFailure,
        reportDefect,
      });
      return alive() ? result : AsyncResult.failure(Cause.interrupt(0));
    },
    [capabilities, command, label, registry, reportDefect, reportFailure],
  );
}
