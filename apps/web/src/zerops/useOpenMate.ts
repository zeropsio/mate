/**
 * Opening a Mate: its conversation, wherever the ask came from — its row in
 * the left menu, the jump box, a toast's *Open*.
 *
 * Its main chat opens (`resolvePrimaryConversation`), never whichever
 * project anywhere was touched last, which is what landing on the index
 * would pick; its other chats are in its conversation strip. A Mate with no
 * conversation yet starts one in its environment's project. A Mate that is
 * not registered here, or is gone or replaced, hands off to the projects
 * screen, which owns the connect flow — better than a row that looks
 * clickable and quietly does nothing. Whatever its socket is doing, a
 * registered one opens: the route says what the Mate is up to.
 *
 * `then` is told which conversation opened — its thread, or the one a Mate
 * with none starts — for what the caller opens beside it (its menu's *Crew*,
 * the Crew tab). Nothing is told where the projects screen takes over.
 *
 * A Mate still in its first minutes (`mateComing`) opens its own view, where
 * it comes up and hands over to its conversation once it is up — not the
 * projects screen, where its row pressed from there did nothing at all (the
 * owner, 2026-09-29).
 */
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { readThreadShells, useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { mateComing } from "./mateComing";
import { newMateView, useNewMate } from "./newMate";
import { useZeropsBirths } from "./zeropsBirths";

export function useOpenMate(): (
  candidate: ZeropsCandidate,
  then?: (conversation: ScopedThreadRef) => void,
) => void {
  const router = useRouter();
  const { linkTarget } = useEnvironmentLinks();
  const threads = useThreadShells();
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const { births } = useZeropsBirths();
  const creations = useNewMate((state) => state.creations);
  return useCallback(
    (candidate: ZeropsCandidate, then?: (conversation: ScopedThreadRef) => void) => {
      const coming = mateComing({
        birth: births.find((birth) => birth.projectId === candidate.project.id),
        candidate,
        setUpFailed: creations[candidate.project.id]?.failed,
      });
      if (coming !== undefined) {
        void router.navigate(newMateView(candidate.project.id));
        return;
      }
      const environmentId = linkTarget(candidate);
      if (environmentId === undefined) {
        void router.navigate({ to: "/zerops" });
        return;
      }
      const { primary } = resolvePrimaryConversation(
        threads.filter((thread) => thread.environmentId === environmentId),
      );
      if (primary !== undefined) {
        const conversation = scopeThreadRef(environmentId, primary.id);
        // Before the route changes, so the conversation paints with it.
        then?.(conversation);
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(conversation),
        });
        return;
      }
      const project = projects.find((entry) => entry.environmentId === environmentId);
      if (project !== undefined) {
        void handleNewThread(scopeProjectRef(project.environmentId, project.id)).then((opened) => {
          // No new chat where a conversation appeared meanwhile: that one opened instead.
          const threadId =
            opened?.threadId ??
            resolvePrimaryConversation(
              readThreadShells().filter((thread) => thread.environmentId === environmentId),
            ).primary?.id;
          if (threadId !== undefined) then?.(scopeThreadRef(project.environmentId, threadId));
        });
        return;
      }
      void router.navigate({ to: "/" });
    },
    [births, creations, handleNewThread, linkTarget, projects, router, threads],
  );
}
