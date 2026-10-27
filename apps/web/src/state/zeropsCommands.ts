import { connectionAtomRuntime } from "../connection/runtime";
import { createZeropsCommandAtoms } from "../zerops/commands";

export const zeropsCommands = createZeropsCommandAtoms(connectionAtomRuntime);
