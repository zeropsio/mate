/**
 * What the person may do on an application's Board, by the verb rules
 * (`@t3tools/shared/zeropsPermissions`) over their own live read of Zerops, HQ's tasks of the
 * application and its Mates (whose each is, and which are automated): where a Put on board may come
 * from — only a Mate whose server takes the Board — which of their own Mates a Take may open in,
 * and each task's Take (only into a Mate whose server reads the task's source), Release, Done, Stop
 * and Answer. Surfaces draw these answers and never decide one; HQ decides again at the press.
 * `undefined` until Zerops is read: nothing is offered or refused on a guess.
 *
 * @module data/projections/boardOffers
 */
import { boardTaskOf } from "@t3tools/shared/hqIntake";
import {
  answerTaskPermission,
  doneTaskPermission,
  putTaskPermission,
  releaseTaskPermission,
  stopTaskPermission,
  takeTaskPermission,
  type BoardMate,
} from "@t3tools/shared/zeropsPermissions";

import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { settingId } from "../families/hqTaskSources.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { decided, livePermissionFacts } from "./permissionFacts.ts";

/** A task's verbs, each offered or not. */
export interface BoardTaskOffer {
  readonly take: boolean;
  readonly release: boolean;
  readonly done: boolean;
  readonly stop: boolean;
  readonly answer: boolean;
}

export interface BoardOffers {
  /** The application's Mates a Put on board may come from: all of them, where the person sees it. */
  readonly putFrom: ReadonlyArray<string>;
  /** The person's own Mates in the application, never an automated one: where a Take opens. */
  readonly ownMates: ReadonlyArray<string>;
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

/** A queued task nobody put, of the oldest protocol: whether a Mate is one a Take may open in at all. */
const QUEUED = { stored: "queued", putBy: null, protocol: 1, taker: null } as const;

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
      // Its agent proposes the work and its card puts it: only a Mate whose server draws that card.
      putFrom: projectIds.filter(
        (projectId) =>
          boardProtocol(read, projectId) >= 1 &&
          putTaskPermission(facts, projectIds, projectId).allow,
      ),
      ownMates: mates
        .filter((mate) => takeTaskPermission(facts, QUEUED, [mate], mate.projectId).allow)
        .map((mate) => mate.projectId),
      tasks: !known
        ? undefined
        : Object.fromEntries(
            tasks.value.map((task) => {
              const board = boardTaskOf(task);
              return [
                task.id,
                {
                  take: takeTaskPermission(facts, board, mates).allow,
                  release: releaseTaskPermission(facts, board).allow,
                  done: doneTaskPermission(facts, board).allow,
                  stop: stopTaskPermission(facts, board).allow,
                  answer: answerTaskPermission(facts, board).allow,
                },
              ];
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
