/**
 * Opening a Mate: its conversation, wherever the ask came from — its row in the left menu, the
 * jump box and its toast's *Open*, a project's page, an ask handed to it.
 *
 * Its main chat opens (`resolvePrimaryConversation`), never whichever project anywhere was touched
 * last; its other chats are in its conversation strip. A Mate this page holds no socket to, or whose main chat its conversations here lack — this
 * page keeps them current only while the Mate is open, so one started in another browser is not
 * among them — opens the main chat HQ names for it (`useHqMainChats`): the route connects it (A9).
 * A Mate with no conversation, here or by HQ's word, starts one in its environment's project. What its row
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
 * A Mate on its way off Zerops (`mateDeletionOf`: HQ's deletion of it runs, or Zerops deletes its
 * project) does not open, from any door, on any device: its row says *Deleting…*, and what it held
 * is going with it.
 *
 * A Mate still in its first minutes (`mateComing`) opens its own view, where it comes up and hands
 * over to its conversation once it is up (the owner, 2026-09-29).
 */
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { readThreadShells, useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  mateArrival,
  mateDeletionOf,
  mateDeletionOfProject,
  mateGoing,
} from "@t3tools/client-runtime/data";
import { hqPlacementsAtom } from "../state/zerops";
import { awaitMateConversation } from "./mateOpening";
import { mateOpening, type MateOpening } from "./mateOpening.logic";
import { useCreations } from "./creations";
import { newMateView } from "./newMate";
import { madeOf } from "./newProjectBirth";
import { useHqMainChats } from "./useMenuMateReadings";
import { useZeropsDetailCandidates } from "./useZeropsCandidates";

/** Opens a Mate — its row, or its project where the caller holds no row — as every door does. */
export type OpenMate = (
  mate: ZeropsCandidate | { readonly projectId: string },
  then?: (conversation: ScopedThreadRef) => void,
) => MateOpening<unknown>["kind"];

export function useOpenMate(): OpenMate {
  const router = useRouter();
  const { linkTarget, mateLink } = useEnvironmentLinks();
  const threads = useThreadShells();
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const creations = useCreations();
  const { listing } = useZeropsDetailCandidates();
  const mainChatOf = useHqMainChats();
  const placements = useAtomValue(hqPlacementsAtom);
  return useCallback<OpenMate>(
    (mate, then) => {
      const projectId = "key" in mate ? mate.project.id : mate.projectId;
      const candidate =
        "key" in mate
          ? mate
          : heldCandidates(listing).rows.find((row) => row.project.id === projectId);
      // What an earlier door asked of its view is this door's to replace, whatever opens.
      awaitMateConversation(projectId, undefined);
      // Who reads does not change whether it opens: no viewer is asked.
      const deletion =
        candidate === undefined
          ? mateDeletionOf({
              operation: placements?.get(projectId)?.operation,
              status: undefined,
            })
          : mateDeletionOfProject(candidate.project);
      // Made here, and not connected since.
      const coming =
        candidate === undefined
          ? undefined
          : mateArrival({
              candidate,
              nowMs: Date.now(),
              created: madeOf(creations, projectId) !== undefined,
              link: mateLink(candidate),
            }).coming;
      const environmentId = candidate === undefined ? undefined : linkTarget(candidate);
      const primary =
        environmentId === undefined
          ? undefined
          : resolvePrimaryConversation(
              threads.filter((thread) => thread.environmentId === environmentId),
            ).primary;
      const opening = mateOpening({
        going: mateGoing(deletion),
        settled: candidate !== undefined && coming === undefined,
        linked: environmentId !== undefined,
        primary:
          environmentId === undefined || primary === undefined
            ? undefined
            : scopeThreadRef(environmentId, primary.id),
        // This page keeps a Mate's conversations current only while it is open: one started
        // elsewhere since is HQ's to name (what its row shows), never a reason for a new chat.
        told: mainChatOf(projectId),
        project: projects.find((entry) => entry.environmentId === environmentId),
      });
      switch (opening.kind) {
        case "going":
          break;
        case "own-view": {
          // It waits there for its conversation, and tells `then` once it hands over.
          awaitMateConversation(projectId, then);
          const view = newMateView(projectId);
          if (router.buildLocation(view).pathname !== router.state.location.pathname)
            void router.navigate(view);
          break;
        }
        case "conversation":
          // Before the route changes, so the conversation paints with it.
          then?.(opening.conversation);
          void router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(opening.conversation),
          });
          break;
        case "new-conversation": {
          const { project } = opening;
          void handleNewThread(scopeProjectRef(project.environmentId, project.id)).then(
            (opened) => {
              // No new chat where a conversation appeared meanwhile: that one opened instead.
              const threadId =
                opened?.threadId ??
                resolvePrimaryConversation(
                  readThreadShells().filter(
                    (thread) => thread.environmentId === project.environmentId,
                  ),
                ).primary?.id;
              if (threadId !== undefined) then?.(scopeThreadRef(project.environmentId, threadId));
            },
          );
          break;
        }
      }
      return opening.kind;
    },
    [
      creations,
      handleNewThread,
      linkTarget,
      listing,
      mainChatOf,
      mateLink,
      placements,
      projects,
      router,
      threads,
    ],
  );
}
