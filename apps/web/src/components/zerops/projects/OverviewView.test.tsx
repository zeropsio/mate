import { PRODUCTION_ADDED_HERE } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  born,
  brokenProduction,
  entry,
  FLOW_PROPS,
  FRESH,
  item,
  MERGING,
  mount,
  PROD,
  PRODUCTION_STOP,
  pull,
  RELEASING,
  renderFlow as render,
  section,
  STAGE,
  STAGE_STOP,
  UMA,
  VERA_COMING,
  WREN,
  type Item,
} from "./flowTestFixtures";
import { ENVIRONMENT_ROW_GRID_CLASS } from "../ZeropsEnvironmentRow";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";

describe("the Overview", () => {
  it("lists the next steps across groups, and a step's words jump to its row", () => {
    const html = render({ groups: [MERGING, FRESH] });
    const strip = html.slice(
      html.indexOf('data-zerops-surface="next-steps"'),
      html.indexOf('data-zerops-surface="flow-rows"'),
    );
    expect(strip).toContain("Next steps");
    expect(strip).toContain(">sm-fixture<");
    expect(strip).toContain(">Pull request #1 waits for your merge<");
    expect(strip).toContain('data-test-verb="merge"');
    // A first task is not a step waiting on anybody: its group is a tile.
    expect(strip).not.toContain("first task");

    const verb = { focus: vi.fn() };
    const row = {
      scrollIntoView: vi.fn(),
      querySelector: vi.fn((selector: string) =>
        selector.startsWith("[data-zerops-next-step-slot]") ? verb : null,
      ),
    };
    const getElementById = vi.fn(() => row);
    vi.stubGlobal("document", { getElementById });
    const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[MERGING]} />);
    const step = tree.root.findByProps({ "data-zerops-next-step": "merge" });
    act(() => step.props.onClick());
    expect(getElementById).toHaveBeenCalledWith("flow-row-aaa");
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(verb.focus).toHaveBeenCalledTimes(1);
    // The row it lands on holds the verb in its next-step slot.
    expect(section(html, 'id="flow-row-aaa"')).toMatch(
      /data-zerops-next-step-slot="true"><button data-test-verb="merge"/u,
    );
    vi.unstubAllGlobals();
  });

  it.each([
    ["Merge", MERGING],
    ["Release v0.1.0", RELEASING],
    [
      "+ Add production",
      entry([WREN], {
        mainHasCode: true,
        productionAddable: true,
        missing: [{ tier: "production" }],
      }),
    ],
  ])("carries the step's verb %s on each strip item, the row's own verb", (_verb, group) => {
    const act_ = vi.fn();
    const renderNextStep = (value: typeof group, placement: "cell" | "strip") => (
      <button
        data-test-placement={placement}
        data-test-verb={value.flow.nextStep.kind}
        onClick={() => act_(value.group.groupId, value.flow.nextStep.kind)}
        type="button"
      >
        {value.flow.nextStep.verb}
      </button>
    );
    const tree = mount(
      <ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[group]} renderNextStep={renderNextStep} />,
    );
    const strip = tree.root.findByProps({ "data-zerops-surface": "next-steps" });
    const [inStrip] = strip.findAll((node) => node.props["data-test-verb"] !== undefined);
    const [inRow] = tree.root
      .findByProps({ "data-zerops-surface": "flow-rows" })
      .findAll((node) => node.props["data-test-verb"] !== undefined);
    expect(inStrip?.props["data-test-placement"]).toBe("strip");
    expect(inRow?.props["data-test-placement"]).toBe("cell");
    act(() => inStrip?.props.onClick());
    act(() => inRow?.props.onClick());
    const step = group.flow.nextStep.kind;
    expect(act_.mock.calls).toEqual([
      [group.group.groupId, step],
      [group.group.groupId, step],
    ]);
    // The verb sits at the item's end, after the words that jump to the row.
    const item = strip.find((node) => node.type === "li");
    expect(item.children.at(-1)).toMatchObject({ props: { className: "flex shrink-0" } });
  });

  it("leaves a step with no verb to press out of the strip", () => {
    const html = render({
      groups: [MERGING, RELEASING],
      renderNextStep: (value, placement) =>
        placement === "strip" && value.flow.nextStep.kind === "release" ? null : (
          <button data-test-verb={value.flow.nextStep.kind} type="button" />
        ),
    });
    const strip = section(html, 'data-zerops-surface="next-steps"');
    expect(strip).toContain('data-zerops-next-step="merge"');
    expect(strip).not.toContain('data-zerops-next-step="release"');
    expect(strip).toMatch(/Next steps <span[^>]*>1<\/span>/u);
    expect(render({ groups: [MERGING], renderNextStep: () => null })).not.toContain(
      'data-zerops-surface="next-steps"',
    );
  });

  it.each([
    ["merging, with a stage", MERGING],
    ["releasing", RELEASING],
    ["a broken production", brokenProduction()],
    [
      "adding production",
      entry([WREN], {
        mainHasCode: true,
        productionAddable: true,
        missing: [{ tier: "production" }],
      }),
    ],
    [
      "work merged and not live, several pull requests",
      entry([WREN], {
        pullRequests: [pull(), pull({ number: 2 }), pull({ number: 3 })],
        merged: [pull({ number: 4, merged: true })],
        stops: [PRODUCTION_STOP],
        release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 2 },
      }),
    ],
  ])("never holds more than two lines in a cell: %s", (_name, group) => {
    const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[group]} />);
    const cells = tree.root.findAll((node) => node.props["data-zerops-cell-lines"] === "true");
    // The project and its four steps.
    expect(cells).toHaveLength(5);
    for (const cell of cells) expect(cell.children.length).toBeLessThanOrEqual(2);
  });

  it("draws no strip when nothing waits", () => {
    expect(render({ groups: [FRESH] })).not.toContain('data-zerops-surface="next-steps"');
  });

  it("holds the strip's place while a group's read is out, so the rows do not drop under it", () => {
    const strip = section(
      render({ groups: [entry([UMA], {}, false)] }),
      'data-zerops-surface="next-steps"',
    );
    expect(strip).toContain('aria-busy="true"');
    expect(strip).toContain(">Next steps<");
    expect(strip).toContain('data-slot="skeleton"');
    const nobody = render({ groups: [{ ...entry([UMA], {}, false), awaiting: false }] });
    expect(nobody).not.toContain('data-zerops-surface="next-steps"');
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

  it("sets every cell's first line on the row's top on a medium container, where a verb takes a second line", () => {
    const row = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    const grid = row.slice(row.indexOf("<div"), row.indexOf(">", row.indexOf("<div")));
    expect(grid).toContain("@2xl/flow:@max-5xl/flow:items-start");
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

  it.each([
    ["a merge", MERGING, "merge", "pull-requests"],
    ["a release", RELEASING, "release", "production"],
    ["a failed production", brokenProduction(), "fix-deploy", "production"],
  ] as const)(
    "draws %s's verb once, at the end of the cell it acts on",
    (_name, group, kind, cell) => {
      const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[group]} />);
      const row = tree.root.findByProps({ id: "flow-row-aaa" });
      const verbs = row.findAll((node) => node.props["data-test-verb"] !== undefined);
      expect(verbs.map((node) => node.props["data-test-verb"])).toEqual([kind]);
      const ancestors: Array<Record<string, unknown>> = [];
      for (let node = verbs[0]!.parent; node !== null; node = node.parent)
        ancestors.push(node.props);
      expect(ancestors.some((props) => props["data-zerops-verb-slot"] === "true")).toBe(true);
      expect(
        ancestors.find((props) => props["data-zerops-step"] !== undefined)?.["data-zerops-step"],
      ).toBe(cell);
      // Beside the lines, never under them.
      expect(ancestors.some((props) => props["data-zerops-cell-lines"] === "true")).toBe(false);
    },
  );

  it("merges once in an opened row: the step's verb, not a second Merge on the pull request it names", () => {
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[
          entry([WREN, STAGE], {
            pullRequests: [pull(), pull({ number: 2 })],
            stops: [STAGE_STOP],
          }),
        ]}
      />,
    );
    const toggle = tree.root.findByProps({ "aria-expanded": false });
    act(() => toggle.props.onClick());
    const withMerge = (number: number) =>
      tree.root.findByProps({ "data-test-pull": number }).props["data-test-with-merge"];
    // The step merges #2, the newest; #1 keeps its own Merge.
    expect(withMerge(2)).toBe("false");
    expect(withMerge(1)).toBe("true");
    expect(tree.root.findAllByProps({ "data-test-mate": "wren-dev" })).toHaveLength(1);
  });

  it("opens any Mate a row names into its conversation, by a real button in reading order", () => {
    const opened: Array<string> = [];
    const KAI = item("kai-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:sm-fixture"]);
    const group = entry([WREN, UMA, KAI], { pullRequests: [pull()] });
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[group]}
        openMate={(value) =>
          value.project.id === "uma-dev" ? undefined : () => opened.push(value.project.id)
        }
      />,
    );
    const mates = tree.root.findByProps({ "data-zerops-step": "mates" });
    const chips = mates.findAllByType("button");
    // Two by name, the rest a count; one still coming up has nothing to press.
    expect(chips.map((chip) => chip.props["aria-label"])).toEqual(["Open Wren"]);
    expect(chips[0]!.props.type).toBe("button");
    expect(chips[0]!.props.tabIndex).toBeUndefined();
    expect(mates.findAll((node) => node.children.includes("Uma"))).not.toHaveLength(0);
    expect(mates.findAll((node) => node.children.join("") === "+1")).not.toHaveLength(0);
    expect(mates.findAllByProps({ "data-test-size": "sm" })).toHaveLength(2);
    act(() => chips[0]!.props.onClick());
    expect(opened).toEqual(["wren-dev"]);
  });

  it("still offers the release beside a broken production, not just the build (D28)", () => {
    const group = section(render({ groups: [brokenProduction()] }), 'data-zerops-group="aaa"');
    const production = group.slice(group.indexOf('data-zerops-step="production"'));
    expect(production).toContain('data-test-verb="fix-deploy"');
    expect(production).toContain('data-test-release-verb="true"');
  });

  it("draws a group stage under main only where one exists — never an empty slot", () => {
    const withStage = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    expect(withStage).toContain('data-zerops-surface="flow-stage"');
    expect(withStage).toContain(">Checking what runs here…<");
    expect(withStage).not.toContain("follows main");
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

  it("offers Add production only where it is the next step; whose it is waits in the opened row", () => {
    const adding = entry([WREN], {
      mainHasCode: true,
      productionAddable: true,
      missing: [{ tier: "production" }],
    });
    const html = render({ groups: [adding] });
    const production = html.slice(html.indexOf('data-zerops-step="production"'));
    expect(production).toContain('data-test-verb="add-production"');
    // The verb's tooltip says it (the page's); the cell is one line.
    expect(production).not.toContain(PRODUCTION_ADDED_HERE);

    const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[adding]} />);
    act(() => tree.root.findByProps({ "aria-expanded": false }).props.onClick());
    const detail = tree.root.findByProps({ "data-zerops-surface": "group-detail" });
    expect(detail.findAll((node) => node.children.includes(PRODUCTION_ADDED_HERE))).toHaveLength(1);
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
    expect(tiles).toContain('id="project-bbb"');
    expect(tiles).toContain("Uma · no task yet");
    expect(html.slice(0, html.indexOf('data-zerops-surface="only-a-mate"'))).not.toContain(
      'data-zerops-group="bbb"',
    );
  });

  it("opens a tile's Mate from the whole tile, with no Open button beside it", () => {
    const open = vi.fn();
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[FRESH]}
        openMate={(value) => (value.project.id === "uma-dev" ? open : undefined)}
      />,
    );
    const tile = tree.root.findByProps({ "data-zerops-surface": "only-a-mate" });
    const buttons = tile.findAllByType("button");
    expect(buttons).toHaveLength(1);
    // Its name starts with what it shows, so a spoken "hokuspokus" finds it (WCAG 2.5.3).
    expect(buttons[0]!.props["aria-label"]).toBe("hokuspokus, open Uma");
    expect(buttons[0]!.props.type).toBe("button");
    act(() => buttons[0]!.props.onClick());
    expect(open).toHaveBeenCalledTimes(1);
    // A first task has no verb anywhere: the Mate is the way in.
    expect(tile.findAll((node) => node.props["data-test-verb"] !== undefined)).toHaveLength(0);

    const still = render({ groups: [FRESH] });
    const stillTile = still.slice(still.indexOf('data-zerops-surface="only-a-mate"'));
    expect(stillTile).not.toContain("<button");
    expect(stillTile).toContain("Uma · no task yet");
  });

  it("keeps a group whose flow is unread as a row: unread is not empty", () => {
    const html = render({ groups: [entry([UMA], {}, false)] });
    expect(html).not.toContain('data-zerops-surface="only-a-mate"');
    expect(html).toContain('data-zerops-surface="flow-rows"');
  });

  it("holds an unread group's pull requests, main and production as pending, claiming nothing", () => {
    const row = section(render({ groups: [entry([UMA], {}, false)] }), 'data-zerops-group="bbb"');
    for (const step of ["pull-requests", "main", "production"])
      expect(row).toMatch(
        new RegExp(`data-zerops-step="${step}"[^>]*data-zerops-step-pending="true"`, "u"),
      );
    expect(row.match(/data-slot="skeleton"/gu)).toHaveLength(3);
    for (const word of ["None yet", "Nothing merged", "Not set up", "After the first merge"])
      expect(row).not.toContain(word);
    // The Mate is known: it is the tree's, not the read's.
    expect(row).toContain('data-zerops-step="mates"');
    expect(row).not.toMatch(/data-zerops-step="mates"[^>]*data-zerops-step-pending/u);
  });

  it("draws an unread group nobody is reading with its words: a skeleton would wait forever", () => {
    const row = section(
      render({ groups: [{ ...entry([UMA], {}, false), awaiting: false }] }),
      'data-zerops-group="bbb"',
    );
    expect(row).not.toContain("data-zerops-step-pending");
    expect(row).toContain("Nothing merged");
  });
});

