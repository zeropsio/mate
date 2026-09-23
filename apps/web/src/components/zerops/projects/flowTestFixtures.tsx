/** The groups, entries and slot defaults the projects-flow tests share. */

import {
  buildZeropsGroupTree,
  environmentRow,
  groupFlow,
  type FlowPullRequest,
  type GroupFlowInput,
  type ZeropsGroup,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";

import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

export interface Item {
  readonly project: ZeropsProject;
  readonly mate?: boolean;
}

export function item(name: string, tagList: ReadonlyArray<string>, mate = true): Item {
  return { project: { id: name, name, status: "ACTIVE", tagList }, mate };
}

export function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Greet with a fuller line",
    kind: "code",
    mateProjectId: "wren-dev",
    author: "mate-wren-dev",
    url: undefined,
    checks: "none",
    checkWord: undefined,
    mergeable: true,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

function groupOf(items: ReadonlyArray<Item>): ZeropsGroup {
  const [group] = buildZeropsGroupTree(items, { order: "name" }).groups;
  return group!.group;
}

export const WREN = item("wren-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:sm-fixture"]);
export const STAGE = item(
  "fixture-stage",
  ["mate:g:aaa", "mate:role:stage", "mate:name:sm-fixture"],
  false,
);
export const PROD = item(
  "fixture-prod",
  ["mate:g:aaa", "mate:role:prod", "mate:name:sm-fixture"],
  false,
);
export const UMA = item("uma-dev", ["mate:g:bbb", "mate:role:dev", "mate:name:hokuspokus"]);

export const PRODUCTION_STOP = {
  projectId: "fixture-prod",
  name: "production",
  tier: "production" as const,
  row: undefined,
  deployment: undefined,
  route: undefined,
};
export const STAGE_STOP = {
  ...PRODUCTION_STOP,
  projectId: "fixture-stage",
  name: "stage",
  tier: "stage" as const,
};

export function entry(
  members: ReadonlyArray<Item>,
  over: Partial<GroupFlowInput> = {},
  read = true,
): ProjectsFlowGroup<Item> {
  const group = groupOf(members);
  const mates = members.filter((member) => member.mate === true);
  return {
    group,
    flow: groupFlow({
      groupId: group.groupId,
      mates: mates.map((mate) => ({
        projectId: mate.project.id,
        name: mate.project.id === "uma-dev" ? "Uma" : "Wren",
        preview: undefined,
        waiting: false,
        talked: mate.project.id !== "uma-dev",
      })),
      pullRequests: [],
      merged: [],
      stops: [],
      missing: [],
      release: {
        gate: { allowed: false, reason: "Nothing is merged to release." },
        suggestion: "v0.1.0",
        waiting: 0,
      },
      mainHasCode: undefined,
      mainHead: undefined,
      productionAddable: false,
      ...over,
    }),
    read,
    mates,
    stops: new Map(
      members
        .filter((member) => member === STAGE || member === PROD)
        .map((member) => [
          member.project.id,
          { item: member, role: member === STAGE ? ("stage" as const) : ("prod" as const) },
        ]),
    ),
    others: [],
    lastMerged: undefined,
    line: undefined,
    placeholder: false,
  };
}

/** The markup of one element that carries `marker`, up to the next group. */
export function section(html: string, marker: string): string {
  const start = html.indexOf(marker);
  const next = html.indexOf("data-zerops-group=", start + marker.length);
  return html.slice(start, next === -1 ? undefined : next);
}

export const MERGING = entry([WREN, STAGE], { pullRequests: [pull()], stops: [STAGE_STOP] });
export const RELEASING = entry([WREN, PROD], {
  merged: [pull({ number: 4, merged: true })],
  stops: [PRODUCTION_STOP],
  release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
});
export const FRESH = entry([UMA]);

/** A production whose last deploy failed, with merged work a release could put there. */
export function brokenProduction() {
  const FAILED_PROD_SHA = "055a7e8f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
  return entry([WREN, PROD], {
    merged: [pull({ number: 4, merged: true })],
    stops: [
      {
        ...PRODUCTION_STOP,
        row: environmentRow({
          projectId: "fixture-prod",
          name: "production",
          tier: "production",
          sources: "release",
          environment: "production",
          services: [
            {
              hostname: "app",
              appVersionName: FAILED_PROD_SHA,
              statuses: [{ context: "mate/deploy/production/app", state: "failure" }],
            },
          ],
        }),
        deployment: {
          state: "known",
          value: {
            kind: "running",
            activatedAt: null,
            version: {
              name: undefined,
              commit: "055a7e8",
              sha: FAILED_PROD_SHA,
              taggedBy: undefined,
              label: "055a7e8",
            },
          },
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "live" },
        },
      },
    ],
    release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
  });
}

/** Every slot, drawn as a marker the tests look for. */
export const FLOW_PROPS: ZeropsProjectsFlowProps<Item> = {
  getKey: (value) => value.project.id,
  groups: [],
  isMate: (value) => value.mate === true,
  onRetryContainers: () => {},
  renderEnvironment: (value) => <li data-test-environment={value.project.id} />,
  renderGroupMenu: (group) => <span data-test-menu={group.groupId} />,
  renderGroupRows: () => null,
  renderMate: (value) => <div data-test-mate={value.project.id} />,
  renderMateFace: (value) => <span data-test-face={value.project.id} />,
  renderNextStep: (value) =>
    value.flow.nextStep.verb === undefined ? null : (
      <button data-test-verb={value.flow.nextStep.kind} type="button">
        {value.flow.nextStep.verb}
      </button>
    ),
  renderReleaseVerb: () => <button data-test-release-verb="true" type="button" />,
  renderPullRequest: (_group, value, options) => (
    <li
      data-test-compact={String(options.compact)}
      data-test-pull={value.number}
      data-test-with-merge={String(options.withMerge)}
    />
  ),
  renderStopMenu: (value) => <span data-test-stop-menu={value.project.id} />,
  renderTool: (value) => <span data-test-tool={value.project.id} />,
  tools: [],
  ungrouped: [],
  view: "overview",
};
