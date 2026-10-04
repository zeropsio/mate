import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

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

import { ComingMateCard, ComingMateFace, MateChip, matesOf } from "./flowSteps";
import { entry, mount, UMA, WREN } from "./flowTestFixtures";

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
  };
  const pairs = (value: ReturnType<typeof entry>) =>
    matesOf(value).map((entry) =>
      entry.kind === "listed"
        ? [entry.item.project.id, entry.mate.projectId, entry.mate.name, undefined]
        : [undefined, entry.mate.projectId, entry.mate.name, "coming"],
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
        [undefined, "vera-dev", "Vera", "coming"],
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

describe("a Mate being created", () => {
  const stateOf = (markup: string) => /data-mate-face-state="([^"]+)"/u.exec(markup)?.[1];
  it.each([
    { case: "coming up", failed: false, state: "waking" },
    { case: "its birth stopped", failed: true, state: "sleep" },
  ] as const)("$case: its face $state", ({ failed, state }) => {
    const coming = { face: { tint: "coral", shape: "gem" }, failed } as const;
    expect(stateOf(renderToStaticMarkup(<ComingMateFace coming={coming} size="sm" />))).toBe(state);
    for (const layout of ["card", "row"] as const) {
      expect(
        stateOf(
          renderToStaticMarkup(<ComingMateCard coming={coming} layout={layout} name="Kai" />),
        ),
      ).toBe(state);
    }
  });
});