describe("a creation under way on the Overview", () => {
  it("draws a Mate being created in its group before the listing holds it: asleep, named, still", () => {
    const group = entry([WREN], { pullRequests: [pull()], pending: [VERA_COMING] });
    const row = section(
      render({ groups: [group], openMate: () => () => {} }),
      'data-zerops-group="aaa"',
    );
    const mates = row.slice(
      row.indexOf('data-zerops-step="mates"'),
      row.indexOf('data-zerops-step="pull-requests"'),
    );
    const at = mates.indexOf('data-zerops-surface="mate-coming"');
    const coming = mates.slice(mates.lastIndexOf("<span", at));
    expect(coming).toContain('aria-busy="true"');
    expect(coming).toContain('data-mate-face-state="sleep"');
    expect(coming).toContain(">Vera<");
    expect(coming).toContain('<span class="sr-only">Coming up. A few minutes.</span>');
    // The listed Mate opens; the one being created has nothing to press.
    expect(mates.match(/<button/gu)).toHaveLength(1);
    expect(mates).toContain('aria-label="Open Wren"');
    expect(row).toContain(">2 Mates · 1 open pull request<");
  });

  it("stands the listed Mate in its place once the listing holds it, never both", () => {
    const listed = entry([WREN], {
      pullRequests: [pull()],
      pending: [{ ...VERA_COMING, projectId: "wren-dev", name: "Wren" }],
    });
    const row = section(render({ groups: [listed] }), 'data-zerops-group="aaa"');
    expect(row).not.toContain('data-zerops-surface="mate-coming"');
    expect(row.match(/data-test-face="wren-dev"/gu)).toHaveLength(1);
    expect(row).toContain(">1 Mate · 1 open pull request<");
  });

  it("leads with a brand-new project's group, drawn from its birth alone", () => {
    const html = render({ groups: born([WREN]) });
    const rows = html.slice(html.indexOf('data-zerops-surface="flow-rows"'));
    expect(rows.indexOf('data-zerops-group="ccc"')).toBeGreaterThan(-1);
    expect(rows.indexOf('data-zerops-group="ccc"')).toBeLessThan(
      rows.indexOf('data-zerops-group="aaa"'),
    );
    const todo = section(rows, 'data-zerops-group="ccc"');
    expect(todo).toContain(">Todo<");
    expect(todo).toContain('data-zerops-surface="mate-coming"');
    expect(todo).toContain(">1 Mate<");
  });

  it("names a Mate being created on its group's tile, which still opens the listed one", () => {
    const open = vi.fn();
    const fresh = entry([UMA], { pending: [VERA_COMING] });
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[fresh]}
        openMate={(value) => (value.project.id === "uma-dev" ? open : undefined)}
      />,
    );
    const tile = tree.root.findByProps({ "data-zerops-surface": "only-a-mate" });
    expect(
      tile.findAll((node) => node.children.join("") === "Uma, Vera · no task yet"),
    ).not.toHaveLength(0);
    expect(tile.findAllByProps({ "data-test-face": "uma-dev" })).toHaveLength(1);
    act(() => tile.findByType("button").props.onClick());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens a row to its coming Mate's card, which says how far it has got and opens nothing", () => {
    // Two listed Mates are the row's names, so the one being created is its count.
    const KAI = item("kai-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:sm-fixture"]);
    const group = entry([WREN, KAI], { pullRequests: [pull()], pending: [VERA_COMING] });
    const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[group]} />);
    act(() => tree.root.findByProps({ "aria-expanded": false }).props.onClick());
    const cards = tree.root.findByProps({ "data-zerops-surface": "mate-cards" });
    expect(cards.findAllByProps({ "data-test-mate": "wren-dev" })).toHaveLength(1);
    expect(cards.findAllByProps({ "data-test-mate": "kai-dev" })).toHaveLength(1);
    const coming = cards.findByProps({ "data-zerops-mate-card": "still" });
    expect(coming.props["aria-busy"]).toBe(true);
    expect(coming.findAll((node) => node.children.includes("Vera"))).not.toHaveLength(0);
    expect(
      coming.findAll((node) => node.children.includes("Coming up. A few minutes.")),
    ).not.toHaveLength(0);
    expect(coming.findAllByType("button")).toHaveLength(0);
  });
});

