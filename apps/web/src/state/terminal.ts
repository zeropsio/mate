import {
  mateActionCommand,
  mateFeedAsyncAtom,
  makeTerminalByteAtoms,
  makeTerminalInputCommands,
} from "@t3tools/client-runtime/data";
import { type EnvironmentId } from "@t3tools/contracts";
import { createAtomCommandScheduler } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";
const scheduler = createAtomCommandScheduler();
const concurrency = {
  mode: "serial" as const,
  key: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly threadId: string };
  }) => JSON.stringify([target.environmentId, target.input.threadId]),
};
const metadata = Atom.family((environmentId: EnvironmentId) =>
  mateFeedAsyncAtom({ family: "mateTerminal", environmentId, input: null }),
);
export const terminalEnvironment = {
  ...makeTerminalByteAtoms(connectionAtomRuntime),
  ...makeTerminalInputCommands(connectionAtomRuntime),
  metadata: (target: { readonly environmentId: EnvironmentId; readonly input: null }) =>
    metadata(target.environmentId),
  open: mateActionCommand(connectionAtomRuntime, "terminalOpen", { scheduler, concurrency }),
  clear: mateActionCommand(connectionAtomRuntime, "terminalClear", { scheduler, concurrency }),
  restart: mateActionCommand(connectionAtomRuntime, "terminalRestart", { scheduler, concurrency }),
  close: mateActionCommand(connectionAtomRuntime, "terminalClose", { scheduler, concurrency }),
};
