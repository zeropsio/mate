/** High-frequency terminal input retains its existing serial/latest session dispatch. */
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../../../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "../../../state/runtime.ts";
export function makeTerminalInputCommands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const resizeScheduler = createAtomCommandScheduler();
  return {
    write: createEnvironmentRpcCommand(runtime, {
      label: "mate:terminal:write",
      tag: WS_METHODS.terminalWrite,
    }),
    resize: createEnvironmentRpcCommand(runtime, {
      label: "mate:terminal:resize",
      tag: WS_METHODS.terminalResize,
      scheduler: resizeScheduler,
      concurrency: {
        mode: "latest",
        key: (target) =>
          JSON.stringify([
            target.environmentId,
            target.input.threadId,
            target.input.terminalId ?? null,
          ]),
      },
    }),
  };
}
