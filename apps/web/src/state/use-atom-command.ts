import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { accountActionsAllowed, captureAccountLifetime } from "../zerops/accountLifetime";
import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext } from "react";

export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const label = typeof options === "string" ? options : (options?.label ?? command.label);
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);

  return useCallback(
    async (value: W) => {
      const alive = captureAccountLifetime();
      if (!alive() || !accountActionsAllowed()) return AsyncResult.failure(Cause.interrupt(0));
      const result = await runAtomCommand(registry, command, value, {
        label,
        reportFailure,
        reportDefect,
      });
      return alive() ? result : AsyncResult.failure(Cause.interrupt(0));
    },
    [command, label, registry, reportDefect, reportFailure],
  );
}
