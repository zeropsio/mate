import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { PublicAccessView } from "~/zerops/usePublicAccess";
import { StopPublicAccessLinks } from "./StopPublicAccess";

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
