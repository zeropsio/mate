import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { mateLimitAtom } from "@t3tools/client-runtime/data";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";

import { threadEnvironment } from "../state/threads";
import { useNewThreadHandler } from "./useHandleNewThread";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { readThreadShell } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { useMateCommand } from "../zerops/accountEnvironments";
import { showZeropsReleaseAsk } from "../zerops/releaseAskNotice";
import { useZeropsReleaseRequest } from "../zerops/useZeropsReleaseRequest";
import { showUndoToast } from "./showUndoToast";
import * as ThreadUndo from "./threadUndo";

export class ThreadArchiveBlockedError extends Schema.TaggedError<ThreadArchiveBlockedError>()(
  "ThreadArchiveBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Cannot archive a running thread.";
  }
}

export function useThreadActions() {
  const archiveThreadMutation = useMateCommand(threadEnvironment.archive, {
    reportFailure: false,
  });
  const unarchiveThreadMutation = useMateCommand(threadEnvironment.unarchive, {
    reportFailure: false,
  });
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const requestRelease = useZeropsReleaseRequest();
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without appearing in
  // its dependency array — handleNewThread is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveThread → attemptArchiveThread.
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;

  const resolveThreadTarget = useCallback((target: ScopedThreadRef) => {
    const thread = readThreadShell(target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  }, []);
  const getCurrentRouteThreadRef = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteRef(currentRouteParams);
  }, [router]);

  const unarchiveThread = useCallback(
    async (target: ScopedThreadRef, opts: { navigate?: boolean } = {}) => {
      ThreadUndo.invalidate("archive", scopedThreadKey(target));
      const result = await unarchiveThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Failure") {
        return result;
      }
      refreshArchivedThreadsForEnvironment(target.environmentId);
      if (opts.navigate) {
        return settlePromise(() =>
          router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(target),
          }),
        );
      }
      return result;
    },
    [router, unarchiveThreadMutation],
  );

  const archiveThread = useCallback(
    async (
      target: ScopedThreadRef,
      opts: {
        onArchived?: () => void;
        /** What the undo toast says, where archiving is a step of something else. */
        toast?: { readonly title: string; readonly description: string };
      } = {},
    ) => {
      const resolved = resolveThreadTarget(target);
      if (!resolved) return AsyncResult.success(undefined);
      const { thread, threadRef } = resolved;
      if (
        thread.session?.status === "running" &&
        thread.session.activeTurnId != null &&
        appAtomRegistry.get(mateLimitAtom(scopedThreadKey(threadRef))).kind === "none"
      ) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadArchiveBlockedError({
              environmentId: threadRef.environmentId,
              threadId: threadRef.threadId,
            }),
          ),
        );
      }

      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateToDraft =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      const action = ThreadUndo.begin("archive", scopedThreadKey(threadRef));
      const archiveResult = await archiveThreadMutation({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (archiveResult._tag === "Failure") {
        action.finish();
        return archiveResult;
      }
      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      opts.onArchived?.();
      showUndoToast({
        title: opts.toast?.title ?? "Thread archived",
        description: opts.toast?.description ?? thread.title,
        claim: action,
        // Undo also brings the reader back when archiving moved them to a draft.
        undo: () => unarchiveThread(threadRef, { navigate: shouldNavigateToDraft }),
        failureTitle: "Failed to undo archive",
      });
      // Bound to a lease zcp still holds: ask whether to release its workspace too. The archive is
      // done; only the person's Release sends anything, and it brings the conversation back first.
      const lease = thread.lease;
      if (lease != null) {
        showZeropsReleaseAsk({
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          lease,
          latestTurn: thread.latestTurn,
          onRelease: () =>
            requestRelease({
              threadRef,
              conversation: thread,
              alias: lease.alias,
              archived: true,
              unarchive: () => unarchiveThread(threadRef, { navigate: true }),
            }),
        });
      }

      if (shouldNavigateToDraft) {
        const navigationResult = await settlePromise(() =>
          // Fresh: the archived thread may still read as the Mate's one
          // conversation until the projection catches up.
          handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
            fresh: true,
          }),
        );
        if (navigationResult._tag === "Failure") {
          return navigationResult;
        }
        return archiveResult;
      }

      return archiveResult;
    },
    [
      archiveThreadMutation,
      getCurrentRouteThreadRef,
      markThreadVisited,
      requestRelease,
      resolveThreadTarget,
      unarchiveThread,
    ],
  );

  return useMemo(() => ({ archiveThread, unarchiveThread }), [archiveThread, unarchiveThread]);
}
