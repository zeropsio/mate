import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { conversationCodeFolder } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { useProjects } from "~/state/entities";

import { useHandleNewThread } from "./useHandleNewThread";

export interface ActiveProjectTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly threadRef: ScopedThreadRef;
}

/**
 * File searches use the same code folder as the thread's right panel so each
 * result opens relative to the folder that was searched.
 */
export function useActiveProjectTarget(): ActiveProjectTarget | null {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const projects = useProjects();
  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? activeDraftThread?.threadId;
  const project = thread
    ? projects.find(
        (candidate) =>
          candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
      )
    : null;
  if (!thread || !threadId || !project) return null;

  const cwd = conversationCodeFolder({
    workspaceRoot: project.workspaceRoot,
    lease: activeThread?.lease?.alias ?? null,
    worktreePath: thread.worktreePath,
  });
  if (!cwd) return null;

  return {
    environmentId: project.environmentId,
    cwd,
    projectName: project.title,
    threadRef: scopeThreadRef(thread.environmentId, threadId),
  };
}
