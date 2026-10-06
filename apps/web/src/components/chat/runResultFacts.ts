/**
 * The facts a run's result follows from outside the run: where its Mate's
 * change stands on the forge, what the platform says of its Mate's services,
 * and where its crew's tasks are — read from the thread's environment: its
 * Zerops project, the group that project belongs to.
 *
 * Every fact is undefined while unread, so a row stays as the run left it
 * until its fact is known. Until the forge answers, no change is known.
 */
import {
  changeAsksForReview,
  readZeropsMembership,
  type FlowPullRequest,
  type ZeropsProject,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import { useContext, useMemo } from "react";

import { useCrew } from "../../zerops/crew/useCrew";
import { InventoryContext } from "../../zerops/inventoryContext";
import { useProjectServices } from "../../zerops/ZeropsAccountData";
import { useAppsChanges } from "../../zerops/projectFlows";
import { useRegistrationRecord } from "../../zerops/registrationRecords";
import type { OutcomeModel } from "./conversation.logic";
import { runEffortWords, type ResultChange, type ResultFacts } from "./runResult.logic";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";

function resultChange(
  pull: Pick<FlowPullRequest, "repository" | "number" | "title" | "ready">,
): ResultChange {
  return {
    repository: pull.repository,
    number: pull.number,
    title: pull.title,
    ready: changeAsksForReview(pull),
  };
}

export function readRunResultFacts(input: {
  /** The Zerops project of the thread's environment: the Mate's. */
  readonly projectId: string | undefined;
  readonly inventory: { readonly projects: ReadonlyArray<ZeropsProject> } | null;
  /** The Mate project's services; `undefined` while they are not read. */
  readonly services: ReadonlyArray<ZeropsService> | undefined;
  readonly flows:
    | ReadonlyMap<
        string,
        {
          readonly pullRequests: ReadonlyArray<FlowPullRequest>;
          readonly merged: ReadonlyArray<FlowPullRequest>;
          readonly changesKnown: boolean;
        }
      >
    | undefined;
  readonly crew: {
    readonly environmentId: EnvironmentId;
    readonly tasks: ReadonlyArray<{
      readonly id: string;
      readonly number: number;
      readonly state: string;
      readonly owner: string;
    }>;
  } | null;
}): ResultFacts {
  const { projectId, inventory, flows } = input;
  if (projectId === undefined) return {};
  const project = inventory?.projects.find((entry) => entry.id === projectId);
  const groupId = project === undefined ? undefined : readZeropsMembership(project).groupId;
  const flow = groupId === undefined ? undefined : flows?.get(groupId);
  const changes =
    groupId === undefined || flows === undefined
      ? undefined
      : flow?.changesKnown === true
        ? {
            groupId,
            open: flow.pullRequests.map(resultChange),
            merged: flow.merged.map(resultChange),
            known: true,
          }
        : {
            groupId,
            open: [],
            merged: [],
            known: false,
          };
  return {
    mate: { projectId, groupId },
    ...(changes === undefined ? {} : { changes }),
    ...(input.services !== undefined
      ? {
          services: new Map(
            input.services.map((service: ZeropsService) => [
              service.name,
              {
                status: service.status,
                since: service.lastUpdate ?? null,
                versionAt: service.activeAppVersion?.created ?? null,
              },
            ]),
          ),
        }
      : {}),
    ...(input.crew === null
      ? {}
      : {
          crew: {
            environmentId: input.crew.environmentId,
            tasks: new Map(
              input.crew.tasks.map((task) => [
                task.number,
                { id: task.id, state: task.state, owner: task.owner },
              ]),
            ),
          },
        }),
  };
}

/**
 * The facts a run's result follows now, for the conversation it stands in.
 * Outside a conversation (a harness, a test) and outside a Zerops project it
 * knows nothing, and the rows stand as the run left them.
 */
const NO_APPS: ReadonlyArray<string> = [];

export function useRunResultFacts(outcome: OutcomeModel | null | undefined): ResultFacts {
  // The row context is absent where a result is drawn on its own.
  const row = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const environmentId = row?.threadRef?.environmentId ?? null;
  const projectId = useRegistrationRecord(environmentId)?.projectRef?.projectId;
  const inventory = useContext(InventoryContext);
  const services = useProjectServices(projectId).services;
  // The Mate's application's changes, held while its result is drawn.
  const project = inventory?.projects.find((entry) => entry.id === projectId);
  const groupId = project === undefined ? undefined : readZeropsMembership(project).groupId;
  const appIds = useMemo(() => (groupId === undefined ? NO_APPS : [groupId]), [groupId]);
  const { changes } = useAppsChanges(appIds);
  const flows = useMemo(
    () =>
      inventory === null
        ? undefined
        : new Map(
            [...changes].map(([appId, app]) => [appId, { ...app, changesKnown: true }] as const),
          ),
    [changes, inventory],
  );
  // The crew's feed only for a run that worked a crew task.
  const crew = useCrew((outcome?.crewTask ?? null) === null ? null : environmentId);
  const tasks = crew.snapshot?.board.tasks;
  return useMemo(
    () =>
      readRunResultFacts({
        projectId,
        inventory,
        services,
        flows,
        crew: environmentId === null || tasks === undefined ? null : { environmentId, tasks },
      }),
    [environmentId, flows, inventory, projectId, services, tasks],
  );
}

/**
 * The run's effort for its worked line, following the forge: "merged as #2 ·
 * 2 commands · 1 file read" once the person merged the change the run
 * pushed (`runEffortWords` with the facts its result follows).
 */
export function useRunEffortWords(outcome: OutcomeModel | null | undefined): string | null {
  return runEffortWords(outcome, useRunResultFacts(outcome));
}