describe("production and stages in flight on the Overview", () => {
  const production = (html: string) =>
    section(html, 'data-zerops-group="aaa"').slice(
      section(html, 'data-zerops-group="aaa"').indexOf('data-zerops-step="production"'),
    );
  /** Line 1 of a cell: its status dot, never the line a narrow row hides. */
  const lineOne = (cell: string) =>
    cell.slice(cell.indexOf('data-zerops-primitive="status-dot"'), cell.indexOf("</span></span>"));
  const creating = {
    ...VERA_COMING,
    projectId: "fixture-prod-new",
    kind: "production" as const,
    name: "production",
  };

  it("reads a production being created as setting up, busy, with no second Add production", () => {
    const adding = entry([WREN], {
      mainHasCode: true,
      productionAddable: true,
      missing: [{ tier: "production" }],
      pending: [creating],
    });
    const html = render({ groups: [adding] });
    const cell = production(html);
    expect(cell).toContain('data-zerops-status-tone="busy"');
    expect(cell).toContain("animate-status-pulse");
    expect(lineOne(cell)).toContain("Setting up production…");
    expect(html).not.toContain('data-test-verb="add-production"');
  });

  it("reads a deploy running on production as busy, never green, the word on line 1", () => {
    const deploying = entry([WREN, PROD], {
      stops: [
        {
          ...PRODUCTION_STOP,
          deployment: {
            state: "known",
            value: {
              kind: "deploying",
              version: {
                name: "v0.2.0",
                commit: "055a7e8",
                sha: undefined,
                taggedBy: undefined,
                label: "v0.2.0",
              },
              previous: null,
            },
            asOf: { ordinal: 1, atMs: 0 },
            coverage: "complete",
            freshness: { kind: "live" },
          },
        },
      ],
    });
    const cell = production(render({ groups: [deploying] }));
    expect(cell).toContain('data-zerops-status-tone="busy"');
    expect(cell).not.toContain('data-zerops-status-tone="ok"');
    expect(lineOne(cell)).toContain("Deploying…");
    expect(cell).toContain(">v0.2.0<");
  });

  it("keeps a release on its way on line 1, where a narrow row still reads it", () => {
    const releasing = entry([WREN, PROD], {
      stops: [PRODUCTION_STOP],
      release: {
        gate: { allowed: false, reason: "Releasing v0.1.0…" },
        suggestion: "v0.1.1",
        waiting: 1,
        inFlight: "v0.1.0",
      },
    });
    const cell = production(render({ groups: [releasing] }));
    expect(lineOne(cell)).toContain("Releasing v0.1.0…");
    expect(cell).toMatch(/hidden @2xl\/flow:block">Checking what runs here…</u);
  });

  it("draws a stage being created under main as setting up, busy", () => {
    const html = render({
      groups: [
        entry([WREN], {
          pending: [{ ...creating, projectId: "fixture-stage-new", kind: "stage", name: "stage" }],
        }),
      ],
    });
    const row = section(html, 'data-zerops-group="aaa"');
    const stage = row.slice(row.indexOf('data-zerops-surface="flow-stage"'));
    expect(stage).toContain("↳");
    expect(stage).toContain('data-zerops-status-tone="busy"');
    expect(stage).toContain(">Setting up a stage…<");
  });
});

describe("the quiet end", () => {
  const GITEA = item("mate-gitea", ["mate:tool:gitea"], false);

  it("sets the tools line on the environment rows' grid, one list with them", () => {
    const html = render({
      groups: [MERGING],
      tools: [{ item: GITEA, kind: "gitea" }],
      ungrouped: [{ item: item("zerops-ads", [], false), action: "set-up-mate" }],
      renderEnvironment: (value) => (
        <li className={ENVIRONMENT_ROW_GRID_CLASS} data-test-environment={value.project.id} />
      ),
    });
    const end = html.slice(html.indexOf('data-zerops-surface="quiet-end"'));
    expect(end.match(/<ul/gu)).toHaveLength(1);
    expect(end).toMatch(/px-3/u);
    const tools = end.slice(end.lastIndexOf("<li", end.indexOf('data-zerops-tools="true"')));
    expect(tools).toContain(`class="${ENVIRONMENT_ROW_GRID_CLASS}`);
    expect(tools).toContain(">Tools<");
    expect(tools).toContain('data-test-tool="mate-gitea"');
  });

  it("is only the tools line where every project has a Mate", () => {
    const html = render({ groups: [MERGING], onCreateTool: () => {} });
    const end = html.slice(html.indexOf('data-zerops-surface="quiet-end"'));
    expect(end.match(/<li/gu)).toHaveLength(1);
    expect(end).toContain("Add Gitea");
  });
});
