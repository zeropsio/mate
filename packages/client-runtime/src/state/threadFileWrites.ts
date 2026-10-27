/**
 * What a thread's agent wrote, asked of its server (`threadFileWrites.ts` in
 * the contracts):
 * - `fileWrites` — server scope `orchestration:read`; a write's or an edit's
 *   change, from its call's stored payload;
 * - `writtenFile` — server scope `orchestration:read`; what the thread's
 *   newest completed write of a path outside the workspace wrote there, from
 *   the thread's record, never from disk.
 */
import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createThreadFileWritesAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    fileWrites: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:threads:fileWrites",
      tag: WS_METHODS.threadsFileWrites,
    }),
    writtenFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:threads:writtenFile",
      tag: WS_METHODS.threadsWrittenFile,
    }),
  };
}
