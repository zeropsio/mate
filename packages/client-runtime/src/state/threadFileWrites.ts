/**
 * What a thread's agent wrote, asked of its server (`threadFileWrites.ts` in
 * the contracts):
 * - `fileWrites` — server scope `orchestration:read`; a write's or an edit's
 *   change, from its call's stored payload;
 * - `readWrittenFile` — server scope `orchestration:read`; a file the thread's
 *   agent wrote outside the workspace, read-only, only one it wrote.
 */
import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

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
    readWrittenFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:threads:readWrittenFile",
      tag: WS_METHODS.threadsReadWrittenFile,
    }),
  };
}
