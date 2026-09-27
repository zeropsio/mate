/**
 * The crew's commands a client may issue (ARCHITECTURE §6 *RPC shape*):
 *
 * - `command` — `zerops.crew.command`, server scope `AuthOrchestrationOperateScope`:
 *   every press on a crew surface; what it changes arrives on the crew feed.
 * - `filesGet` — `zerops.crew.files.get`, `AuthOrchestrationReadScope`: the crew
 *   home's files for the editors.
 * - `filesPut` — `zerops.crew.files.put`, `AuthOrchestrationOperateScope`: an
 *   editor's save; nothing applies until a command does.
 */
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "~/connection/runtime";

export function createCrewCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    command: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:zerops:crew:command",
      tag: WS_METHODS.zeropsCrewCommand,
    }),
    filesGet: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:zerops:crew:files:get",
      tag: WS_METHODS.zeropsCrewFilesGet,
    }),
    filesPut: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:zerops:crew:files:put",
      tag: WS_METHODS.zeropsCrewFilesPut,
    }),
  };
}

export const crewCommands = createCrewCommandAtoms(connectionAtomRuntime);
