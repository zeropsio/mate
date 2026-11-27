/**
 * What the person may do on an application's Board, by the verb rules
 * (`@t3tools/shared/zeropsPermissions`) over their own live read of Zerops, HQ's tasks of the
 * application and its Mates (whose each is, and which are automated): whether a New task may be
 * put on the Board itself, where a Put on board may come from — only a Mate whose server takes the
 * Board — and each task's Take (which of their own Mates it may open in: only one whose server
 * reads the task's source), Release, Done, Stop, Answer and Drop the need. Surfaces draw these answers and never
 * decide one; HQ decides again at the press.
 * `undefined` until Zerops is read: nothing is offered or refused on a guess.
 *
 * @module data/projections/boardOffers
 */
import { boardTaskOf } from "@t3tools/shared/hqIntake";
import {
  answerTaskPermission,
  doneTaskPermission,
  dropNeedPermission,
  putTaskPermission,
  releaseTaskPermission,
  stopTaskPermission,
  takeTaskPermission,
  type BoardMate,
  type BoardTask,
  type PermissionFacts,
} from "@t3tools/shared/zeropsPermissions";

import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { settingId } from "../families/hqTaskSources.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { decided, livePermissionFacts } from "./permissionFacts.ts";

/** A task's verbs, each offered or not. */
export interface BoardTaskOffer {
  /**
   * The person's own Mates in the application its Take may open in: never an automated one, only
   * one whose server reads the task's source (`mateBoardProtocolOf`); empty, no Take.
   */
  readonly takeInto: ReadonlyArray<string>;
  readonly release: boolean;
  readonly done: boolean;
  readonly stop: boolean;
  readonly answer: boolean;
  /** Drop one of its needs: it is held, and the reader put it or is an owner or admin. */
  readonly dropNeed: boolean;
}

/** One task's verbs for the person, by the verb rules over its record and the application's Mates. */
export function boardTaskOffer(
  facts: PermissionFacts,
  task: BoardTask,
  mates: ReadonlyArray<BoardMate>,
): BoardTaskOffer {
  return {
    takeInto: mates
      .filter((mate) => takeTaskPermission(facts, task, [mate], mate.projectId).allow)
      .map((mate) => mate.projectId),
    release: releaseTaskPermission(facts, task).allow,
    done: doneTaskPermission(facts, task).allow,
    stop: stopTaskPermission(facts, task).allow,
    answer: answerTaskPermission(facts, task).allow,
    dropNeed: dropNeedPermission(facts, task).allow,
  };
}

export interface BoardOffers {
  /** Whether a New task may be put on the Board directly: wherever the person sees the application. */
  readonly put: boolean;
  /** The application's Mates a Put on board may come from: all of them, where the person sees it. */
  readonly putFrom: ReadonlyArray<string>;
  /** Each task HQ answered, by its id; `undefined` while the Board is not read. */
  readonly tasks: Readonly<Record<string, BoardTaskOffer>> | undefined;
}

/**
 * The Board protocol a Mate's server reads (`identity.board.protocol` its overview advertises, as
 * HQ relays it): from 1 it draws a board ask's card and keeps a taken task's conversation, from 2
 * also one of a task put on the Board directly. Not known yet, none (0).
 */
function boardProtocol(read: ProjectionReads, projectId: string): number {
  const mate = read.fact("hqMate", projectId);
  if (mate.kind !== "known") return 0;
  return mate.value.overview?.identity?.board?.protocol ?? 0;
}

export const boardOffers: Projection<
  { readonly orgId: string; readonly appId: string },
  BoardOffers | undefined
> = {
  name: "boardOffers",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: (read, { orgId, appId }) => {
    const app = read.fact("hqApp", appId);
    if (app.kind !== "known" || !read.members(hqAppsScope(orgId)).ids.includes(appId))
      return undefined;
    const placed = read.members(placementsScope(orgId)).ids.flatMap((projectId) => {
      const placement = read.fact("placement", projectId);
      return placement.kind === "known" && placement.value.appId === appId
        ? [{ projectId, placement: placement.value }]
        : [];
    });
    const projectIds = app.value.projectIds ?? placed.map((row) => row.projectId);
    const mates: ReadonlyArray<BoardMate> = placed.flatMap(({ projectId, placement }) =>
      placement.mate == null
        ? []
        : [
            {
              projectId,
              ownerUserId: placement.person?.ownerUserId ?? undefined,
              automated: placement.mate.automated === true,
              boardProtocol: boardProtocol(read, projectId),
            },
          ],
    );
    const tasks = read.fact("hqAppTasks", settingId({ orgId, appId }));
    const known = tasks.kind === "known";
    return decided(livePermissionFacts(read, orgId), projectIds, (facts) => ({
      put: putTaskPermission(facts, projectIds).allow,
      // Its agent proposes the work and its card puts it: only a Mate whose server draws that card.
      putFrom: projectIds.filter(
        (projectId) =>
          boardProtocol(read, projectId) >= 1 &&
          putTaskPermission(facts, projectIds, projectId).allow,
      ),
      tasks: !known
        ? undefined
        : Object.fromEntries(
            tasks.value.map((task) => {
              return [task.id, boardTaskOffer(facts, boardTaskOf(task), mates)];
            }),
          ),
    }));
  },
  equals: sameValue,
};

/**
 * The chat a task was put from, by its id, as the application's Board was last read: where its
 * putter answers its question (their own card there). `null` where the Board was not read, or the
 * task came from elsewhere.
 */
export function putChatOf(
  read: ProjectionReads,
  key: { readonly orgId: string; readonly appId: string },
  taskId: string,
): { readonly mateProjectId: string; readonly conversationId: string } | null {
  const tasks = read.fact("hqAppTasks", settingId(key));
  if (tasks.kind !== "known") return null;
  const source = tasks.value.find((task) => task.id === taskId)?.source;
  return source?.kind === "conversation"
    ? { mateProjectId: source.mateProjectId, conversationId: source.conversationId }
    : null;
}
