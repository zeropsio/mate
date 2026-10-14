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

  it("offers a card one door into the sheet: Add your domain while production has none of its own", async () => {
    const card = await mount("production", inAccount({ prod: place([]) }));
    expect(button(card, "Add your domain")).not.toBeNull();
    expect(button(card, "Manage addresses")).toBeNull();

    const page = await mount("production", inAccount({ prod: place([]) }), true);
    expect(button(page, "Add your domain")).not.toBeNull();
    expect(button(page, "Manage addresses")).not.toBeNull();
  });

  it("offers no Manage addresses outside an account, where no sheet can read a place", async () => {
    const container = await mount("production");
    expect(button(container, "Manage addresses")).toBeNull();
  });

  it("Add your domain on a production with no domain of its own opens the sheet to add one", async () => {
    const container = await mount("production", inAccount({ prod: place([]) }));
    await press(button(container, "Add your domain"));
    expect(useAddressesSheet.getState().target).toEqual({
      orgId: "org",
      projectId: "prod",
      groupId: "shop",
      intent: "add-domain",
    });
  });

  it.each([
    ["has a domain of its own", place([domain("shop.acme.com", "live")])],
    ["is still being read", reading("reading")],
  ])("offers no Add your domain while production %s", async (_case, read) => {
    const container = await mount("production", inAccount({ prod: read }));
    expect(button(container, "Add your domain")).toBeNull();
    expect(button(container, "Manage addresses")).not.toBeNull();
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
