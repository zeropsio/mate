// @effect-diagnostics nodeBuiltinImport:off -- a bundle is files written as the exporter writes them.
/**
 * A migration bundle (`importBundle.ts`) as main's exporter would write one, in miniature: one
 * application, `Shop`, with two Mates, a stage and a production; its `group` repository, tagged
 * `v0.1.0`, and `appdev`, holding a merged change (1, Ada's, with a person's comment), a closed one
 * (2, Bea's) and an open one (3, Ada's, with her own comment and a picture its description links).
 * Its recipe's stage tier builds two runtimes, `appstage` and `workerstage`, and its production
 * tier `app`, all from `appdev` on main's Gitea (`gitea.example`, the org `shop`).
 * `tweak` changes the files' contents, and `picture` the picture's bytes, before they are frozen.
 *
 * @module test/harness/bundle
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { gitClient } from "./gitClient.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A PNG's signature and a little more: a picture as HQ checks one. */
export const PICTURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

/** Main's Gitea, as Shop's tiers name it. */
export const GITEA = { host: "gitea.example", owner: "shop" };

/** Shop's stage tier as main wrote it: two runtimes built from its own `appdev`, and a database. */
export const STAGE_TIER = [
  "# Shop's stage.",
  "services:",
  "  - hostname: appstage",
  "    type: nodejs@22",
  "    buildFromGit: https://gitea.example/shop/appdev.git",
  "    zeropsSetup: app",
  "  - hostname: workerstage",
  "    type: nodejs@22",
  "    buildFromGit: https://gitea.example/shop/appdev",
  "    zeropsSetup: worker",
  "  - hostname: db",
  "    type: postgresql@16",
  "",
].join("\n");

/** Shop's production tier: `app`, built from `appdev`. */
export const PRODUCTION_TIER = [
  "services:",
  "  - hostname: app",
  "    type: nodejs@22",
  "    buildFromGit: https://gitea.example/shop/appdev.git",
  "    zeropsSetup: app",
  "",
].join("\n");

/** Where main's Gitea served the picture: as the description spells it. */
export const PICTURE_URL = "https://gitea.example/attachments/5f1c2b9a-0d3e-4c55-9b8f-2a7e6d1c0b3a";

export interface BundleParts {
  readonly mapping: Record<string, unknown>;
  readonly changes: Record<string, unknown>;
  readonly releases: Record<string, unknown>;
}

const sha256 = (path: string) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");

