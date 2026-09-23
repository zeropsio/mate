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
import { brokenProduction, entry, mount, UMA, WREN } from "./flowTestFixtures";

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

  it("reads stage · Deployed … on one line, with no route", () => {
    const html = renderToStaticMarkup(<StageLines density="line" stages={[stop()]} />);
    expect(html.match(/data-zerops-surface="flow-stage"/gu)).toHaveLength(1);
    expect(html).toContain("↳");
    expect(html).toContain(">stage · Deployed e014b0e<");
    expect(html).not.toContain("follows main");
    expect(html).not.toContain("stage.example.test");
  });

  it("names each stage where there are two, and a row counts the rest", () => {
    const two = [stop({ name: "stage-eu" }), stop({ projectId: "second", name: "stage-us" })];
    const line = renderToStaticMarkup(<StageLines density="line" stages={two} />);
    expect(line).toContain(">stage-eu · Deployed e014b0e<");
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
  it("pair each environment with its flow's Mate, in the tree's order", () => {
    const both = entry([WREN, UMA]);
    expect(
      matesOf(both).map(({ item, mate }) => [item.project.id, mate.projectId, mate.name]),
    ).toEqual([
      ["wren-dev", "wren-dev", "Wren"],
      ["uma-dev", "uma-dev", "Uma"],
    ]);
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
});
