// @vitest-environment happy-dom
import {
  makeAccountStore,
  observeAccount,
  streamOf,
  type DetailDemand,
} from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import { hqFixtureWire } from "@t3tools/client-runtime/data/fixtures";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { AtomRegistry } from "effect/reactivity";
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
  demand: vi.fn(({ ownerId }: DetailDemand) => {
    detail.held.add(ownerId);
    return () => {
      detail.held.delete(ownerId);
    };
  }),
}));
vi.mock("~/zerops/ZeropsAccountData", () => ({
  useAccountOrgId: () => detail.org,
  useProjection: () => detail.reads,
  useAccountDataOptional: () => ({ demandDetail: detail.demand }),
  useDetailDemand: () => {},
}));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0 }));
vi.mock("@tanstack/react-router", async (original) => {
  const { createElement } = await import("react");
  return {
    ...(await original<typeof import("@tanstack/react-router")>()),
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
vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSessionOptional: () => ({
    status: "signed-in",
    user: { id: "ada", email: "ada@example.test", firstName: "Ada" },
    organizations: [{ id: "org", name: "Org", membershipId: "member" }],
    activeOrganization: { id: "org", name: "Org", membershipId: "member" },
    selectOrganization: async () => {},
    signOut: async () => {},
  }),
}));
vi.mock("~/zerops/chiefSetup", async (original) => ({
  ...(await original<typeof import("~/zerops/chiefSetup")>()),
  useChiefOffer: () => undefined,
}));
vi.mock("~/components/ui/sidebar", async (original) => ({
  ...(await original<typeof import("~/components/ui/sidebar")>()),
  useSidebar: () => ({ isMobile: false, setOpenMobile: () => {} }),
}));

import { MateRow } from "../system/MateRow";
import { ProjectCards } from "./ProjectCards";
import { cardMateReading } from "./projectCard.logic";
import { born, entry, FLOW_PROPS, item, placed, WREN } from "./flowTestFixtures";
import { SidebarZeropsAccountRow } from "../SidebarZeropsAccount";

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

it("a pending Mate's project card shows its shared birth phase and actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  const groups = born();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onContinue = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ProjectCards
          focusGroup={undefined}
          groups={groups}
          props={{
            ...FLOW_PROPS,
            renderComingBirth: (projectId: string) =>
              projectId === "vale-dev"
                ? {
                    line: "Project created · Quota reached.",
                    menu: <button onClick={onContinue}>Continue</button>,
                  }
                : undefined,
          }}
        />,
      ),
    );
    expect(container.textContent).toContain("Project created · Quota reached.");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click(),
    );
    expect(onContinue).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
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
      <ProjectCards focusGroup={undefined} groups={groups} props={{ ...FLOW_PROPS, groups }} />,
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

it("opening Usage releases Projects detail demand", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  detail.org = "org";
  detail.reads = { shop: { read: "read", failure: null } };
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const account = observeAccount({
    store,
    wire: { open: Effect.never },
    repairSession: Effect.void,
  });
  const hq = hqFixtureWire();
  const subscribed = Promise.withResolvers<void>();
  const unsubscribed = Promise.withResolvers<void>();
  const appDetails = new Set<string>();
  account.show("org");
  account.showHq({
    orgId: "org",
    wire: {
      ...hq.wire,
      open: (created) =>
        hq.wire.open(created).pipe(
          Effect.map((segment) => ({
            ...segment,
            send: (request) =>
              segment.send(request).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    if (request.type === "subscribe")
                      for (const { scope } of request.scopes)
                        if (scope.kind === "app-detail") appDetails.add(scope.appId);
                    if (request.type === "unsubscribe")
                      for (const scope of request.scopes)
                        if (scope.kind === "app-detail") appDetails.delete(scope.appId);
                    if (
                      request.type === "subscribe" &&
                      request.scopes.some(
                        ({ scope }) => scope.kind === "app-detail" && scope.appId === "shop",
                      )
                    )
                      subscribed.resolve();
                    if (
                      request.type === "unsubscribe" &&
                      request.scopes.some(
                        (scope) => scope.kind === "app-detail" && scope.appId === "shop",
                      )
                    )
                      unsubscribed.resolve();
                  }),
                ),
              ),
          })),
        ),
    },
  });
  detail.demand.mockImplementationOnce(account.demandDetail);
  const groups = [entry([item("Ada", placed("shop", "Shop"))])];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const demanded = () => streamOf(store.state(), "hq:org:hq-app-detail:shop").demanded;
  const routes = createRootRoute({
    component: () => (
      <>
        <SidebarZeropsAccountRow destinationIcon={() => null} chiefIcon={null} />
        <Outlet />
      </>
    ),
  });
  const projects = createRoute({
    getParentRoute: () => routes,
    path: "/zerops",
    component: () => (
      <ProjectCards focusGroup={undefined} groups={groups} props={{ ...FLOW_PROPS, groups }} />
    ),
  });
  const usage = createRoute({
    getParentRoute: () => routes,
    path: "/usage",
    component: () => <p data-testid="usage-page">Usage</p>,
  });
  const router = createRouter({
    routeTree: routes.addChildren([projects, usage]),
    history: createMemoryHistory({ initialEntries: ["/zerops"] }),
  });
  try {
    await router.load();
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.querySelector('[data-zerops-group="shop"]')).not.toBeNull();
    expect(demanded()).toBe(true);
    await act(async () => await subscribed.promise);
    expect([...appDetails]).toEqual(["shop"]);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-zerops-surface="sidebar-account"]')!
        .click();
    });
    await act(async () => {
      document.querySelector<HTMLElement>('[data-zerops-account-destination="usage"]')!.click();
    });
    expect(router.state.location.pathname).toBe("/usage");
    expect(container.querySelector('[data-testid="usage-page"]')?.textContent).toBe("Usage");
    expect(demanded()).toBe(false);
    await act(async () => await unsubscribed.promise);
    expect([...appDetails]).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    account.close();
    registry.dispose();
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
            <MateRow
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

/** One card, drawn whole, outside an account: each place by its panel, as the overview draws it. */
async function drawCard(group: ReturnType<typeof entry>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", VisibleCard);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<ProjectCards focusGroup={undefined} groups={[group]} props={FLOW_PROPS} />),
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

it("a Mate's row shows each part by its real hostname: a door to its preview, else to its dev, and a part with no address muted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const entry = (key: string, label: string, url?: string, why?: string) => ({
    key,
    label,
    service: key.slice(key.indexOf(":") + 1),
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
        <MateRow
          name="Orrin"
          face={null}
          time={null}
          onOpen={undefined}
          parts={[
            {
              key: "part:apipool",
              devService: "apipool",
              pooled: true,
              dev: [],
              preview: entry("preview:apistage", "preview", "https://apistage.example.app"),
            },
            {
              key: "part:matedev",
              devService: "matedev",
              pooled: false,
              dev: [entry("dev:matedev", "dev", "https://matedev.example.app")],
              preview: undefined,
            },
            {
              key: "part:runnerpool",
              devService: "runnerpool",
              pooled: true,
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
      ["apistage", "https://apistage.example.app", "Open Orrin's apistage"],
      ["matedev", "https://matedev.example.app", "Open Orrin's matedev"],
      ["runnerstage", null, null],
    ]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
