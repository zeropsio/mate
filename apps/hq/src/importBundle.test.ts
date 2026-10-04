// @effect-diagnostics nodeBuiltinImport:off -- the bundles are temp directories, tampered with on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { syntheticBundle } from "../test/harness/bundle.ts";
import { checkBundle } from "./importBundle.ts";

const tempDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-bundle-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

describe("a migration bundle", () => {
  it.effect("as the exporter writes one, is checked whole and named by its manifest's digest", () =>
    Effect.gen(function* () {
      const written = yield* syntheticBundle(yield* tempDir);
      const bundle = yield* checkBundle(written.dir);
      assert.deepStrictEqual(
        [
          bundle.digest,
          bundle.mapping.apps.map((app) => app.name),
          bundle.changes.map((change) => change.state),
          bundle.releases.map((release) => release.tag),
        ],
        [written.digest, ["Shop"], ["merged", "closed", "open"], ["v0.1.0"]],
      );
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    ["JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    ["GIF", new TextEncoder().encode("GIF89a")],
    ["WebP", new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
    ["AVIF", new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0])],
  ] as const)("preserves an imported %s attachment", ([, picture]) =>
    Effect.gen(function* () {
      const written = yield* syntheticBundle(yield* tempDir, undefined, picture);
      const bundle = yield* checkBundle(written.dir);
      assert.strictEqual(bundle.changes.flatMap((change) => change.attachments).length, 1);
    }).pipe(Effect.scoped),
  );

  type Parts = Parameters<NonNullable<Parameters<typeof syntheticBundle>[1]>>[0];
  type Row = Record<string, unknown>;
  const rows = (value: unknown) => value as Array<Row>;
  /** `parts` with the `n`th of `list` patched, every file else as written. */
  const patched =
    (list: "changes" | "releases", n: number, patch: Row) =>
    (parts: Parts): Parts => {
      const file = parts[list] as { readonly [key: string]: unknown };
      const items = rows(file[list]).map((item, i) => (i === n ? { ...item, ...patch } : item));
      return { ...parts, [list]: { [list]: items } };
    };
  const stageFollows =
    (sources: ReadonlyArray<string>) =>
    (parts: Parts): Parts => {
      const [app] = rows(parts.mapping["apps"]);
      const environments = rows(app?.["environments"]).map((env) =>
        env["projectId"] === "P_STAGE" ? { ...env, sources } : env,
      );
      return { ...parts, mapping: { apps: [{ ...app, environments }] } };
    };

  it.effect.each([
    {
      name: "a file changed after it was frozen",
      disk: (dir: string) =>
        NodeFS.appendFileSync(NodePath.join(dir, "attachments", "u1.png"), "x"),
      finding: "attachments/u1.png is not what was frozen",
    },
    {
      name: "a file the manifest does not name",
      disk: (dir: string) => NodeFS.writeFileSync(NodePath.join(dir, "notes.txt"), "x"),
      finding: "notes.txt is not in the manifest",
    },
    {
      name: "a picture that is no raster",
      picture: new Uint8Array([0x47, 0x49, 0x46, 0x38]),
      finding: "attachments/u1.png is no supported raster",
    },
    {
      name: "a change of a project that is no Mate",
      tweak: patched("changes", 1, { mateProjectId: "P_STAGE" }),
      finding: "change g1/appdev#2: P_STAGE is no Mate of its app",
    },
    {
      name: "a Mate with two open changes in a repository",
      tweak: patched("changes", 1, { mateProjectId: "P_MATE", state: "open", closedAt: null }),
      finding: "g1/appdev P_MATE has two open changes",
    },
    {
      name: "a merged change with no commit it landed",
      tweak: patched("changes", 0, { mergedSha: null }),
      finding: "change g1/appdev#1: its state and its times disagree",
    },
    {
      name: "a picture its change's description does not link",
      tweak: patched("changes", 2, {
        attachments: [{ key: "u1", file: "attachments/u1.png", urls: ["https://elsewhere"] }],
      }),
      finding: "change g1/appdev#3: attachment u1 is not linked as named",
    },
    {
      name: "a tag by no person",
      tweak: patched("releases", 0, { tagger: { login: "gitea-admin", userId: null } }),
      finding: "release g1 v0.1.0: tagged by gitea-admin, who is no person",
    },
    {
      name: "an approved release whose message lists none",
      tweak: patched("releases", 0, { message: "Ship it" }),
      finding: "release g1 v0.1.0: its message lists no release",
    },
    {
      name: "a stage following what HQ does not deploy",
      tweak: stageFollows(["main", "develop"]),
      finding: "app g1: environment shop-stage follows what HQ does not deploy",
    },
  ])("refuses $name, naming it", ({ disk, picture, tweak, finding }) =>
    Effect.gen(function* () {
      const written = yield* syntheticBundle(yield* tempDir, tweak, picture);
      disk?.(written.dir);
      const refused = yield* Effect.flip(checkBundle(written.dir));
      assert.include(refused.problems, finding);
    }).pipe(Effect.scoped),
  );
});
