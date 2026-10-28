// @vitest-environment happy-dom
import type * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const detail = vi.hoisted(() => ({
  /** The account's organization; none outside an account, where no detail is waited for. */
  org: null as string | null,
  /** What HQ said of each application's detail, by its id. */
  reads: {} as Record<string, { read: "unread" | "reading" | "read"; failure: null }>,
  held: new Set<string>(),
  demand: vi.fn(({ ownerId }: { ownerId: string }) => {
    detail.held.add(ownerId);
    return () => detail.held.delete(ownerId);
  }),
}));
vi.mock("~/zerops/ZeropsAccountData", () => ({
  useAccountOrgId: () => detail.org,
  useProjection: () => detail.reads,
  useAccountDataOptional: () => ({ demandDetail: detail.demand }),
  useDetailDemand: () => {},
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

import { PlacePanel } from "./PlacePanel";
import { CardMate, ProjectCards } from "./ProjectCards";
import { overviewKeeps } from "./projectsView.logic";
import { cardMateReading } from "./projectCard.logic";
import { entry, FLOW_PROPS, item, placed, STAGE_STOP, WREN } from "./flowTestFixtures";

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
  detail.org = null;
  detail.reads = {};
  detail.held.clear();
  detail.demand.mockClear();
});

// The onboarding run: a card's first frame said "No changes yet" and had no History; 40 ms later
// its changes came and every section below moved down.
it("paints a card once, whole: it stands in until HQ said its detail, never an empty list it takes back", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  detail.org = "org";
  const groups = [entry([item("Ada", placed("shop", "Shop"))])];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <ProjectCards
        focusGroup={undefined}
        groups={groups}
        props={{ ...FLOW_PROPS, groups, renderChanges: () => <p>No changes yet</p> }}
      />,
    );
  try {
    await act(async () => render());
    expect(container.querySelector('[data-zerops-group="shop"]')).toBeNull();
    expect(container.textContent).not.toContain("No changes yet");
    expect(container.querySelector('[aria-label="Shop"][aria-busy="true"]')).not.toBeNull();
    // Standing in, it holds the detail it waits for.
    expect([...detail.held]).toEqual(["shop"]);
    detail.reads = { shop: { read: "read", failure: null } };
    await act(async () => render());
    expect(container.querySelector('[data-zerops-group="shop"]')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

// State Smoke, 2026-10-27: the overview mounted its card under its wait, out of sight; on a busy
// page the browser told "hidden" and "on screen" in one callback, and the card read the first and
// stood in for good, never asking HQ for its detail.
it("a card that comes into sight holds its detail, even when the browser tells its hidden first sight in the same report", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly on: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.on(
          [
            { target, isIntersecting: false, time: 1 } as IntersectionObserverEntry,
            { target, isIntersecting: true, time: 2 } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
  detail.org = "org";
  const groups = [entry([item("Ada", placed("shop", "Shop"))])];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectCards focusGroup={undefined} groups={groups} props={{ ...FLOW_PROPS, groups }} />,
      ),
    );
    expect([...detail.held]).toEqual(["shop"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
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

/** One card, drawn whole, outside an account: each place by its panel, as the overview draws it. */
async function drawCard(group: ReturnType<typeof entry>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ProjectCards
        focusGroup={undefined}
        groups={[group]}
        props={{
          ...FLOW_PROPS,
          renderPlacePanel: ({ group: { groupId } }, line) => (
            <PlacePanel
              actions={null}
              groupId={groupId}
              model={{ line, version: undefined, note: undefined, brought: [], services: [] }}
            />
          ),
        }}
      />,
    ),
  );
  return {
    container,
    done: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("a card's title opens its project's page", async () => {
  const card = await drawCard(entry([item("Ada", placed("shop", "Shop"))]));
  try {
    const title = [...card.container.querySelectorAll("h2 a")].find(
      (link) => link.textContent === "Shop",
    );
    expect(title?.getAttribute("href")).toBe("/group/shop/flow");
    // The project's ··· keeps its own press, outside the link.
    expect(title?.querySelector("[data-test-menu]")).toBeNull();
  } finally {
    await card.done();
  }
});

it("a project with three stage environments lists each with its state and address", async () => {
  const stageOf = (projectId: string, name: string, host: string) => ({
    ...STAGE_STOP,
    projectId,
    name,
    addresses: [{ service: "app", url: `https://${host}` }],
  });
  const card = await drawCard(
    entry([WREN], {
      stops: [
        stageOf("acme-stage", "stage", "stage.acme.example"),
        stageOf("acme-checkout", "stage-checkout", "checkout.acme.example"),
        stageOf("acme-perf", "stage-perf", "perf.acme.example"),
      ],
    }),
  );
  try {
    const stages = [...card.container.querySelectorAll('[data-zerops-place="stage"]')];
    expect(
      stages.map((stage) => [
        stage.querySelector("b")?.textContent,
        stage.querySelector("a")?.getAttribute("href"),
        // Its state: a dot and the words beside it, in the state's ink.
        [...stage.querySelectorAll("[data-dot]")].some(
          (said) => (said.textContent ?? "").trim().length > 0,
        ),
      ]),
    ).toEqual([
      ["Stage", "https://stage.acme.example", true],
      ["Stage-checkout", "https://checkout.acme.example", true],
      ["Stage-perf", "https://perf.acme.example", true],
    ]);
  } finally {
    await card.done();
  }
});

it("a project with no stage offers to add one where HQ offers it, and assumes none", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  const added: string[] = [];
  const group = entry([WREN]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ProjectCards
        focusGroup={undefined}
        groups={[group]}
        props={{ ...FLOW_PROPS, setUpStage: () => () => added.push("stage") }}
      />,
    ),
  );
  try {
    // Where a stage would stand, only the way to add one: no stage's state is assumed.
    const places = [...container.querySelectorAll('[data-zerops-place="stage"]')];
    expect(places).toHaveLength(1);
    expect(places[0]?.querySelector('[data-zerops-place-setup="stage"]')).not.toBeNull();
    expect(places[0]?.querySelector("[data-dot]")).toBeNull();
    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add stage"),
    );
    await act(async () => add?.click());
    expect(added).toEqual(["stage"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("a release in progress shows on the project's production, never in a Mate's conversation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  const group = entry([WREN]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ProjectCards
        focusGroup={undefined}
        groups={[group]}
        props={{
          ...FLOW_PROPS,
          renderProductionRun: () => <p data-test-run="">Releasing v0.1.1</p>,
        }}
      />,
    ),
  );
  try {
    const production = container.querySelector('[data-zerops-place="production"]');
    expect(production?.querySelector("[data-test-run]")?.textContent).toBe("Releasing v0.1.1");
    expect(container.querySelectorAll("[data-test-run]")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("a Mate's row shows each part by its friendly name: a door to its preview, else to its dev, and a part with no address muted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const entry = (key: string, label: string, url?: string, why?: string) => ({
    key,
    label,
    service: key,
    url,
    host: url?.replace("https://", ""),
    more: [],
    why,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <CardMate
          name="Odin"
          face={null}
          time={null}
          onOpen={undefined}
          parts={[
            {
              key: "part:apipool",
              devService: "apipool",
              pooled: true,
              name: "API",
              dev: [],
              preview: entry("preview:apistage", "preview", "https://apistage.example.app"),
            },
            {
              key: "part:matedev",
              devService: "matedev",
              pooled: false,
              name: "Mate",
              dev: [entry("dev:matedev", "dev", "https://matedev.example.app")],
              preview: undefined,
            },
            {
              key: "part:runnerpool",
              devService: "runnerpool",
              pooled: true,
              name: "Runner",
              dev: [],
              preview: entry("preview:runnerstage", "preview", undefined, "no public address"),
            },
          ]}
          reading={cardMateReading({
            view: { state: "idle", ask: undefined, reply: undefined },
            mine: true,
            review: undefined,
            status: undefined,
            read: true,
          })}
        />,
      ),
    );
    const chips = [
      ...container.querySelectorAll('[data-zerops-surface="card-mate-parts"] > *'),
    ].map((chip) => [chip.textContent, chip.getAttribute("href"), chip.getAttribute("aria-label")]);
    expect(chips).toEqual([
      ["API", "https://apistage.example.app", "Open Odin's API preview"],
      ["Mate", "https://matedev.example.app", "Open Odin's Mate dev"],
      ["Runner", null, null],
    ]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
