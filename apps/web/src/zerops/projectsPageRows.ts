/** Projects presentation joins each row's keyed owner evidence, independently of its neighbors. */
import { useAtomValue } from "@effect/atom-react";
import { accountReadsAtom, hqProjectPerson, projectSummary } from "@t3tools/client-runtime/data";
import { groupFlow, hasMate, type ZeropsGroupTreeGroup } from "@t3tools/client-runtime/zerops";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";
import { sameValue } from "~/lib/sameValue";
import { environmentsWithSnapshotAtom } from "~/state/shell";
import type { ProjectsFlowGroup } from "~/components/zerops/projects/ZeropsProjectsFlow";
import { groupNameUnread } from "~/components/zerops/ZeropsGroupTree.logic";
import {
  changesUnknownOf,
  flowStepsAwaiting,
  groupFlowInputOf,
  groupMemberFactsOf,
  lastMergedCode,
  rowMateActivitiesOf,
} from "~/components/zerops/projects/projectsView.logic";
import { mateActivityAtom } from "./mateActivityAtoms";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import type { ProjectFlows, useStopDeploymentsShown } from "./projectFlows";

type Row = ProjectsFlowGroup<ZeropsCandidatePresentation>;
interface ProjectsRowsInput {
  readonly groups: ReadonlyArray<ZeropsGroupTreeGroup<ZeropsCandidatePresentation>>;
  readonly flows: ProjectFlows;
  readonly deployments: ReturnType<typeof useStopDeploymentsShown>;
  readonly lines: ReadonlyMap<string, string | undefined>;
}

export function projectsRowsAtom(input: ProjectsRowsInput) {
  const rows = input.groups.map(({ group, environments }) =>
    Atom.make((get): Row => {
      const account = get(accountReadsAtom);
      const activities = new Map(
        environments.flatMap(({ item }) => {
          const activity = get(mateActivityAtom(item.project.id));
          return activity === undefined ? [] : [[item.project.id, activity] as const];
        }),
      );
      const activityOf = (item: ZeropsCandidatePresentation) => activities.get(item.project.id);
      const conversations = get(environmentsWithSnapshotAtom);
      const members = groupMemberFactsOf(
        environments,
        activityOf,
        (item) => item.environmentId !== undefined && conversations.has(item.environmentId),
        (projectId) =>
          account?.orgId != null &&
          get(account.data.project(hqProjectPerson, { orgId: account.orgId, projectId }))
            ?.waitsOnViewer === true,
      );
      const app =
        account?.orgId == null
          ? undefined
          : get(
              account.data.project(projectSummary, { orgId: account.orgId, appId: group.groupId }),
            );
      const reads = input.flows.flows.get(group.groupId);
      const changesUnknown = changesUnknownOf({
        offers: app === undefined ? undefined : { readRefused: app.changesRefused },
        changesFailure: reads?.changesFailure,
      });
      const awaiting = flowStepsAwaiting({
        read: reads !== undefined,
        changesKnown: reads?.changesKnown === true,
        changesUnknown,
        readOut: input.flows.hqAddress !== undefined,
      });
      const isStop = (role: string | undefined) => role === "stage" || role === "prod";
      return {
        group,
        contents: app?.contents,
        flow: groupFlow(
          groupFlowInputOf({
            groupId: group.groupId,
            members,
            flow: reads,
            deployments: input.deployments,
            pending: group.pending,
          }),
        ),
        activities: rowMateActivitiesOf(
          environments.flatMap(({ item }, index) => {
            const name = members[index]?.mate?.name;
            return name === undefined ? [] : [{ item, name }];
          }),
          activityOf,
        ),
        awaiting: awaiting.steps,
        changesAwaiting: awaiting.changes,
        changesUnknown,
        mates: new Map(
          environments
            .filter(({ item }) => hasMate(item))
            .map(({ item }) => [item.project.id, item]),
        ),
        stops: new Map(
          environments
            .filter(({ role }) => isStop(role))
            .map((entry) => [entry.item.project.id, entry]),
        ),
        others: environments.filter(({ item, role }) => !hasMate(item) && !isStop(role)),
        // Navigation owns no last-merged summary. Already-held detail may enrich this fallback.
        lastMerged: reads === undefined ? undefined : lastMergedCode(reads.merged),
        line: input.lines.get(group.groupId),
        placeholder: groupNameUnread(group),
      };
    }).pipe(
      Atom.withEquality<Row>((a, b) =>
        sameValue(
          { ...a, mates: [...a.mates], stops: [...a.stops] },
          { ...b, mates: [...b.mates], stops: [...b.stops] },
        ),
      ),
    ),
  );
  return Atom.make((get) => rows.map((row) => get(row)));
}

export function useProjectsPageRows(input: ProjectsRowsInput): ReadonlyArray<Row> {
  const { groups, flows, deployments, lines } = input;
  const atom = useMemo(
    () => projectsRowsAtom({ groups, flows, deployments, lines }),
    [groups, flows, deployments, lines],
  );
  return useAtomValue(atom);
}
