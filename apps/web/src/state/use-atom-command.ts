import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { captureAccountLifetime } from "../zerops/accountLifetime";
import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext } from "react";

/**
 * Runs a command once the account's own evidence admits it, waiting for a
 * waitable refusal as long as a command waits (DESIGN §4.3, D4(b)). A refusal
 * comes back as the command's typed failure, for its caller to show, and is
 * reported as any failure of the command is; a result that arrives after its
 * account closed is interrupted, never shown.
 */
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
      if (!alive()) return AsyncResult.failure(Cause.interrupt(0));
      const reporting = { label, reportFailure, reportDefect };
      const result = await runAtomCommand(registry, command, value, reporting);
      return alive() ? result : AsyncResult.failure(Cause.interrupt(0));
    },
    [command, label, registry, reportDefect, reportFailure],
  );
}
