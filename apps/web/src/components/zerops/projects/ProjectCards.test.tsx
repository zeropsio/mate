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
