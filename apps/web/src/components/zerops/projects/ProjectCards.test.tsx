// @vitest-environment happy-dom
import type * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const detail = vi.hoisted(() => ({
  held: new Set<string>(),
  demand: vi.fn(({ ownerId }: { ownerId: string }) => {
    detail.held.add(ownerId);
    return () => detail.held.delete(ownerId);
  }),
}));
vi.mock("~/zerops/ZeropsAccountData", () => ({
  useAccountDataOptional: () => ({ demandDetail: detail.demand }),
}));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0 }));
vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({
      to,
      params = {},
      ...props
    }: React.ComponentProps<"a"> & {
      to: string;
      params?: Record<string, string>;
    }) =>
      createElement("a", {
        href: to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? ""),
        ...props,
      }),
  };
});

import { CardMate, ProjectCards } from "./ProjectCards";
import { overviewKeeps } from "./projectsView.logic";
import { cardMateReading } from "./projectCard.logic";
import { entry, FLOW_PROPS, item, placed } from "./flowTestFixtures";

// The browser owns viewport intersection; this render case holds both already-visible cards.
class VisibleCard {
  constructor(private readonly on: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.on(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  detail.held.clear();
  detail.demand.mockClear();
});

it("an unrelated Mate attention update leaves the other Projects row unchanged", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  const ada = item("Ada", placed("shop", "Shop"));
  const bea = item("Bea", placed("other", "Other"));
  const groups = [entry([ada]), entry([bea])];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (adaTask: string | undefined) =>
    root.render(
      <ProjectCards
        focusGroup={undefined}
        groups={groups}
        props={{
          ...FLOW_PROPS,
          groups,
          renderMate: (mate) => (
            <CardMate
              name={mate.project.name}
              face={null}
              time={null}
              onOpen={undefined}
              reading={cardMateReading({
                view: {
                  state: "working",
                  ask: mate.project.id === "Ada" ? adaTask : "Inspect Bea checkout",
                  reply: undefined,
                },
                mine: false,
                review: undefined,
                status: undefined,
                read: true,
              })}
            />
          ),
        }}
      />,
    );
  try {
    await act(async () => render(undefined));
    const other = container.querySelector('[data-zerops-group="other"]')!;
    expect(other.textContent).toContain("Inspect Bea checkout");
    const before = other.innerHTML;
    const held = [...detail.held].sort();
    expect(held).toEqual(["other", "shop"]);
    const reads = detail.demand.mock.calls.length;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(other, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    try {
      await act(async () => render("Inspect Ada changed checkout"));
      expect(container.querySelector('[data-zerops-group="shop"]')?.textContent).toContain(
        "Inspect Ada changed checkout",
      );
      mutations.push(...observer.takeRecords());
      expect(container.querySelector('[data-zerops-group="other"]')).toBe(other);
      expect(other.innerHTML).toBe(before);
      expect(mutations).toEqual([]);
      expect([...detail.held].sort()).toEqual(held);
      expect(detail.demand.mock.calls).toHaveLength(reads);
    } finally {
      observer.disconnect();
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each([
  ["waiting", undefined],
  ["mine", undefined],
  ["waiting", "mine", undefined],
  ["mine", "waiting", "mine", "waiting", undefined],
  ["waiting", undefined, "mine", undefined],
] as const)("after any sequence of filter switches, All lists every item", async (...sequence) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // A fixed viewport does not resize when filtering replaces the row's children.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const groups = ["Ada", "Bea", "Cara", "Dana"].map((name) =>
    entry([item(name, placed(name.toLowerCase(), name))]),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (show: "waiting" | "mine" | undefined) => {
    const kept = groups.filter((_, index) =>
      overviewKeeps({ show, waits: index === 1, mine: index === 2 }),
    );
    root.render(<ProjectCards focusGroup={undefined} groups={kept} props={FLOW_PROPS} />);
  };
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  const total = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return Math.max(800, this.querySelectorAll("[data-zerops-group]").length * 396);
  });
  try {
    await act(async () => render(undefined));
    for (const show of sequence) {
      await act(async () => render(show));
      if (show !== undefined) {
        // Chrome's scroll snap can retain this card when the full set returns.
        container.querySelector<HTMLElement>("[data-zerops-surface=project-cards]")!.scrollLeft =
          396;
      } else {
        expect(
          [...container.querySelectorAll("[data-zerops-group]")].map((card) =>
            card.getAttribute("data-zerops-group"),
          ),
        ).toEqual(["ada", "bea", "cara", "dana"]);
        const row = container.querySelector<HTMLElement>("[data-zerops-surface=project-cards]")!;
        expect(row.scrollLeft, "All starts with its first item").toBe(0);
        expect(
          container.querySelector(".ov-rail")!.hasAttribute("data-can-right"),
          "All keeps every offscreen item reachable",
        ).toBe(true);
      }
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    width.mockRestore();
    total.mockRestore();
  }
});
