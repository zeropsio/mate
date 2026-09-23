import {
  buildZeropsGroupTree,
  environmentRow,
  groupFlow,
  type FlowPullRequest,
  type GroupFlowInput,
  type ZeropsGroup,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProjectCard } from "./ProjectsView";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

interface Item {
  readonly project: ZeropsProject;
  readonly mate?: boolean;
}

function item(name: string, tagList: ReadonlyArray<string>, mate = true): Item {
  return { project: { id: name, name, status: "ACTIVE", tagList }, mate };
}

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
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

const WREN = item("wren-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:sm-fixture"]);
const STAGE = item(
  "fixture-stage",
  ["mate:g:aaa", "mate:role:stage", "mate:name:sm-fixture"],
  false,
);
const PROD = item("fixture-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:sm-fixture"], false);

const PRODUCTION_STOP = {
  projectId: "fixture-prod",
  name: "production",
  tier: "production" as const,
  row: undefined,
  deployment: undefined,
  route: undefined,
};
const STAGE_STOP = {
  ...PRODUCTION_STOP,
  projectId: "fixture-stage",
  name: "stage",
  tier: "stage" as const,
};

function entry(
  members: ReadonlyArray<Item>,
  over: Partial<GroupFlowInput> = {},
): ProjectsFlowGroup<Item> {
  const group = groupOf(members);
  const mates = members.filter((member) => member.mate === true);
  return {
    group,
    flow: groupFlow({
      groupId: group.groupId,
      mates: mates.map((mate) => ({
        projectId: mate.project.id,
        name: "Wren",
        preview: undefined,
        waiting: false,
        talked: true,
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
    read: true,
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

function props(over: Partial<ZeropsProjectsFlowProps<Item>> = {}): ZeropsProjectsFlowProps<Item> {
  return {
    view: "projects",
    groups: [],
    ungrouped: [],
    tools: [],
    getKey: (value) => value.project.id,
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
    ...over,
  };
}

function card(value: ProjectsFlowGroup<Item>, over: Partial<ZeropsProjectsFlowProps<Item>> = {}) {
  return renderToStaticMarkup(<ProjectCard entry={value} props={props(over)} />);
}

/** The markup from `start` up to `end`, both markers searched in order. */
function between(html: string, start: string, end: string | undefined): string {
  const from = html.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  if (end === undefined) return html.slice(from);
  const to = html.indexOf(end, from + start.length);
  return html.slice(from, to === -1 ? undefined : to);
}

const MERGING = entry([WREN, STAGE], { pullRequests: [pull()], stops: [STAGE_STOP] });
const RELEASING = entry([WREN, PROD], {
  merged: [pull({ number: 4, merged: true })],
  stops: [PRODUCTION_STOP],
  release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
});

/** A production whose last deploy failed, with merged work a release could put there. */
function brokenProduction() {
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

/** One step's cell: from its marker to the next step's. */
function step(html: string, name: string): string {
  const from = html.indexOf(`data-zerops-step-cell="${name}"`);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = html.indexOf("data-zerops-step-cell=", from + 1);
  return html.slice(from, to === -1 ? undefined : to);
}

describe("the Projects card", () => {
  it("names the next step in its header, without the verb", () => {
    const header = between(card(MERGING), "<header", "</header>");
    expect(header).toContain(">Pull request #1 waits for your merge<");
    expect(header).not.toContain("Next:");
    expect(header).not.toContain("data-test-verb");
    expect(header).toContain('data-test-menu="aaa"');
  });

  it.each([
    ["a merge", MERGING, "pull-requests", "merge"],
    ["a release", RELEASING, "production", "release"],
  ] as const)("puts %s's verb in the step it acts on, once", (_name, value, where, kind) => {
    const html = card(value);
    expect(html.split(`data-test-verb="${kind}"`)).toHaveLength(2);
    expect(step(html, where)).toContain(`data-test-verb="${kind}"`);
  });

  it("lays the four steps out as one row of labels over one row of equal cells", () => {
    const html = card(RELEASING);
    const labels = ["Mates", "Pull requests", "main", "Production"].map((label) =>
      html.indexOf(`>${label}</span>`),
    );
    const cells = ["mates", "pull-requests", "main", "production"].map((name) =>
      html.indexOf(`data-zerops-step-cell="${name}"`),
    );
    expect([...labels, ...cells].every((index) => index >= 0)).toBe(true);
    expect([...cells].sort((left, right) => left - right)).toEqual(cells);
    for (const name of ["mates", "pull-requests", "main", "production"]) {
      const open = html.slice(0, html.indexOf(`data-zerops-step-cell="${name}"`));
      const tag = open.slice(open.lastIndexOf("<"));
      // Every cell is the same surface, empty or not: the empty pull
      // requests' step is no dashed place.
      expect(tag).toContain("@2xl/flow:min-h-16");
      expect(tag).toContain("@2xl/flow:bg-muted/50");
      expect(tag).toContain("@2xl/flow:self-stretch");
    }
    expect(html).toContain("@5xl/flow:grid-rows-[auto_1fr]");
    expect(step(html, "pull-requests")).toMatch(
      /<span class="text-sm font-normal text-muted-foreground[^"]*">None open<\/span>/u,
    );
  });

  it.each([
    ["offered once the group is ready", { onCreateEnvironment: () => {} }, "enabled"],
    [
      "disabled while a creation runs",
      { onCreateEnvironment: () => {}, creating: true },
      "disabled",
    ],
    [
      "held while the group is not ready",
      { onCreateEnvironment: () => {}, addsOffered: () => false },
      "absent",
    ],
    ["absent where nothing can create", {}, "absent"],
  ] as const)("draws Add Mate as a + beside the Mates label: %s", (_name, over, expected) => {
    const html = card(RELEASING, over);
    const label = between(html, 'data-zerops-step="mates"', 'data-zerops-step-cell="mates"');
    const plus = /<button[^>]*aria-label="Add a Mate to sm-fixture"[^>]*>/u.exec(label)?.[0];
    if (expected === "absent") {
      expect(html).not.toContain("Add a Mate to");
      return;
    }
    expect(label.indexOf(">Mates</span>")).toBeLessThan(label.indexOf("Add a Mate to"));
    expect(plus).toBeDefined();
    expect(plus!.includes(` disabled=""`)).toBe(expected === "disabled");
  });

  it("keeps Add stage and Add production in the group menu: no footer links", () => {
    const html = card(RELEASING, { onCreateEnvironment: () => {} });
    expect(html).not.toContain('data-zerops-surface="add-roles"');
    expect(html).not.toContain("Add stage");
    expect(html).not.toContain("(optional)");
    expect(html).not.toContain("Add production");
  });

  it("still offers the release beside a broken production, after the fix (D28)", () => {
    const production = step(card(brokenProduction()), "production");
    const fix = production.indexOf('data-test-verb="fix-deploy"');
    expect(fix).toBeGreaterThanOrEqual(0);
    expect(production.indexOf('data-test-release-verb="true"')).toBeGreaterThan(fix);
  });
});
