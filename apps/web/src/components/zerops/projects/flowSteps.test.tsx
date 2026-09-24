import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { GroupFlowStop } from "@t3tools/client-runtime/zerops";

import {
  MainStep,
  MateChip,
  matesOf,
  ProductionStep,
  PullRequestsStep,
  StageLines,
  VerbSlot,
  type Density,
} from "./flowSteps";
import { brokenProduction, entry, mount, pull, UMA, WREN } from "./flowTestFixtures";

describe("an empty step", () => {
  const empty = entry([WREN], { mainHasCode: false });
  const cases: ReadonlyArray<readonly [string, string, ReactElement]> = (
    ["line", "box"] as ReadonlyArray<Density>
  ).flatMap((density) => [
    [
      `main, ${density}`,
      "Nothing merged",
      <MainStep density={density} entry={empty} key="main" verb={null} />,
    ] as const,
    [
      `production, ${density}`,
      "After the first merge",
      <ProductionStep
        density={density}
        entry={empty}
        key="production"
        releaseVerb={null}
        verb={null}
      />,
    ] as const,
  ]);

  const all: ReadonlyArray<readonly [string, string, ReactElement]> = [
    ...cases,
    ["pull requests", "None yet", <PullRequestsStep entry={empty} key="pulls" verb={null} />],
  ];
  it.each(all)("says its word in the muted hand, never dashed: %s", (_name, word, element) => {
    const html = renderToStaticMarkup(element);
    expect(html).toContain(
      `<span class="truncate text-sm font-normal text-muted-foreground" data-zerops-empty-step="true">${word}</span>`,
    );
    expect(html).not.toContain("border-dashed");
  });
});

describe("a stage line", () => {
  const stop = (over: Partial<GroupFlowStop> = {}): GroupFlowStop => ({
    projectId: "fixture-stage",
    name: "stage",
    state: "deployed",
    version: {
      name: undefined,
      commit: "e014b0e",
      sha: "e014b0e0000000000000000000000000000000000",
      taggedBy: undefined,
      label: "e014b0e",
    },
    source: undefined,
    route: "https://stage.example.test",
    ...over,
  });

  it.each(["line", "box"] as ReadonlyArray<Density>)(
    "reads ↳ Deployed … on one line where the group has one stage, with no name and no route: %s",
    (density) => {
      const html = renderToStaticMarkup(<StageLines density={density} stages={[stop()]} />);
      expect(html.match(/data-zerops-surface="flow-stage"/gu)).toHaveLength(1);
      expect(html).toContain("↳");
      expect(html).not.toContain("stage ·");
      expect(html).not.toContain("follows main");
      expect(html).not.toContain("stage.example.test");
    },
  );

  it("keeps the state word whole: only the version gives way", () => {
    const html = renderToStaticMarkup(<StageLines density="line" stages={[stop()]} />);
    expect(html).toMatch(
      /class="inline-flex min-w-0 items-center gap-1\.5 shrink-0"[^>]*>.*?<span class="min-w-0 truncate">Deployed<\/span>/u,
    );
    expect(html).toContain('<span class="min-w-0 truncate tabular-nums">e014b0e</span>');
    const empty = renderToStaticMarkup(
      <StageLines density="line" stages={[stop({ state: "empty", version: undefined })]} />,
    );
    expect(empty).toContain(">Nothing deployed yet<");
    expect(empty).not.toContain("tabular-nums");
  });

  it("names each stage where there are two, and a row counts the rest", () => {
    const two = [stop({ name: "stage-eu" }), stop({ projectId: "second", name: "stage-us" })];
    const line = renderToStaticMarkup(<StageLines density="line" stages={two} />);
    expect(line).toContain(">stage-eu ·<");
    expect(line).toContain(">Deployed<");
    expect(line).toContain("· +1");
    expect(line).not.toContain("stage-us");
    const box = renderToStaticMarkup(
      <StageLines density="box" menuFor={(id) => <i data-test-menu={id} />} stages={two} />,
    );
    expect(box).toContain('data-test-menu="fixture-stage"');
    expect(box).toContain('data-test-menu="second"');
  });
});

describe("the verb slot", () => {
  it.each([
    ["no verb", undefined],
    ["null", null],
    ["false", false],
    ["only empties", [null, undefined, false]],
  ] as const)("draws nothing for %s", (_name, children) => {
    expect(renderToStaticMarkup(<VerbSlot>{children}</VerbSlot>)).toBe("");
  });

  it("holds its verbs at the cell's end, in order", () => {
    const html = renderToStaticMarkup(
      <VerbSlot>
        <button data-test="fix" type="button" />
        {null}
        <button data-test="release" type="button" />
      </VerbSlot>,
    );
    expect(html).toContain('data-zerops-verb-slot="true"');
    expect(html.indexOf('data-test="fix"')).toBeLessThan(html.indexOf('data-test="release"'));
  });
});

