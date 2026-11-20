import type { MateActionInput } from "@t3tools/client-runtime/data";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  KeybindingCommand,
  ProjectId,
  ProjectScript,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";
import { isElectron } from "../env";
import type { EnvironmentPresentation } from "../state/environments";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { stackedThreadToast, toastManager } from "~/lib/toasts";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
} from "~/projectScripts";
import { projectScriptKeybindingWrites } from "./ChatView.logic";
import { type NewProjectScriptInput } from "./ProjectScriptsControl";

/** Adding, changing and deleting the active project's actions, with their keybindings (`ConversationView`'s action editor). */
export function useProjectScriptEditing({
  updateProjectScriptSettings,
  removeKeybinding,
  upsertKeybinding,
  environmentId,
  environmentById,
  allProjects,
  settings,
  activeProject,
  activeProjectScripts,
}: {
  updateProjectScriptSettings: (value: {
    readonly environmentId: EnvironmentId;
    readonly input: MateActionInput<"updateSettings">;
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  removeKeybinding: (value: {
    readonly environmentId: EnvironmentId;
    readonly input: MateActionInput<"removeKeybinding">;
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  upsertKeybinding: (value: {
    readonly environmentId: EnvironmentId;
    readonly input: MateActionInput<"upsertKeybinding">;
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  environmentId: EnvironmentId;
  environmentById: Map<EnvironmentId, EnvironmentPresentation>;
  allProjects: ReadonlyArray<EnvironmentProject>;
  settings: UnifiedSettings;
  activeProject: EnvironmentProject | null;
  activeProjectScripts: ReadonlyArray<ProjectScript>;
}) {
  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ReadonlyArray<ProjectScript>;
      nextScripts: ReadonlyArray<ProjectScript>;
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand | null;
    }): Promise<AtomCommandResult<void, unknown>> => {
      const updateResult = mapAtomCommandResult(
        await updateProjectScriptSettings({
          environmentId,
          input: {
            patch: {
              projectScriptOverrides: {
                [input.projectId]: input.nextScripts,
              },
            },
          },
        }),
        () => undefined,
      );
      if (updateResult._tag === "Failure") {
        return updateResult;
      }

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: input.keybindingCommand,
      });

      if (!isElectron) return updateResult;
      const scriptId =
        input.keybindingCommand === null
          ? null
          : projectScriptIdFromCommand(input.keybindingCommand);
      const writes = projectScriptKeybindingWrites({
        rule: keybindingRule,
        command: input.keybindingCommand,
        bound: environmentById.get(environmentId)?.serverConfig?.keybindings ?? [],
        retainedElsewhere:
          scriptId !== null &&
          allProjects.some(
            (other) =>
              other.environmentId === environmentId &&
              other.id !== input.projectId &&
              resolveProjectScripts(settings, other).some((script) => script.id === scriptId),
          ),
      });
      for (const rule of writes.remove) {
        const removed = await removeKeybinding({ environmentId, input: rule });
        if (removed._tag === "Failure") return mapAtomCommandResult(removed, () => undefined);
      }
      return writes.upsert === null
        ? updateResult
        : mapAtomCommandResult(
            await upsertKeybinding({ environmentId, input: writes.upsert }),
            () => undefined,
          );
    },
    [
      allProjects,
      environmentById,
      environmentId,
      removeKeybinding,
      settings,
      updateProjectScriptSettings,
      upsertKeybinding,
    ],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const nextId = nextProjectScriptId(
        input.name,
        activeProjectScripts.map((script) => script.id),
      );
      const nextScript = buildProjectScript(nextId, input);
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProjectScripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProjectScripts, nextScript];

      return persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProjectScripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, activeProjectScripts, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (
      scriptId: string,
      input: NewProjectScriptInput,
    ): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const existingScript = activeProjectScripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        return AsyncResult.failure(Cause.fail(new Error("Script not found.")));
      }

      const updatedScript = buildProjectScript(existingScript.id, input);
      const nextScripts = activeProjectScripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      return persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProjectScripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, activeProjectScripts, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const nextScripts = activeProjectScripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProjectScripts.find((s) => s.id === scriptId)?.name;

      const result = await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProjectScripts,
        nextScripts,
        keybinding: null,
        keybindingCommand: commandForProjectScript(scriptId),
      });
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } else if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not delete action",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      }
      return result;
    },
    [activeProject, activeProjectScripts, persistProjectScripts],
  );
  return { saveProjectScript, updateProjectScript, deleteProjectScript };
}
