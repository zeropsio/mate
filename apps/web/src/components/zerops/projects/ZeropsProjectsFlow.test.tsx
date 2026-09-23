import {
  buildZeropsGroupTree,
  groupFlow,
  type FlowPullRequest,
  type GroupFlowInput,
  type ZeropsGroup,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import {
  ZeropsProjectsFlow,
  type ProjectsFlowGroup,
  type ZeropsProjectsFlowProps,
} from "./ZeropsProjectsFlow";

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
const UMA = item("uma-dev", ["mate:g:bbb", "mate:role:dev", "mate:name:hokuspokus"]);

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

function render(props: Partial<ZeropsProjectsFlowProps<Item>> = {}) {
  return renderToStaticMarkup(
    <ZeropsProjectsFlow<Item>
      getKey={(value) => value.project.id}
      groups={[]}
      isMate={(value) => value.mate === true}
      onRetryContainers={() => {}}
      renderEnvironment={(value) => <li data-test-environment={value.project.id} />}
      renderGroupMenu={(group) => <span data-test-menu={group.groupId} />}
      renderGroupRows={() => null}
      renderMate={(value) => <div data-test-mate={value.project.id} />}
      renderMateFace={(value) => <span data-test-face={value.project.id} />}
      renderNextStep={(value) =>
        value.flow.nextStep.verb === undefined ? null : (
          <button data-test-verb={value.flow.nextStep.kind} type="button">
            {value.flow.nextStep.verb}
          </button>
        )
      }
      renderPullRequest={(_group, value, options) => (
        <li
          data-test-compact={String(options.compact)}
          data-test-pull={value.number}
          data-test-with-merge={String(options.withMerge)}
        />
      )}
      renderStopMenu={(value) => <span data-test-stop-menu={value.project.id} />}
      renderTool={(value) => <span data-test-tool={value.project.id} />}
      tools={[]}
      ungrouped={[]}
      view="overview"
      {...props}
    />,
  );
}

/** The markup of one element that carries `marker`, up to the next group. */
function section(html: string, marker: string): string {
  const start = html.indexOf(marker);
  const next = html.indexOf("data-zerops-group=", start + marker.length);
  return html.slice(start, next === -1 ? undefined : next);
}

const MERGING = entry([WREN, STAGE], { pullRequests: [pull()], stops: [STAGE_STOP] });
const RELEASING = entry([WREN, PROD], {
  merged: [pull({ number: 4, merged: true })],
  stops: [PRODUCTION_STOP],
  release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
});
const FRESH = entry([UMA]);

describe("the Overview", () => {
  it("opens with the next steps across groups, each with its verb", () => {
    const html = render({ groups: [MERGING, FRESH] });
    const strip = html.slice(html.indexOf('data-zerops-surface="next-steps"'));
    expect(strip).toContain("Next steps");
    expect(strip).toContain("sm-fixture · Pull request #1 waits for your merge");
    expect(strip).toContain('data-test-verb="merge"');
    // A first task is not a step waiting on anybody: its group is a tile.
    expect(strip.slice(0, strip.indexOf('data-zerops-surface="flow-rows"'))).not.toContain(
      "first task",
    );
  });

  it("draws no strip when nothing waits", () => {
    expect(render({ groups: [FRESH] })).not.toContain('data-zerops-surface="next-steps"');
  });

  it("draws one row per group with work on it, its steps in the flow's order", () => {
    const html = render({ groups: [MERGING] });
    const row = section(html, 'data-zerops-group="aaa"');
    const order = ["mates", "pull-requests", "main", "production"].map((step) =>
      row.indexOf(`data-zerops-step="${step}"`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("puts the verb in the cell it belongs to", () => {
    const merge = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    const pulls = merge.slice(
      merge.indexOf('data-zerops-step="pull-requests"'),
      merge.indexOf('data-zerops-step="main"'),
    );
    expect(pulls).toContain('data-test-verb="merge"');

    const release = section(render({ groups: [RELEASING] }), 'data-zerops-group="aaa"');
    expect(release.slice(release.indexOf('data-zerops-step="production"'))).toContain(
      'data-test-verb="release"',
    );
  });

  it("draws a group stage under main only where one exists — never an empty slot", () => {
    const withStage = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    expect(withStage).toContain('data-zerops-surface="flow-stage"');
    expect(withStage).toContain("↳ stage · follows main");
    const without = section(render({ groups: [RELEASING] }), 'data-zerops-group="aaa"');
    expect(without).not.toContain('data-zerops-surface="flow-stage"');
    expect(without).not.toContain("↳");
  });

  it("reads production as coming after the first merge, with nothing to press", () => {
    const html = render({ groups: [entry([WREN], { mainHasCode: false })] });
    const production = html.slice(html.indexOf('data-zerops-step="production"'));
    expect(production).toContain("After the first merge");
    expect(production).not.toContain("data-test-verb");
  });

  it("offers Add production only where it is the next step, and says whose it is", () => {
    const adding = entry([WREN], {
      mainHasCode: true,
      productionAddable: true,
      missing: [{ tier: "production" }],
    });
    const html = render({ groups: [adding] });
    const production = html.slice(html.indexOf('data-zerops-step="production"'));
    expect(production).toContain('data-test-verb="add-production"');
    expect(production).toContain("Production is added here, not by the Mate.");
  });

  it("says nothing where nothing needs anybody: no all-clear banner, no rows asking for a tier", () => {
    const quiet = entry([WREN], { merged: [pull({ merged: true })] });
    const html = render({ groups: [quiet], onCreateEnvironment: () => {} });
    expect(html).not.toContain("Nothing needs you here.");
    expect(html).not.toContain("not set up yet");
    expect(html).not.toContain("project-attention");
    // The add verbs live in the menu, not repeated under every row.
    expect(html).not.toContain('data-zerops-surface="add-roles"');
  });

  it("folds a group with only a Mate nobody has spoken to into a tile", () => {
    const html = render({ groups: [MERGING, FRESH] });
    const tiles = html.slice(html.indexOf('data-zerops-surface="only-a-mate"'));
    expect(tiles).toContain("Only a Mate so far");
    expect(tiles).toContain('data-zerops-group="bbb"');
    expect(tiles).toContain("Uma · no task yet");
    expect(tiles).toContain('data-test-verb="first-task"');
    expect(html.slice(0, html.indexOf('data-zerops-surface="only-a-mate"'))).not.toContain(
      'data-zerops-group="bbb"',
    );
  });

  it("keeps a group whose flow is unread as a row: unread is not empty", () => {
    const html = render({ groups: [entry([UMA], {}, false)] });
    expect(html).not.toContain('data-zerops-surface="only-a-mate"');
    expect(html).toContain('data-zerops-surface="flow-rows"');
  });
});

describe("the containers no project holds", () => {
  const rows = (kinds: ReadonlyArray<ZeropsRowAction["kind"]>) =>
    kinds.map((action, index) => ({ item: item(`loose-${String(index)}`, []), action }));

  it("fold into one line with their states and a re-probe for the ones not answering", () => {
    const html = render({
      groups: [MERGING],
      ungrouped: rows(["open", "retry-probe", "start", "retry-probe"]),
    });
    const line = html.slice(html.indexOf('data-zerops-surface="other-containers"'));
    expect(line).toContain("Other containers");
    expect(line).toContain("Not in a project · 1 ready · 2 not answering · 1 stopped");
    expect(line).toContain("Try again (2)");
    // Folded: the rows themselves wait behind the line.
    expect(line).not.toContain("data-test-mate=");
  });

  it("offers no re-probe when every container answers", () => {
    expect(render({ ungrouped: rows(["open"]) })).not.toContain("Try again");
  });

  it("keeps a project with no Mate container for the quiet line at the end", () => {
    const html = render({
      ungrouped: [{ item: item("zerops-ads", [], false), action: "set-up-mate" }],
    });
    expect(html).not.toContain('data-zerops-surface="other-containers"');
    const end = html.slice(html.indexOf('data-zerops-surface="quiet-end"'));
    expect(end).toContain('data-test-environment="zerops-ads"');
  });
});

describe("the tools", () => {
  const GITEA = item("mate-gitea", ["mate:tool:gitea"], false);

  it("are one quiet line at the end, after the containers", () => {
    const html = render({
      groups: [MERGING],
      tools: [{ item: GITEA, kind: "gitea" }],
      ungrouped: [{ item: item("loose", []), action: "open" }],
    });
    expect(html).toContain('data-test-tool="mate-gitea"');
    expect(html.indexOf('data-zerops-surface="other-containers"')).toBeLessThan(
      html.indexOf('data-zerops-tools="true"'),
    );
  });

  it("offer Gitea only to an account that has started and has none", () => {
    expect(render({ groups: [MERGING], onCreateTool: () => {} })).toContain("Add Gitea");
    expect(
      render({
        groups: [MERGING],
        onCreateTool: () => {},
        tools: [{ item: GITEA, kind: "gitea" }],
      }),
    ).not.toContain("Add Gitea");
    expect(render({ onCreateProject: () => {}, onCreateTool: () => {} })).not.toContain(
      "Add Gitea",
    );
  });
});

describe("first run", () => {
  it("says what a Mate is, and offers one, to an account with no project", () => {
    const html = render({ onCreateProject: () => {} });
    expect(html).toContain('data-zerops-surface="first-run"');
    expect(html).toContain("Start a project");
    expect(html).toContain('data-mate-face-size="lg"');
    expect(html).toContain('data-zerops-primitive="pill"');
  });

  it("drops the invitation once the account has a project", () => {
    expect(render({ groups: [MERGING], onCreateProject: () => {} })).not.toContain(
      'data-zerops-surface="first-run"',
    );
  });

  it("gives nothing to a view with no way to create", () => {
    expect(render()).not.toContain('data-zerops-surface="first-run"');
  });
});

describe("the Projects view", () => {
  it("draws every group with work on it as a card, next step first, its four steps side by side", () => {
    const html = render({ view: "projects", groups: [MERGING] });
    const card = section(html, 'data-zerops-group="aaa"');
    expect(card).toContain('id="project-aaa"');
    expect(card).toContain("Next: Pull request #1 waits for your merge");
    expect(card.indexOf("Next: ")).toBeLessThan(card.indexOf('data-zerops-step="mates"'));
    expect(card).toContain('data-test-mate="wren-dev"');
    expect(card).toContain(">Pull requests<");
    expect(card).toContain(">main<");
    expect(card).toContain(">Production<");
  });

  it("merges once: the step's verb, not a second Merge on the row it names", () => {
    const card = section(
      render({ view: "projects", groups: [MERGING] }),
      'data-zerops-group="aaa"',
    );
    expect(card).toContain(
      'data-test-compact="true" data-test-pull="1" data-test-with-merge="false"',
    );
  });

  it("gives the stage its own menu and production its own", () => {
    const both = entry([WREN, STAGE, PROD], { stops: [STAGE_STOP, PRODUCTION_STOP] });
    const card = render({ view: "projects", groups: [both] });
    expect(card).toContain('data-test-stop-menu="fixture-stage"');
    expect(card).toContain('data-test-stop-menu="fixture-prod"');
  });

  it("offers Add Mate, and Add stage only while there is none, once the group is ready for more", () => {
    const withoutStage = render({
      view: "projects",
      groups: [RELEASING],
      onCreateEnvironment: () => {},
    });
    expect(withoutStage).toContain("Add Mate");
    expect(withoutStage).toContain("Add stage");
    expect(withoutStage).toContain("(optional)");
    const withStage = render({
      view: "projects",
      groups: [MERGING],
      onCreateEnvironment: () => {},
    });
    expect(withStage).toContain("Add Mate");
    expect(withStage).not.toContain("Add stage");
    const held = render({
      view: "projects",
      groups: [RELEASING],
      onCreateEnvironment: () => {},
      addsOffered: () => false,
    });
    expect(held).not.toContain('data-zerops-surface="add-roles"');
    // Production is never a foot verb: it is added where the flow asks for it.
    expect(withoutStage).not.toContain("Add production");
  });

  it("disables the add verbs while a creation runs, rather than hiding them", () => {
    const html = render({
      view: "projects",
      groups: [RELEASING],
      onCreateEnvironment: () => {},
      creating: true,
    });
    const adds = html.slice(html.indexOf('data-zerops-surface="add-roles"'));
    expect(adds.match(/<button[^>]*disabled/gu)).toHaveLength(2);
  });

  it("lists the group's own rows under its steps only where it has some", () => {
    expect(render({ view: "projects", groups: [RELEASING] })).not.toContain(
      'data-zerops-surface="environment-rows"',
    );
    const html = render({
      view: "projects",
      groups: [RELEASING],
      renderGroupRows: () => <li data-test-release="v0.0.9" />,
    });
    expect(html).toContain('data-test-release="v0.0.9"');
  });
});
