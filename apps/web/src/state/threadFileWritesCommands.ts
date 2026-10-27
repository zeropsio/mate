import { createThreadFileWritesAtoms } from "@t3tools/client-runtime/state/threadFileWrites";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadFileWritesCommands = createThreadFileWritesAtoms(connectionAtomRuntime);
