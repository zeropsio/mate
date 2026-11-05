import { describe, expect, it } from "vite-plus/test";

import { isWarmedRouteModule, precacheList, type BundleChunk } from "./appShellBuild.logic";

const chunk = (fileName: string, rest: Partial<BundleChunk> = {}): BundleChunk => ({
  fileName,
  isEntry: false,
  imports: [],
  moduleIds: [`/src/${fileName}.tsx`],
  css: [],
  ...rest,
});

describe("the files a page boots and warms from", () => {
  const chunks = [
    chunk("assets/index.js", {
      isEntry: true,
      imports: ["assets/startup.js"],
      css: ["assets/index.css"],
    }),
    chunk("assets/startup.js"),
    chunk("assets/settings.js", {
      moduleIds: ["/src/routes/settings.tsx?tsr-split=component"],
      imports: ["assets/shared.js"],
    }),
    chunk("assets/shared.js"),
    chunk("assets/AgentsPanel.js", { moduleIds: ["/src/components/AgentsPanel.tsx"] }),
    chunk("assets/kit.js", { moduleIds: ["/src/routes/kit.tsx?tsr-split=component"] }),
    chunk("assets/grammar-rust.js", { moduleIds: ["/node_modules/shiki/rust.mjs"] }),
  ];
  const warmed = new Set([
    "/src/routes/settings.tsx?tsr-split=component",
    "/src/components/AgentsPanel.tsx",
  ]);

  it("lists the entry with its CSS and static imports, and every warmed surface with its imports", () => {
    expect(precacheList(chunks, warmed)).toEqual([
      "/assets/AgentsPanel.js",
      "/assets/index.css",
      "/assets/index.js",
      "/assets/settings.js",
      "/assets/shared.js",
      "/assets/startup.js",
    ]);
  });

  it.each([
    {
      title: "a route's split code is warmed",
      id: "/src/routes/settings.general.tsx?tsr-split=component",
      warmed: true,
    },
    {
      title: "the design kit's split code is not warmed",
      id: "/src/routes/kit.tsx?tsr-split=component",
      warmed: false,
    },
    {
      title: "a route file itself is not split code",
      id: "/src/routes/settings.general.tsx",
      warmed: false,
    },
  ])("$title", ({ id, warmed }) => {
    expect(isWarmedRouteModule(id)).toBe(warmed);
  });
});
