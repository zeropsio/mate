import type { GroupFlowAddress } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PlacePanel, type PlacePanelModel } from "./PlacePanel";

const panel = (addresses: ReadonlyArray<GroupFlowAddress>) => {
  const model: PlacePanelModel = {
    line: {
      projectId: "prod",
      kind: "production",
      name: "prod",
      dot: "running",
      words: ["Runs v3"],
      trouble: false,
      addresses,
    },
    version: "v3",
    note: undefined,
    brought: [],
    services: [],
  };
  return renderToStaticMarkup(<PlacePanel actions={null} model={model} />);
};

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
