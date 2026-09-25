import type * as React from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { GroupFlowProduction, GroupFlowStop } from "@t3tools/client-runtime/zerops";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({
      to,
      params = {},
      ...props
    }: React.ComponentProps<"a"> & { to: string; params?: Record<string, string> }) =>
      createElement("a", {
        href: to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? ""),
        ...props,
      }),
  };
});

// Base UI's tooltip reads `window` as it mounts, which a node render has none of: the trigger
// draws what it renders, and the hover it opens is not drawn.
vi.mock("~/components/ui/tooltip", async () => {
  const { cloneElement, Fragment, createElement } = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({
      children,
      render,
    }: {
      readonly children: React.ReactNode;
      readonly render: React.ReactElement;
    }) => cloneElement(render, undefined, children),
    TooltipPopup: () => null,
  };
});

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
import {
  brokenProduction,
  entry,
  mount,
  PROD,
  PRODUCTION_STOP,
  pull,
  UMA,
  WREN,
} from "./flowTestFixtures";

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
      const html = renderToStaticMarkup(
        <StageLines groupId="aaa" density={density} stages={[stop()]} />,
      );
      expect(html.match(/data-zerops-surface="flow-stage"/gu)).toHaveLength(1);
      expect(html).toContain("↳");
      expect(html).not.toContain("stage ·");
      expect(html).not.toContain("follows main");
      expect(html).not.toContain("stage.example.test");
    },
  );

  it("keeps the state word whole: only the version gives way", () => {
    const html = renderToStaticMarkup(
      <StageLines groupId="aaa" density="line" stages={[stop()]} />,
    );
    expect(html).toMatch(
      /class="inline-flex min-w-0 items-center gap-1\.5 shrink-0"[^>]*>.*?<span class="min-w-0 truncate">Deployed<\/span>/u,
    );
    expect(html).toContain('<span class="min-w-0 truncate tabular-nums">e014b0e</span>');
    const empty = renderToStaticMarkup(
      <StageLines
        groupId="aaa"
        density="line"
        stages={[stop({ state: "empty", version: undefined })]}
      />,
    );
    expect(empty).toContain(">Nothing deployed yet<");
    expect(empty).not.toContain("tabular-nums");
  });

  it("names each stage where there are two, and a row counts the rest", () => {
    const two = [stop({ name: "stage-eu" }), stop({ projectId: "second", name: "stage-us" })];
    const line = renderToStaticMarkup(<StageLines groupId="aaa" density="line" stages={two} />);
    expect(line).toContain(">stage-eu ·<");
    expect(line).toContain(">Deployed<");
    expect(line).toContain("· +1");
    expect(line).not.toContain("stage-us");
    const box = renderToStaticMarkup(
      <StageLines
        groupId="aaa"
        density="box"
        menuFor={(id) => <i data-test-menu={id} />}
        stages={two}
      />,
    );
    expect(box).toContain('data-test-menu="fixture-stage"');
    expect(box).toContain('data-test-menu="second"');
  });

  it("draws a stage being created after the listed ones, named beside them, with no menu", () => {
    const creating = [
      {
        projectId: "stage-new",
        kind: "stage" as const,
        name: "stage-us",
        step: "tags" as const,
        overdue: false,
      },
    ];
    const box = renderToStaticMarkup(
      <StageLines
        groupId="aaa"
        creating={creating}
        density="box"
        menuFor={(id) => <i data-test-menu={id} />}
        stages={[stop({ name: "stage-eu" })]}
      />,
    );
    expect(box.match(/data-zerops-surface="flow-stage"/gu)).toHaveLength(2);
    expect(box.indexOf(">stage-eu ·<")).toBeLessThan(box.indexOf(">stage-us ·<"));
    expect(box).toContain(">Setting up a stage…<");
    expect(box).not.toContain('data-test-menu="stage-new"');
    const line = renderToStaticMarkup(
      <StageLines groupId="aaa" creating={creating} density="line" stages={[]} />,
    );
    expect(line).toContain(">Setting up a stage…<");
    expect(line).toContain('data-zerops-status-tone="busy"');
    expect(line).not.toContain("stage-us ·");
  });
});

