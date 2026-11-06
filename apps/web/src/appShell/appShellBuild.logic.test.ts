import { describe, expect, it } from "vite-plus/test";

import { precacheList, type BundleChunk } from "./appShellBuild.logic";

const chunk = (fileName: string, rest: Partial<BundleChunk> = {}): BundleChunk => ({
  fileName,
  isEntry: false,
  imports: [],
  dynamicImports: [],
  css: [],
  assets: [],
  ...rest,
});

describe("the files a page may load while it runs", () => {
  const chunks = [
    chunk("assets/index.js", {
      isEntry: true,
      imports: ["assets/startup.js"],
      dynamicImports: ["assets/settings.js", "assets/highlighter.js"],
      css: ["assets/index.css"],
    }),
    chunk("assets/startup.js"),
    // A route the warmer loads, and a review diff nested lazily inside it.
    chunk("assets/settings.js", {
      imports: ["assets/index.js"],
      dynamicImports: ["assets/ReviewCommentDiff.js"],
    }),
    chunk("assets/ReviewCommentDiff.js", {
      imports: ["assets/startup.js"],
      assets: ["assets/diff-worker.js"],
    }),
    // The highlighter refers to the entry; its grammars refer to nothing that changes.
    chunk("assets/highlighter.js", {
      imports: ["assets/index.js"],
      dynamicImports: ["assets/grammar-rust.js"],
    }),
    chunk("assets/grammar-rust.js"),
    // A chunk that only refers to a changing chunk by dynamic import changes with it.
    chunk("assets/loader.js", { dynamicImports: ["assets/settings.js"] }),
    chunk("assets/unreached.js", { imports: ["assets/index.js"] }),
  ];

  it("lists every chunk reachable through static or dynamic imports whose name changes with the build, with its CSS and URL-imported files", () => {
    expect(precacheList(chunks)).toEqual([
      "/assets/ReviewCommentDiff.js",
      "/assets/diff-worker.js",
      "/assets/highlighter.js",
      "/assets/index.css",
      "/assets/index.js",
      "/assets/settings.js",
      "/assets/startup.js",
    ]);
  });
});
