import { assert, describe, it } from "@effect/vitest";

import serverPackageJson from "../package.json" with { type: "json" };

import {
  buildReleaseManifest,
  findUndeclaredStaticImports,
  RELEASE_PACKAGE_NAME,
} from "./releaseManifest.ts";

const sourceManifest = {
  repository: { type: "git", url: "https://github.com/zeropsio/mate", directory: "apps/server" },
  bin: { z3: "./dist/bin.mjs" },
  type: "module",
  version: "0.0.0-workspace",
  engines: { node: "^22.16 || ^23.11 || >=24.10" },
  files: ["dist"],
  dependencies: {
    "@anthropic-ai/claude-agent-sdk": "^0.3.170",
    "@ff-labs/fff-node": "0.9.4",
    effect: "catalog:",
    "msgpackr-extract": "3.0.4",
    "node-pty": "^1.1.0",
  },
} as const;

const catalog = { effect: "4.0.0-beta.103" };

describe("buildReleaseManifest", () => {
  it("carries the release identity, not the workspace one", () => {
    const manifest = buildReleaseManifest({
      serverPackageJson: sourceManifest,
      catalog,
      version: "0.1.8",
    });

    assert.strictEqual(manifest.name, RELEASE_PACKAGE_NAME);
    assert.strictEqual(manifest.version, "0.1.8");
    assert.deepStrictEqual(manifest.bin, { z3: "./dist/bin.mjs" });
    assert.deepStrictEqual(manifest.files, ["dist"]);
    assert.deepStrictEqual(manifest.engines, sourceManifest.engines);
    assert.strictEqual(manifest.type, "module");
  });

  // The whole point: everything the bundler inlined is dead weight in the
  // manifest, and npm downloads it anyway. Measured on 0.1.7 — 159 packages,
  // 500 MB installed, of which 210 MB is a Claude binary the bundle never loads.
  it("declares only what the bundle still resolves from disk", () => {
    const manifest = buildReleaseManifest({
      serverPackageJson: sourceManifest,
      catalog,
      version: "0.1.8",
    });

    assert.deepStrictEqual(manifest.dependencies, {
      "@ff-labs/fff-node": "0.9.4",
      "msgpackr-extract": "3.0.4",
      "node-pty": "^1.1.0",
    });
  });

  // A native dependency that is one day catalogued still has to land as a
  // concrete version — npm cannot read `catalog:`. The inlined ones are dropped
  // before resolution, so their specs never need to resolve at all.
  it("resolves catalog specs for the dependencies it keeps", () => {
    const manifest = buildReleaseManifest({
      serverPackageJson: {
        ...sourceManifest,
        dependencies: { "node-pty": "catalog:", effect: "catalog:" },
      },
      catalog: { "node-pty": "1.1.0" },
      version: "0.1.8",
    });

    assert.deepStrictEqual(manifest.dependencies, { "node-pty": "1.1.0" });
  });

  // npm applies `overrides` only from the root project, never from an installed
  // dependency's manifest. Measured: 0.1.7 ships `"@anthropic-ai/claude-agent-sdk
  // >…-darwin-arm64": "-"` and npm installed that 192 MB package regardless.
  it("ships no overrides block", () => {
    const manifest = buildReleaseManifest({
      serverPackageJson: sourceManifest,
      catalog,
      version: "0.1.8",
    });

    assert.notProperty(manifest, "overrides");
  });

  it("prunes the real server manifest to its three native roots", () => {
    const manifest = buildReleaseManifest({
      serverPackageJson,
      catalog: {},
      version: "0.1.8",
    });

    assert.deepStrictEqual(Object.keys(manifest.dependencies).sort(), [
      "@ff-labs/fff-node",
      "msgpackr-extract",
      "node-pty",
    ]);
  });
});

// The prune is only safe while the manifest still declares everything the
// emitted bundle imports statically. A static import that resolves to nothing
// kills the process at load, on the container, after the release is out — so
// the pack command reads the artifact instead of trusting the bundler config.
describe("findUndeclaredStaticImports", () => {
  const declared = { "node-pty": "^1.1.0", "@ff-labs/fff-node": "0.9.4" };

  it("reports nothing when every static import is declared", () => {
    assert.deepStrictEqual(
      findUndeclaredStaticImports(declared, [`import { spawn } from "@ff-labs/fff-node";\n`]),
      [],
    );
  });

  it("reports a package the bundle imports but the manifest dropped", () => {
    assert.deepStrictEqual(
      findUndeclaredStaticImports(declared, [`import { Effect } from "effect";\n`]),
      ["effect"],
    );
  });

  it("scans every chunk, not just the entry point", () => {
    assert.deepStrictEqual(
      findUndeclaredStaticImports(declared, [
        `import { a } from "node-pty";\n`,
        `import { b } from "yaml";\n`,
      ]),
      ["yaml"],
    );
  });

  it("matches a subpath import against its declared root", () => {
    assert.deepStrictEqual(
      findUndeclaredStaticImports(declared, [`import { x } from "node-pty/lib/terminal";\n`]),
      [],
    );
  });

  it("reports each undeclared package once, sorted", () => {
    assert.deepStrictEqual(
      findUndeclaredStaticImports(declared, [
        `import { a } from "yaml";\nimport { b } from "effect/Option";\n`,
        `import { c } from "yaml";\n`,
      ]),
      ["effect", "yaml"],
    );
  });
});
