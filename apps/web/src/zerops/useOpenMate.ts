/**
 * Opening a Mate: its conversation, wherever the ask came from — its row in
 * the left menu, the jump box, a toast's *Open*.
 *
 * One environment is one conversation: *its* conversation opens
 * (`resolvePrimaryConversation`), never whichever project anywhere was
 * touched last, which is what landing on the index would pick. A Mate with no
 * conversation yet starts one in its environment's project. A Mate that is
 * not registered here, or is gone or replaced, hands off to the projects
 * screen, which owns the connect flow — better than a row that looks
 * clickable and quietly does nothing. Whatever its socket is doing, a
 * registered one opens: the route says what the Mate is up to.
 */
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";

export function useOpenMate(): (candidate: ZeropsCandidate) => void {
  const router = useRouter();
  const { linkTarget } = useEnvironmentLinks();
  const threads = useThreadShells();
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  return useCallback(
    (candidate: ZeropsCandidate) => {
      const environmentId = linkTarget(candidate);
      if (environmentId === undefined) {
        void router.navigate({ to: "/zerops" });
        return;
      }
      const { primary } = resolvePrimaryConversation(
        threads.filter((thread) => thread.environmentId === environmentId),
      );
      if (primary !== undefined) {
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(environmentId, primary.id)),
        });
        return;
      }
      const project = projects.find((entry) => entry.environmentId === environmentId);
      if (project !== undefined) {
        void handleNewThread(scopeProjectRef(project.environmentId, project.id));
        return;
      }
      void router.navigate({ to: "/" });
    },
    [handleNewThread, linkTarget, projects, router, threads],
  );
}
