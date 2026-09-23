import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  brokenProduction,
  entry,
  FLOW_PROPS,
  FRESH,
  item,
  MERGING,
  mount,
  PRODUCTION_STOP,
  pull,
  RELEASING,
  renderFlow as render,
  section,
  STAGE,
  STAGE_STOP,
  UMA,
  WREN,
  type Item,
} from "./flowTestFixtures";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";

describe("the Overview", () => {
  it("lists the next steps across groups without their verbs, and a step jumps to its row", () => {
    const html = render({ groups: [MERGING, FRESH] });
    const strip = html.slice(
      html.indexOf('data-zerops-surface="next-steps"'),
      html.indexOf('data-zerops-surface="flow-rows"'),
    );
    expect(strip).toContain("Next steps");
    expect(strip).toContain(">sm-fixture<");
    expect(strip).toContain(">Pull request #1 waits for your merge<");
    // The row carries the verb; the strip is where to go, not a second copy.
    expect(strip).not.toContain("data-test-verb");
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
    expect(withStage).toContain(">stage · Checking what runs here…<");
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
    expect(buttons[0]!.props["aria-label"]).toBe("Open Uma");
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
});
