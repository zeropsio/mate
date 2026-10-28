// @vitest-environment happy-dom
import type { AddressDomain, DomainFace, PlaceAddresses } from "@t3tools/client-runtime/data";
import type { GroupFlowAddress } from "@t3tools/client-runtime/zerops";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useAddressesSheet } from "~/zerops/addressesSheet";
import {
  placeAddresses as reading,
  withPlaceAddresses as inAccount,
} from "~/zerops/__fixtures__/placeAddresses";

import { PlacePanel, type PlacePanelModel } from "./PlacePanel";

const modelOf = (
  addresses: ReadonlyArray<GroupFlowAddress>,
  kind: "production" | "stage" = "production",
): PlacePanelModel => ({
  line: {
    projectId: kind === "production" ? "prod" : "stage",
    kind,
    name: kind === "production" ? "prod" : "stage",
    dot: "running",
    words: ["Runs v3"],
    trouble: false,
    addresses,
  },
  version: "v3",
  note: undefined,
  brought: [],
  services: [],
});

const panel = (addresses: ReadonlyArray<GroupFlowAddress>) =>
  renderToStaticMarkup(<PlacePanel actions={null} groupId="shop" model={modelOf(addresses)} />);

describe("a place's panel", () => {
  it("opens a place serving one service at its address, said whole", () => {
    const html = panel([{ service: "app", url: "https://shop.acme.com" }]);
    expect(html).toContain('aria-label="Open Production"');
    expect(html).toContain(">shop.acme.com<");
  });

  // A production serving a backend and a storefront opened whichever sorted first, the backend.
  it("opens a place serving several services by a door each, named by its service", () => {
    const html = panel([
      { service: "api", url: "https://api.acme.com" },
      { service: "shop", url: "https://shop.acme.com" },
    ]);
    expect(html).toContain('aria-label="Open api on Production"');
    expect(html).toContain('aria-label="Open shop on Production"');
    expect(html).toContain('href="https://shop.acme.com"');
    expect(html).not.toContain('aria-label="Open Production"');
  });
});

it("a card names what its production runs, its address and its services", () => {
  const html = renderToStaticMarkup(
    <PlacePanel
      actions={null}
      groupId="shop"
      model={{
        ...modelOf([{ service: "app", url: "https://shop.acme.com" }]),
        line: {
          ...modelOf([{ service: "app", url: "https://shop.acme.com" }]).line,
          words: ["Running", "v0.1.59", "up 19d"],
        },
        services: [
          { hostname: "app", state: "up" },
          { hostname: "db", state: "up" },
          { hostname: "worker", state: "down" },
        ],
      }}
    />,
  );
  const text = html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
  expect(text).toContain("Running · v0.1.59 · up 19d");
  expect(html).toContain('href="https://shop.acme.com"');
  expect(text).toContain("app db worker failed");
});

it("a service holding no deploy is never shown as up beside one that runs", () => {
  const html = renderToStaticMarkup(
    <PlacePanel
      actions={null}
      groupId="shop"
      model={{
        ...modelOf([]),
        services: [
          { hostname: "app", state: "up" },
          { hostname: "flip", state: "idle" },
        ],
      }}
    />,
  );
  const text = html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
  expect(text).toContain("app flip nothing deployed");
});

