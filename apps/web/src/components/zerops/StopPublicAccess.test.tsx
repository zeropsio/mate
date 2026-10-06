import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { PublicAccessView } from "~/zerops/usePublicAccess";
import { StopPublicAccessLinks, StopPublicAccessStatus } from "./StopPublicAccess";

const WEB: ZeropsPublicRoute = {
  service: "web",
  port: 80,
  url: "https://web.example.test",
  host: "web.example.test",
};
const SHOP: ZeropsPublicRoute = {
  service: "web",
  port: 80,
  url: "https://shop.example.test",
  host: "shop.example.test",
};

const access = (patch: Partial<PublicAccessView>): PublicAccessView => ({
  state: "ready",
  routes: [],
  pending: [],
  offers: [],
  readsProject: false,
  bound: true,
  again: () => {},
  ...patch,
});

describe("a stop's public addresses", () => {
  it.each<{
    readonly name: string;
    readonly access: PublicAccessView;
    readonly says: ReadonlyArray<string>;
    readonly never: ReadonlyArray<string>;
  }>([
    {
      name: "not read yet: says reading, never no addresses",
      access: access({ state: "reading" }),
      says: ["Reading public addresses"],
      never: ["None yet", "Again"],
    },
    {
      name: "refused: names the failure and offers Again",
      access: access({ state: "failed" }),
      says: ["Could not read public addresses", "Again"],
      never: ["None yet"],
    },
    {
      name: "a partial read keeps known links beside the reading notice",
      access: access({ state: "reading", routes: [WEB] }),
      says: ["Reading public addresses", 'href="https://web.example.test"'],
      never: ["None yet", "Again"],
    },
    {
      name: "read: each address that serves is a link",
      access: access({ routes: [WEB] }),
      says: ['href="https://web.example.test"', "web.example.test"],
      never: ["Reading", "Publishing"],
    },
    {
      name: "an address not in place yet is said to be publishing, never a link",
      access: access({ routes: [WEB], pending: [SHOP] }),
      says: ["Publishing shop.example.test", 'href="https://web.example.test"'],
      never: ['href="https://shop.example.test"'],
    },
  ])("$name", ({ access: view, says, never }) => {
    const html = renderToStaticMarkup(<StopPublicAccessLinks access={view} />);
    for (const words of says) expect(html).toContain(words);
    for (const words of never) expect(html).not.toContain(words);
  });
});

describe("a service's pending addresses", () => {
  // A pending routing targets this service on port 80.
  // Hold its sync pending, and add a neighbour to prove the serviceStackId boundary.
  const recorded = {
    service: "appstage",
    serviceId: "routing-service",
    port: 80,
    host: "appstage-demo.prg1.zerops.app",
    url: "https://appstage-demo.prg1.zerops.app",
  };
  const neighbour = {
    ...recorded,
    serviceId: "other-service",
    host: "other.example.test",
    url: "https://other.example.test",
  };
  it.each([
    {
      name: "recorded service",
      serviceId: recorded.serviceId,
      shown: [recorded.host],
      hidden: [neighbour.host],
    },
    {
      name: "different service with the same hostname",
      serviceId: neighbour.serviceId,
      shown: [neighbour.host],
      hidden: [recorded.host],
    },
    {
      name: "service not resolved",
      serviceId: null,
      shown: [],
      hidden: [recorded.host, neighbour.host, "Publishing"],
    },
    {
      name: "project summary",
      serviceId: undefined,
      shown: [recorded.host, neighbour.host],
      hidden: [],
    },
  ])("$name", ({ serviceId, shown, hidden }) => {
    const html = renderToStaticMarkup(
      <StopPublicAccessStatus
        access={access({ pending: [recorded, neighbour] })}
        serviceId={serviceId}
      />,
    );
    for (const host of shown) expect(html).toContain(host);
    for (const host of hidden) expect(html).not.toContain(host);
  });
});
