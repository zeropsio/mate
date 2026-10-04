import * as NodeURL from "node:url";

import { build } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

/** Every chunk Vite emits for `devHooks.ts` built in `mode`, joined. */
async function bundledIn(mode: "production" | "development"): Promise<string> {
  // Vite reads `import.meta.env.DEV` off NODE_ENV, which the test runner sets
  // to `test`; a real `vite build` runs with the mode's own.
  const runnerNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;
  const output = await build({
    configFile: false,
    logLevel: "silent",
    mode,
    build: {
      write: false,
      minify: false,
      lib: {
        entry: NodeURL.fileURLToPath(new URL("./devHooks.ts", import.meta.url)),
        formats: ["es"],
      },
    },
  }).finally(() => {
    process.env.NODE_ENV = runnerNodeEnv;
  });
  const outputs = Array.isArray(output) ? output : [output];
  return outputs
    .flatMap((result) => ("output" in result ? result.output : []))
    .map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
    .join("\n");
}

describe("the dev-only session hook", () => {
  // The hook signs a tab in with any session handed to it; a production
  // bundle must not carry it at all.
  it("is absent from a production bundle", async () => {
    expect(await bundledIn("production")).not.toContain("__mateDev");
  }, 60_000);

  // The other half, so the assertion above can fail: the same build in
  // development mode does carry it.
  it("is present in a development bundle", async () => {
    expect(await bundledIn("development")).toContain("__mateDev");
  }, 60_000);
});
