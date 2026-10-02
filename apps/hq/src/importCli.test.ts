// @effect-diagnostics nodeBuiltinImport:off -- the bundles are temp directories.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { STAGE_TIER, syntheticBundle } from "../test/harness/bundle.ts";
import { checkCommand, importArgs } from "./importCli.ts";

const tempDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-bundle-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

describe("hq import", () => {
  it.effect(
    "--check names a bundle it accepts by its digest, and lists every finding against one it refuses",
    () =>
      Effect.gen(function* () {
        const written = yield* syntheticBundle(yield* tempDir);
        const accepted = yield* checkCommand(written.dir);
        assert.deepStrictEqual(accepted, {
          code: 0,
          lines: [
            `bundle ${written.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
          ],
        });
        NodeFS.writeFileSync(NodePath.join(written.dir, "notes.txt"), "x");
        NodeFS.appendFileSync(NodePath.join(written.dir, "attachments", "u1.png"), "x");
        const refused = yield* checkCommand(written.dir);
        assert.deepStrictEqual(refused, {
          code: 1,
          lines: [
            "bundle refused:",
            "  notes.txt is not in the manifest",
            "  attachments/u1.png is not what was frozen",
          ],
        });
      }).pipe(Effect.scoped),
  );

  it.effect("--check notes a tier building from a repository the bundle does not bring", () =>
    Effect.gen(function* () {
      const lacking =
        "  - hostname: admin\n    buildFromGit: https://gitea.example/shop/admin.git\n    zeropsSetup: admin\n";
      const written = yield* syntheticBundle(
        yield* tempDir,
        undefined,
        undefined,
        STAGE_TIER + lacking,
      );
      assert.deepStrictEqual(yield* checkCommand(written.dir), {
        code: 0,
        lines: [
          `bundle ${written.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
          "  note: app g1 3 — Stage/import.yaml: line 14 builds from shop/admin on Gitea, which the bundle does not bring",
        ],
      });
    }).pipe(Effect.scoped),
  );

  it.each([
    [["--check", "/b"], { kind: "check", dir: "/b" }],
    [["/b"], { kind: "import", dir: "/b" }],
    [["--check"], { kind: "usage" }],
    [[], { kind: "usage" }],
    [["/b", "/c"], { kind: "usage" }],
    [["--force", "/b"], { kind: "usage" }],
  ])("reads import %j as %j", (args, expected) => {
    assert.deepStrictEqual(importArgs(args), expected);
  });
});