describe("a place's addresses on its panel", () => {
  const unmounts: Array<() => void> = [];
  afterEach(() => {
    for (const unmount of unmounts.splice(0)) unmount();
    useAddressesSheet.getState().close();
    vi.unstubAllGlobals();
  });

  const LISTED = [{ service: "app", url: "https://app-1a2b-3000.prg1.zerops.app" }];
  const domain = (domainName: string, face: DomainFace): AddressDomain => ({
    routingId: `r-${domainName}`,
    domainName,
    routingDomains: [domainName],
    targets: [{ serviceId: "app", serviceName: "app", port: 3000, path: "/" }],
    sslEnabled: true,
    face,
    url: `https://${domainName}`,
    resolvedIps: [],
    nameServers: [],
  });
  const place = (domains: ReadonlyArray<AddressDomain>): PlaceAddresses => ({
    ...reading([]),
    domains,
    zerops: [
      {
        serviceId: "app",
        serviceName: "app",
        on: true,
        hosts: [
          {
            port: 3000,
            url: "https://app-1a2b-3000.prg1.zerops.app",
            host: "app-1a2b-3000.prg1.zerops.app",
          },
        ],
        port: 3000,
      },
    ],
  });

  async function mount(
    kind: "production" | "stage",
    wrap: (children: ReactNode) => ReactNode = (children) => children,
    roomy = false,
  ) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        wrap(
          <PlacePanel actions={null} groupId="shop" model={modelOf(LISTED, kind)} roomy={roomy} />,
        ),
      );
    });
    unmounts.push(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
    });
    return container;
  }
  const button = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll("button")].find((each) => each.textContent === name) ?? null;
  async function press(element: HTMLElement | null) {
    await act(async () => {
      element?.click();
    });
  }

  it.each([
    ["production", "prod"],
    ["stage", "stage"],
  ] as const)(
    "Manage addresses on %s's panel opens the addresses sheet on that place, in its application",
    async (kind, projectId) => {
      const container = await mount(kind, inAccount({ [projectId]: place([]) }), true);
      await press(button(container, "Manage addresses"));
      expect(useAddressesSheet.getState().target).toEqual({
        orgId: "org",
        projectId,
        groupId: "shop",
      });
    },
  );

  it("offers a card one door into the sheet: Put it on your domain while production has none of its own", async () => {
    const card = await mount("production", inAccount({ prod: place([]) }));
    expect(button(card, "Put it on your domain")).not.toBeNull();
    expect(button(card, "Manage addresses")).toBeNull();

    const page = await mount("production", inAccount({ prod: place([]) }), true);
    expect(button(page, "Put it on your domain")).not.toBeNull();
    expect(button(page, "Manage addresses")).not.toBeNull();
  });

  // The live audit (2026-10-28): Larkspur's empty production stood with green service dots
  // and *Manage addresses*, like a live one.
  it.each(["production", "stage"] as const)(
    "An environment with nothing deployed shows its title and its state word only: %s",
    async (kind) => {
      const projectId = kind === "production" ? "prod" : "stage";
      const model = modelOf([], kind);
      const container = document.createElement("div");
      document.body.append(container);
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          inAccount({ [projectId]: place([]) })(
            <PlacePanel
              actions={<button type="button">History</button>}
              groupId="shop"
              model={{
                ...model,
                version: undefined,
                line: {
                  ...model.line,
                  dot: "none",
                  words: [kind === "production" ? "Not released yet" : "Not deployed yet"],
                  nothingDeployed: true,
                },
                services: [
                  { hostname: "db", state: "up" },
                  { hostname: "flip", state: "idle" },
                ],
              }}
              roomy
            />,
          ),
        );
      });
      unmounts.push(() => {
        act(() => {
          root.unmount();
        });
        container.remove();
      });
      expect(container.textContent).toBe(
        kind === "production" ? "ProductionNot released yet" : "StageNot deployed yet",
      );
    },
  );

  it("offers no Manage addresses on a page until something serves there", async () => {
    const model = modelOf(LISTED);
    const container = document.createElement("div");
    document.body.append(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        inAccount({ prod: place([]) })(
          <PlacePanel
            actions={null}
            groupId="shop"
            model={{
              ...model,
              version: undefined,
              line: { ...model.line, dot: "releasing", words: ["Releasing v0.1.0"] },
            }}
            roomy
          />,
        ),
      );
    });
    unmounts.push(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
    });
    expect(button(container, "Manage addresses")).toBeNull();
  });

  it("offers no Manage addresses outside an account, where no sheet can read a place", async () => {
    const container = await mount("production");
    expect(button(container, "Manage addresses")).toBeNull();
  });

  it("Put it on your domain on a production with no domain of its own opens the sheet to add one", async () => {
    const container = await mount("production", inAccount({ prod: place([]) }));
    await press(button(container, "Put it on your domain"));
    expect(useAddressesSheet.getState().target).toEqual({
      orgId: "org",
      projectId: "prod",
      groupId: "shop",
      intent: "add-domain",
    });
  });

  it.each([
    ["has a domain of its own", place([domain("shop.acme.com", "live")]), "Manage addresses"],
    // Read, its door names what it opens once: no "Manage addresses" that turns into another.
    ["is still being read", reading("reading"), undefined],
  ])("offers no Put it on your domain while production %s", async (_case, read, door) => {
    const container = await mount("production", inAccount({ prod: read }));
    expect(button(container, "Put it on your domain")).toBeNull();
    expect(button(container, "Manage addresses") === null).toBe(door === undefined);
  });

  // The run: Stage offered "Manage addresses" while it said "Not deployed yet", beside
  // production's "Put it on your domain" — two names for one door, one with nothing behind it.
  it("offers a stage's card no door into the sheet: its address heads it, its page manages it", async () => {
    const card = await mount("stage", inAccount({ stage: place([]) }));
    expect(card.querySelector('[aria-label="Open Stage"]')).not.toBeNull();
    expect(button(card, "Manage addresses")).toBeNull();
    expect(button(card, "Put it on your domain")).toBeNull();
  });

  it("is headed by its own domain once it answers, and says how far one not live yet is", async () => {
    const container = await mount(
      "stage",
      inAccount({
        stage: place([domain("acme.com", "live"), domain("shop.acme.com", "dns")]),
      }),
    );
    expect(container.querySelector('[aria-label="Open Stage"]')?.getAttribute("href")).toBe(
      "https://acme.com",
    );
    expect(container.textContent).toContain("shop.acme.com · Waiting for your DNS");
  });
});

// With the card's "Putting v0.1.0 live" block gone, nothing on it opened a release on its way.
describe("a place's line that opens what it says", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const releasing: PlacePanelModel = {
    ...modelOf([]),
    line: { ...modelOf([]).line, dot: "releasing", words: ["Releasing v0.1.0"] },
  };

  it("opens a release on its way from production's line, which says it as it did", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const opened: HTMLElement[] = [];
    await act(async () => {
      root.render(
        <PlacePanel
          actions={null}
          groupId="shop"
          model={releasing}
          onOpenLine={(from) => {
            opened.push(from);
          }}
        />,
      );
    });
    const line = [...container.querySelectorAll("button")].find(
      (each) => each.textContent === "Releasing v0.1.0",
    );
    await act(async () => {
      line?.click();
    });
    expect(opened).toEqual([line]);
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("is words alone where it opens nothing", () => {
    const html = renderToStaticMarkup(
      <PlacePanel actions={null} groupId="shop" model={releasing} />,
    );
    expect(html).toContain("Releasing v0.1.0");
    expect(html).not.toContain("<button");
  });
});