export const syntheticBundle = (
  root: string,
  tweak: (parts: BundleParts) => BundleParts = (parts) => parts,
  picture: Uint8Array = PICTURE,
  stageTier: string = STAGE_TIER,
) =>
  Effect.gen(function* () {
    const git = yield* gitClient;
    const repo = (name: string) =>
      Effect.gen(function* () {
        const path = NodePath.join(git.dir, name);
        yield* git.checked(["init", "-q", "-b", "main", path]);
        const empty = yield* git.checked(["hash-object", "-w", "-t", "tree", "/dev/null"], path);
        const commit = (message: string, parent?: string) =>
          git.checked(
            ["commit-tree", empty, ...(parent === undefined ? [] : ["-p", parent]), "-m", message],
            path,
          );
        const ref = (name: string, sha: string) => git.checked(["update-ref", name, sha], path);
        return { path, commit, ref };
      });

    const appdev = yield* repo("appdev");
    const start = yield* appdev.commit("Start");
    const merged = yield* appdev.commit("Add a page", start);
    const squash = yield* appdev.commit("Add a page (#1)", start);
    const closed = yield* appdev.commit("Try a thing", start);
    const open = yield* appdev.commit("Rename it", squash);
    yield* appdev.ref("refs/heads/main", squash);
    for (const [n, sha] of [
      [1, merged],
      [2, closed],
      [3, open],
    ] as const) {
      yield* appdev.ref(`refs/hq-import/${String(n)}`, sha);
    }

    const group = yield* repo("group");
    const tiers = [
      { path: "3 — Stage/import.yaml", content: stageTier },
      { path: "4 — Small Production/import.yaml", content: PRODUCTION_TIER },
    ];
    for (const tier of tiers) {
      NodeFS.mkdirSync(NodePath.join(group.path, NodePath.dirname(tier.path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(group.path, tier.path), tier.content);
    }
    yield* git.checked(["add", "-A"], group.path);
    yield* git.checked(["commit", "-q", "-m", "Recipe"], group.path);
    const recipe = yield* git.checked(["rev-parse", "HEAD"], group.path);
    const message = `app ${squash}`;
    yield* git.checked(["tag", "-a", "v0.1.0", "-m", message, recipe], group.path);

    const dir = NodePath.join(root, "bundle");
    NodeFS.mkdirSync(NodePath.join(dir, "repos", "g1"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(dir, "attachments"));
    for (const [name, path] of [
      ["appdev", appdev.path],
      ["group", group.path],
    ] as const) {
      yield* git.checked(
        ["bundle", "create", "-q", NodePath.join(dir, "repos", "g1", `${name}.bundle`), "--all"],
        path,
      );
    }
    NodeFS.writeFileSync(NodePath.join(dir, "attachments", "u1.png"), picture);

    const at = (hour: number) => `2026-09-01T${String(hour).padStart(2, "0")}:00:00Z`;
    const change = (patch: Record<string, unknown>) => ({
      app: "g1",
      repo: "appdev",
      mateProjectId: "P_MATE",
      body: "",
      mergedSha: null,
      openedAt: at(9),
      mergedAt: null,
      closedAt: null,
      comments: [],
      attachments: [],
      ...patch,
    });
    const parts = tweak({
      mapping: {
        apps: [
          {
            key: "g1",
            name: "Shop",
            gitea: GITEA,
            tiers,
            projects: [
              {
                projectId: "P_MATE",
                kind: "mate",
                mate: { name: "Ada", face: "sky:pick", standupRequestedBy: null, closedOff: true },
              },
              {
                projectId: "P_BEA",
                kind: "mate",
                mate: { name: "Bea", face: "", standupRequestedBy: "owner", closedOff: true },
              },
              { projectId: "P_STAGE", kind: "stage", mate: null },
              { projectId: "P_PROD", kind: "production", mate: null },
            ],
            environments: [
              { projectId: "P_STAGE", name: "shop-stage", sources: ["main"] },
              { projectId: "P_PROD", name: "shop-production", sources: ["release"] },
            ],
            repos: [
              {
                name: "group",
                bundle: "repos/g1/group.bundle",
                refs: [
                  { ref: "refs/heads/main", sha: recipe },
                  { ref: "refs/tags/v0.1.0", sha: recipe },
                ],
              },
              {
                name: "appdev",
                bundle: "repos/g1/appdev.bundle",
                refs: [{ ref: "refs/heads/main", sha: squash }],
              },
            ],
          },
        ],
      },
      changes: {
        changes: [
          change({
            number: 1,
            title: "Add a page",
            body: "It adds a page.",
            state: "merged",
            head: merged,
            headRef: "refs/hq-import/1",
            mergedSha: squash,
            mergedAt: at(11),
            comments: [
              { author: { kind: "person", userId: "owner" }, body: "Looks good", at: at(10) },
            ],
          }),
          change({
            number: 2,
            mateProjectId: "P_BEA",
            title: "Try a thing",
            state: "closed",
            head: closed,
            headRef: "refs/hq-import/2",
            closedAt: at(12),
          }),
          change({
            number: 3,
            title: "Rename it",
            body: `Before and after: ![shot](${PICTURE_URL})`,
            state: "open",
            head: open,
            headRef: "refs/hq-import/3",
            comments: [
              { author: { kind: "mate", projectId: "P_MATE" }, body: "Renamed.", at: at(13) },
            ],
            attachments: [{ key: "u1", file: "attachments/u1.png", urls: [PICTURE_URL] }],
          }),
        ],
      },
      releases: {
        releases: [
          {
            app: "g1",
            tag: "v0.1.0",
            sha: recipe,
            state: "approved",
            reason: null,
            message,
            tagger: { login: "u-owner", userId: "owner" },
            at: at(14),
          },
        ],
      },
    });
    for (const [name, value] of Object.entries(parts)) {
      NodeFS.writeFileSync(NodePath.join(dir, `${name}.json`), encodeJson(value));
    }
    const files = Object.fromEntries(
      [
        "mapping.json",
        "changes.json",
        "releases.json",
        "repos/g1/group.bundle",
        "repos/g1/appdev.bundle",
        "attachments/u1.png",
      ].map((path) => [path, sha256(NodePath.join(dir, path))]),
    );
    NodeFS.writeFileSync(
      NodePath.join(dir, "manifest.json"),
      encodeJson({
        version: 1,
        orgId: "ORG",
        exportedAt: at(15),
        exportedBy: "owner",
        files,
      }),
    );
    return {
      dir,
      digest: sha256(NodePath.join(dir, "manifest.json")),
      shas: { start, merged, squash, closed, open, recipe },
    };
  });
