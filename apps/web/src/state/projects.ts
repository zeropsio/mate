import { createEnvironmentProjectAtoms } from "@t3tools/client-runtime/state/projects";
import { createProjectCommands } from "@t3tools/client-runtime/state/projects";
import { AsyncResult } from "effect/unstable/reactivity";
import { workspaceHostAtom, workspaceQuery } from "./workspace";
import {
  createAtomCommandScheduler,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";
import type { StreamFault } from "@t3tools/client-runtime/data";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

const localProjectCommands = createProjectCommands(connectionAtomRuntime);
const fileCommands = createAtomCommandScheduler();
const writeFile: AtomCommand<
  { readonly environmentId: EnvironmentId; readonly input: ProjectWriteFileInput },
  ProjectWriteFileResult,
  StreamFault
> = {
  label: "data:mate-write-file",
  run: (registry, target) =>
    fileCommands.schedule(
      registry,
      {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.cwd, input.relativePath]),
      },
      target,
      () =>
        registry.get(workspaceHostAtom)?.writeFile(target) ??
        Promise.resolve(
          AsyncResult.fail<StreamFault, ProjectWriteFileResult>({
            outcome: "definitive-refusal",
            message: "Sign in before saving a file.",
          }),
        ),
    ),
};
export const projectEnvironment = {
  create: localProjectCommands.create,
  update: localProjectCommands.update,
  delete: localProjectCommands.delete,
  readFile: workspaceQuery("file"),
  listEntries: workspaceQuery("entries"),
  searchEntries: workspaceQuery("paths"),
  writeFile,
};
/**
 * Web-only: project content search backs the ⇧⌘F dialog, which has no mobile
 * surface, so the atom family lives here instead of the shared client-runtime
 * project atoms consumed by the mobile app.
 */
export const projectContentSearch = workspaceQuery("contents");
export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});
