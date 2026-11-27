/**
 * What the person may do on an application's Board, by the verb rules
 * (`@t3tools/shared/zeropsPermissions`) over their own live read of Zerops, HQ's tasks of the
 * application and its Mates (whose each is, and which are automated): where a Put on board may come
 * from, which of their own Mates a Take may open in, and each task's Take, Release, Done, Stop and
 * Answer. Surfaces draw these answers and never decide one; HQ decides again at the press.
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
import type { Projection } from "../store.ts";
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

/** A queued task nobody put: whether a Mate is one a Take may open in at all. */
const QUEUED = { stored: "queued", putBy: null, taker: null } as const;

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
            },
          ],
    );
    const tasks = read.fact("hqAppTasks", settingId({ orgId, appId }));
    const known = tasks.kind === "known";
    return decided(livePermissionFacts(read, orgId), projectIds, (facts) => ({
      putFrom: projectIds.filter(
        (projectId) => putTaskPermission(facts, projectIds, projectId).allow,
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
 * The application's Board revision as navigation says it (`HqNavigationApp.boardRevision`): above
 * zero once anyone wrote to one of its tasks, so its page shows the Board; `undefined` from an HQ
 * without the Board, or while unread.
 */
export const boardRevision: Projection<
  { readonly orgId: string; readonly appId: string },
  number | undefined
> = {
  name: "boardRevision",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: (read, { orgId, appId }) => {
    if (!read.members(hqAppsScope(orgId)).ids.includes(appId)) return undefined;
    const app = read.fact("hqApp", appId);
    if (app.kind !== "known") return undefined;
    return app.value.boardRevision;
  },
  equals: (a, b) => a === b,
};