describe("a stage line's way in", () => {
  const stage = (projectId: string, name: string): GroupFlowStop => ({
    projectId,
    name,
    state: "deployed",
    version: undefined,
    source: undefined,
    route: undefined,
  });
  const creating = [
    {
      projectId: "stage-new",
      kind: "stage" as const,
      name: "stage-us",
      step: "tags" as const,
      overdue: false,
    },
  ];
  it.each(["line", "box"] as ReadonlyArray<Density>)(
    "opens each listed stage's page from its words, never from its menu or a stage being created: %s",
    (density) => {
      const html = renderToStaticMarkup(
        <StageLines
          creating={creating}
          density={density}
          groupId="aaa"
          menuFor={(id) => <i data-test-menu={id} />}
          stages={[stage("fixture-stage", "stage-eu"), stage("second", "stage-ap")]}
        />,
      );
      const lines = html.split('data-zerops-surface="flow-stage"').slice(1);
      const listed = density === "line" ? ["fixture-stage"] : ["fixture-stage", "second"];
      expect(
        lines.slice(0, listed.length).map((line) => line.match(/href="([^"]*)"/u)?.[1]),
      ).toEqual(listed.map((id) => `/group/aaa/${id}`));
      for (const line of lines.slice(0, listed.length)) {
        const anchor = line.slice(line.indexOf("<a "), line.indexOf("</a>") + 4);
        expect(anchor).toContain("↳");
        expect(anchor).toContain('data-zerops-primitive="status-dot"');
        expect(anchor).not.toContain("data-test-menu");
        if (density === "box") expect(line.slice(line.indexOf("</a>"))).toContain("data-test-menu");
      }
      if (density === "box") {
        expect(lines).toHaveLength(3);
        expect(lines[2]).toContain(">Setting up a stage…<");
        expect(lines[2]).not.toContain("<a ");
      }
    },
  );
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

describe("a production's way in", () => {
  const stop: GroupFlowStop = {
    projectId: "fixture-prod",
    name: "production",
    state: "deployed",
    version: undefined,
    source: undefined,
    route: undefined,
  };
  const creation = {
    projectId: "prod-new",
    kind: "production" as const,
    name: "production",
    step: "tags" as const,
    overdue: false,
  };
  const candidate = { tag: "v0.1.0", waiting: 1 };
  const productions: ReadonlyArray<readonly [GroupFlowProduction, boolean]> = [
    [{ kind: "absent", line: "After the first merge", addable: false }, false],
    [{ kind: "creating", line: "Setting up production…", creation }, false],
    [{ kind: "checking", stop, line: "Checking what runs here…" }, true],
    [{ kind: "empty", stop, line: "Nothing deployed yet" }, true],
    [{ kind: "deploying", stop, line: "Deploying…" }, true],
    [{ kind: "live", stop, line: "Live" }, true],
    [{ kind: "deploy-failed", stop, line: "Deploy failed", candidate }, true],
    [{ kind: "releasing", stop, line: "Deployed", tag: "v0.1.0" }, true],
    [{ kind: "ready-to-release", stop, line: "Deployed", candidate }, true],
  ];
  const base = entry([WREN, PROD], { stops: [PRODUCTION_STOP] });
  it.each(
    productions.flatMap(([production, linked]) =>
      (["line", "box"] as ReadonlyArray<Density>).map(
        (density) => [production.kind, density, production, linked] as const,
      ),
    ),
  )(
    "%s, %s: opens the stop page from its lines, never from its verbs",
    (_kind, density, production, linked) => {
      const html = renderToStaticMarkup(
        <ProductionStep
          density={density}
          entry={{ ...base, flow: { ...base.flow, production } }}
          menu={<i data-test="menu" />}
          releaseVerb={<button data-test="release" type="button" />}
          verb={<button data-test="verb" type="button" />}
        />,
      );
      if (!linked) {
        expect(html).not.toContain("<a");
        return;
      }
      expect(html.match(/<a /gu)).toHaveLength(1);
      const anchor = html.slice(html.indexOf("<a "), html.indexOf("</a>") + 4);
      expect(anchor).toContain('href="/group/aaa/fixture-prod"');
      expect(anchor).toContain('data-zerops-cell-lines="true"');
      expect(anchor).toContain('data-zerops-primitive="status-dot"');
      expect(anchor).not.toContain("data-test=");
      expect(anchor).not.toContain("<button");
      expect(html.slice(html.indexOf("</a>"))).toContain('data-test="menu"');
    },
  );
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
