/**
 * Opening a Mate: its conversation, wherever the ask came from — its row in the left menu, the
 * jump box and its toast's *Open*, a project's page, an ask handed to it.
 *
 * Its main chat opens (`resolvePrimaryConversation`), never whichever project anywhere was touched
 * last, which is what landing on the index would pick; its other chats are in its conversation
 * strip. A Mate this page holds no socket to, or whose conversations it has not read, opens the
 * main chat HQ names for it (`useHqMainChats`): the route connects it (A9). A Mate with no
 * conversation yet starts one in its environment's project. What its row
 * shows is the listing's; what opens it is its machine (`mateLink`), so a row that stands for its
 * whole project while the project's services are read still opens its Mate.
 *
 * A Mate whose conversation cannot be opened yet opens its own view (`/mate/$projectId`), never the
 * projects screen (the owner, 2026-09-30: "all of the sudden when I now try to open Quinn or Wren it
 * just throws me at /zerops page"): its link not made in this tab yet, or being made again, its
 * environment's conversations not read yet, the listing not holding it yet. The view says what it
 * waits for and connects it, as the projects screen's Connect would, then hands over to its
 * conversation; one that cannot be opened — gone, replaced, refused — says why there.
 *
 * `then` is told which conversation opened — its thread, or the one a Mate with none starts — for
 * what the caller opens beside it (its menu's *Crew*, the Crew tab, an ask written in its
 * composer). Where the Mate's own view waits, the view tells it once it hands over (`mateOpening`).
 *
 * A Mate on its way off Zerops (`deletingMates.ts`) does not open, from any door: its row says
 * *Deleting…*, and what it held is going with it.
 *
 * A Mate still in its first minutes (`mateComing`) opens its own view, where it comes up and hands
 * over to its conversation once it is up (the owner, 2026-09-29).
 */
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { readThreadShells, useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { deletingMates, mateDeleting } from "./deletingMates";
import { arrivalAwaitsAnswer, arrivalLinkHolds, mateComing } from "./mateComing";
import { awaitMateConversation } from "./mateOpening";
import { useCreations } from "./creations";
import { newMateView } from "./newMate";
import { madeOf } from "./newProjectBirth";
import { useHqMainChats } from "./useMenuMateReadings";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useCloseOffHolds } from "./accountEnvironments";
import { closeOffHoldOf, pressComingInput, useMatePresses } from "./matePress";

/** Opens a Mate — its row, or its project where the caller holds no row — as every door does. */
export type OpenMate = (
  mate: ZeropsCandidate | { readonly projectId: string },
  then?: (conversation: ScopedThreadRef) => void,
) => void;

export function useOpenMate(): OpenMate {
  const router = useRouter();
  const { linkTarget, mateLink } = useEnvironmentLinks();
  const threads = useThreadShells();
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const presses = useMatePresses();
  const closeOffHolds = useCloseOffHolds();
  const creations = useCreations();
  const { listing } = useZeropsCandidates();
  const mainChatOf = useHqMainChats();
  return useCallback<OpenMate>(
    (mate, then) => {
      const projectId = "key" in mate ? mate.project.id : mate.projectId;
      const candidate =
        "key" in mate
          ? mate
          : heldCandidates(listing).rows.find((row) => row.project.id === projectId);
      // What an earlier door asked of its view is this door's to replace, whatever opens.
      awaitMateConversation(projectId, undefined);
      // Its own view: it waits there for its conversation, and tells `then` once it hands over.
      const ownView = () => {
        awaitMateConversation(projectId, then);
        void router.navigate(newMateView(projectId));
      };
      const openConversation = (conversation: ScopedThreadRef) => {
        // Before the route changes, so the conversation paints with it.
        then?.(conversation);
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(conversation),
        });
      };
      if (
        candidate === undefined
          ? deletingMates().has(projectId)
          : mateDeleting(candidate.project, deletingMates())
      ) {
        return;
      }
      if (candidate === undefined) {
        ownView();
        return;
      }
      const pressed = pressComingInput(presses, projectId);
      // Made here, and not connected since.
      const created = candidate.group !== "connected" && madeOf(creations, projectId) !== undefined;
      const coming = mateComing({
        press: pressed.press,
        // Held by the close-off gate, it opens on its own view, which says why.
        closeOffHold: closeOffHoldOf(
          closeOffHolds,
          projectId,
          presses.find((press) => press.projectId === projectId),
        ),
        candidate,
        setUpFailed: pressed.setUpFailed,
        nowMs: Date.now(),
        created,
        linkHolds: created ? arrivalLinkHolds(mateLink(candidate)) : undefined,
        answerAwaited:
          candidate.arriving === undefined ? undefined : arrivalAwaitsAnswer(mateLink(candidate)),
      });
      if (coming !== undefined) {
        ownView();
        return;
      }
      const told = mainChatOf(projectId);
      const environmentId = linkTarget(candidate);
      if (environmentId === undefined) {
        if (told === undefined) ownView();
        else openConversation(told);
        return;
      }
      const { primary } = resolvePrimaryConversation(
        threads.filter((thread) => thread.environmentId === environmentId),
      );
      if (primary !== undefined) {
        openConversation(scopeThreadRef(environmentId, primary.id));
        return;
      }
      const project = projects.find((entry) => entry.environmentId === environmentId);
      if (project === undefined) {
        // Its conversations are not read yet: HQ's main chat opens, else its own view waits.
        if (told === undefined) ownView();
        else openConversation(told);
        return;
      }
      void handleNewThread(scopeProjectRef(project.environmentId, project.id)).then((opened) => {
        // No new chat where a conversation appeared meanwhile: that one opened instead.
        const threadId =
          opened?.threadId ??
          resolvePrimaryConversation(
            readThreadShells().filter((thread) => thread.environmentId === environmentId),
          ).primary?.id;
        if (threadId !== undefined) then?.(scopeThreadRef(project.environmentId, threadId));
      });
    },
    [
      presses,
      closeOffHolds,
      creations,
      handleNewThread,
      linkTarget,
      listing,
      mainChatOf,
      mateLink,
      projects,
      router,
      threads,
    ],
  );
}