describe("a Mate chip", () => {
  it("that can open is a button named Open {name}, and opens", () => {
    const onOpen = vi.fn();
    const chip = mount(<MateChip face={<i data-test-face="wren" />} name="Wren" onOpen={onOpen} />);
    const button = chip.root.findByType("button");
    expect(button.props["aria-label"]).toBe("Open Wren");
    expect(button.props.type).toBe("button");
    expect(button.props["data-zerops-surface"]).toBe("mate-open");
    button.props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("that cannot open is its face and name, with nothing to press", () => {
    const html = renderToStaticMarkup(
      <MateChip face={<i data-test-face="wren" />} name="Wren" onOpen={undefined} />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain('data-test-face="wren"');
    expect(html).toContain(">Wren<");
  });
});

describe("a group's Mates", () => {
  const VERA = {
    projectId: "vera-dev",
    kind: "mate" as const,
    name: "Vera",
    startedAt: 5,
    step: "harden" as const,
    overdue: false,
  };
  const pairs = (value: ReturnType<typeof entry>) =>
    matesOf(value).map((entry) =>
      entry.kind === "listed"
        ? [entry.item.project.id, entry.mate.projectId, entry.mate.name, undefined]
        : [undefined, entry.mate.projectId, entry.mate.name, entry.coming.step],
    );
  it.each([
    {
      name: "pair each environment with its flow's Mate, in the flow's order",
      value: entry([WREN, UMA]),
      want: [
        ["wren-dev", "wren-dev", "Wren", undefined],
        ["uma-dev", "uma-dev", "Uma", undefined],
      ],
    },
    {
      name: "pair by project, never by place",
      value: {
        ...entry([WREN, UMA]),
        mates: new Map([
          [UMA.project.id, UMA],
          [WREN.project.id, WREN],
        ]),
      },
      want: [
        ["wren-dev", "wren-dev", "Wren", undefined],
        ["uma-dev", "uma-dev", "Uma", undefined],
      ],
    },
    {
      name: "carry a Mate being created, with no environment, after the listed ones",
      value: entry([WREN], { pending: [VERA] }),
      want: [
        ["wren-dev", "wren-dev", "Wren", undefined],
        [undefined, "vera-dev", "Vera", "harden"],
      ],
    },
    {
      name: "draw a creation the listing holds once, as the listed Mate",
      value: entry([WREN], { pending: [{ ...VERA, projectId: "wren-dev" }] }),
      want: [["wren-dev", "wren-dev", "Wren", undefined]],
    },
  ])("$name", ({ value, want }) => {
    expect(pairs(value)).toEqual(want);
  });
});

describe("a production's state", () => {
  it("keeps its dot a gap apart from its word, at the cell's size", () => {
    const html = renderToStaticMarkup(
      <ProductionStep density="line" entry={brokenProduction()} releaseVerb={null} verb={null} />,
    );
    expect(html).toContain(
      'class="inline-flex items-center gap-1.5 min-w-0 text-sm" data-zerops-primitive="status-dot"',
    );
  });

  it("draws its verb, the release and its menu as one keyed list", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(
      <ProductionStep
        density="box"
        entry={brokenProduction()}
        menu={<i data-test="menu" />}
        releaseVerb={<button data-test="release" type="button" />}
        verb={<button data-test="fix" type="button" />}
      />,
    );
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    const order = ["fix", "release", "menu"].map((name) => html.indexOf(`data-test="${name}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("never goes under a word beside its verb: its lines keep a floor", () => {
    const tree = mount(
      <ProductionStep
        density="line"
        entry={brokenProduction()}
        releaseVerb={<button data-test="release" type="button" />}
        verb={<button data-test="fix" type="button" />}
      />,
    );
    const lines = tree.root.findByProps({ "data-zerops-cell-lines": "true" });
    expect(lines.props.className).toContain("min-w-24");
  });
});

describe("a row's cell on a medium container", () => {
  const MEDIUM = "@2xl/flow:@max-5xl/flow:";
  it("runs its first line across and sets its verb on the second line's place", () => {
    const tree = mount(
      <PullRequestsStep
        entry={entry([WREN], { pullRequests: [pull()] })}
        verb={<button data-test="merge" type="button" />}
      />,
    );
    const lines = tree.root.findByProps({ "data-zerops-cell-lines": "true" });
    expect(lines.props.className).toContain(`${MEDIUM}contents`);
    expect(lines.props.className).toContain(`${MEDIUM}[&>:first-child]:col-span-2`);
    const slot = tree.root.findByProps({ "data-zerops-verb-slot": "true" });
    expect(slot.props.className).toContain(`${MEDIUM}row-start-2`);
    expect(slot.props.className).toContain(`${MEDIUM}col-start-2`);
  });

  it("keeps a box's verb beside its lines", () => {
    const tree = mount(
      <MainStep
        density="box"
        entry={entry([WREN])}
        verb={<button data-test="fix" type="button" />}
      />,
    );
    const lines = tree.root.findByProps({ "data-zerops-cell-lines": "true" });
    expect(lines.props.className).not.toContain(MEDIUM);
  });
});
