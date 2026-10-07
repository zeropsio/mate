/** Crew presses dispatch intents; file editors share the account's sampled crew-home read. */
import { mateActionCommand, mateFeedAtom, readMateFeed } from "@t3tools/client-runtime/data";
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
export const crewFilesAtom = Atom.family((environmentId: EnvironmentId) =>
  mateFeedAtom({ family: "mateCrewFiles", environmentId, input: {} }),
);
export function createCrewCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    command: mateActionCommand(runtime, "crewCommand"),
    filesGet: createRuntimeCommand(runtime, {
      label: "mate:crew:files:get",
      execute: (
        target: { readonly environmentId: EnvironmentId; readonly input: Record<string, never> },
        registry,
      ) =>
        readMateFeed(registry, {
          family: "mateCrewFiles",
          environmentId: target.environmentId,
          input: {},
        }),
    }),
    filesPut: mateActionCommand(runtime, "crewFilesPut"),
  };
}
export const crewCommands = createCrewCommandAtoms(connectionAtomRuntime);
