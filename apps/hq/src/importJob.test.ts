// @effect-diagnostics nodeBuiltinImport:off -- bundles are temp directories; the repositories are read on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { PICTURE, PICTURE_URL, STAGE_TIER, syntheticBundle } from "../test/harness/bundle.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";
import { queueCommand } from "./importCli.ts";

const tempDir = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix))),
    (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );

/** `import <bundle>` as the migrating person runs it in the container, against Core's database. */
const importAs = (url: string, dir: string) =>
  queueCommand(dir, { follow: Duration.millis(50) }).pipe(
    Effect.provide(PgClient.layer({ url: Redacted.make(url) })),
  );

/** The refs of a repository in Core's git root, as `refname sha` lines. */
const refsOf = (gitRoot: string, appId: string, repo: string) =>
  NodeChildProcess.execFileSync(
    "git",
    [
      "-C",
      NodePath.join(gitRoot, appId, `${repo}.git`),
      "for-each-ref",
      "--format=%(refname) %(objectname)",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");

/** A file of a repository's `main` in Core's git root. */
const fileAt = (gitRoot: string, appId: string, repo: string, path: string) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-C", NodePath.join(gitRoot, appId, `${repo}.git`), "show", `main:${path}`],
    { encoding: "utf8" },
  );

/** `git log -1` of a repository's `main` in Core's git root: its message and its parents. */
const mainCommit = (gitRoot: string, appId: string, repo: string) => {
  const [parents = "", ...message] = NodeChildProcess.execFileSync(
    "git",
    ["-C", NodePath.join(gitRoot, appId, `${repo}.git`), "log", "-1", "--format=%P%n%B", "main"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  return { parents: parents.split(" "), message: message.join("\n") };
};

/** A service of an imported environment's project, running the version named `name`. */
const serviceIn = (world: FakeWorld, projectId: string, service: string, name: string) =>
  world.services.push({
    id: `S-${projectId}-${service}`,
    projectId,
    name: service,
    status: "ACTIVE",
    isSystem: false,
    subdomainAccess: false,
    http: true,
    named: { id: `V-${projectId}-${service}`, name },
    activeVersionId: `V-${projectId}-${service}`,
  });

describe("the migration's import", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("brings a bundle in whole, as the leader writes, and verifies it", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const gitRoot = yield* tempDir("hq-git-");
        const { call, fake, url, gitHost } = yield* startCore(true, { gitRoot, importRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
        yield* untilHealth(call, "active");
        const written = yield* syntheticBundle(importRoot);
        const short = (sha: string) => sha.slice(0, 7);
        // Main's stage runs appdev's head in one runtime and its first commit in the other;
        // production runs its release.
        serviceIn(fake, "P_STAGE", "appstage", `main ${short(written.shas.squash)}`);
        serviceIn(fake, "P_STAGE", "workerstage", `main ${short(written.shas.start)}`);
        serviceIn(fake, "P_PROD", "app", `v0.1.0 ${short(written.shas.squash)}`);

        const done = yield* importAs(url, written.dir);
        assert.deepStrictEqual(done, {
          code: 0,
          lines: [
            `bundle ${written.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
            `import ${written.digest} done and verified`,
            "  merged otherwise than by HQ's squash: none",
            "  Mates not enrolled yet: P_MATE, P_BEA",
            "  recipe notes: none",
            // Its tiers build from HQ now: what each environment runs is weighed against them.
            "  environments:",
            `    shop-stage: held: workerstage runs ${short(written.shas.start)}, wanted ${short(written.shas.squash)}`,
            "    shop-production: at its target",
          ],
        });

        const owner = yield* sessionFor(call, "door-owner");
        const [app] = (
          (yield* call("GET", "/api/structure", { session: owner })).body as {
            readonly apps: ReadonlyArray<{ readonly id: string; readonly name: string }>;
          }
        ).apps;
        assert.strictEqual(app?.name, "Shop");
        const appId = app?.id ?? "";
        const changes = (
          (yield* call("GET", `/api/apps/${appId}/changes`, { session: owner })).body as {
            readonly changes: ReadonlyArray<Record<string, unknown>>;
          }
        ).changes;
        assert.deepStrictEqual(
          changes
            .map((change) => [
              change["number"],
              change["state"],
              change["mateProjectId"],
              change["head"],
            ])
            .sort(),
          [
            [1, "merged", "P_MATE", written.shas.merged],
            [2, "closed", "P_BEA", written.shas.closed],
            [3, "open", "P_MATE", written.shas.open],
          ],
        );
        const comments = (number: number) =>
          Effect.map(
            call("GET", `/api/apps/${appId}/changes/appdev/${String(number)}/comments`, {
              session: owner,
            }),
            (answer) =>
              (
                answer.body as { readonly comments: ReadonlyArray<Record<string, unknown>> }
              ).comments.map((comment) => [
                comment["authorUserId"],
                comment["authorMateProjectId"],
                comment["body"],
              ]),
          );
        assert.deepStrictEqual(yield* comments(1), [["owner", null, "Looks good"]]);
        assert.deepStrictEqual(yield* comments(3), [[null, "P_MATE", "Renamed."]]);

        // The picture is HQ's now, and the description links it at HQ's address.
        const [open] = yield* rowsWhere(
          url,
          `SELECT body FROM hq_change WHERE number = 3`,
          (rows) => rows.length === 1,
        );
        const body = String(open?.["body"]);
        assert.notInclude(body, PICTURE_URL);
        const link = /https:\/\/hqzone\.prg1-zerops\.zone(\/api\/apps\/[^)]+)/u.exec(body)?.[1];
        const picture = yield* call("GET", link ?? "", { session: owner });
        assert.deepStrictEqual([picture.status, [...picture.bytes]], [200, [...PICTURE]]);

        const releases = (
          (yield* call("GET", `/api/apps/${appId}/releases`, { session: owner })).body as {
            readonly releases: ReadonlyArray<Record<string, unknown>>;
          }
        ).releases;
        assert.deepStrictEqual(
          releases.map((release) => [
            release["tag"],
            release["state"],
            release["by"],
            release["entries"],
          ]),
          [["v0.1.0", "approved", "owner", [{ service: "app", sha: written.shas.squash }]]],
        );

        assert.deepStrictEqual(refsOf(gitRoot, appId, "appdev"), [
          `refs/heads/main ${written.shas.squash}`,
          `refs/heads/mate/P_BEA/2 ${written.shas.closed}`,
          `refs/heads/mate/P_MATE/1 ${written.shas.merged}`,
          `refs/heads/mate/P_MATE/3 ${written.shas.open}`,
        ]);
        // The recipe builds from HQ: one commit of Core's on the bundle's main, its tiers' builds moved.
        const recipe = mainCommit(gitRoot, appId, "group");
        assert.deepStrictEqual(recipe, {
          parents: [written.shas.recipe],
          message: `Core: the recipe builds from HQ\n\nHQ-Import: ${written.digest}`,
        });
        const hq = `https://hqzone.prg1-zerops.zone/git/${appId}/appdev.git`;
        assert.strictEqual(
          fileAt(gitRoot, appId, "group", "3 — Stage/import.yaml"),
          STAGE_TIER.replace("https://gitea.example/shop/appdev.git", hq).replace(
            "https://gitea.example/shop/appdev",
            hq,
          ),
        );
        // What HQ saw of each tier is the rewritten one: the baseline later changes are weighed against.
        const digest = (path: string) =>
          NodeCrypto.createHash("sha256")
            .update(fileAt(gitRoot, appId, "group", path))
            .digest("hex");
        const seen = yield* rowsWhere(
          url,
          "SELECT tier, digest FROM hq_recipe_seen ORDER BY tier",
          (rows) => rows.length === 2,
        );
        assert.deepStrictEqual(
          seen.map((row) => [row["tier"], row["digest"]]),
          [
            ["production", digest("4 — Small Production/import.yaml")],
            ["stage", digest("3 — Stage/import.yaml")],
          ],
        );
        // An admin's first key: the pass that follows imports no service and deploys nothing.
        yield* rowsWhere(
          url,
          "INSERT INTO hq_deploy_token (project_id, token, kept_by) VALUES ('P_STAGE', 'key-stage', 'owner') RETURNING 1",
          (rows) => rows.length === 1,
        );
        fake.tokens.set("key-stage", {
          id: "T_STAGE",
          name: "deploy-shop-stage",
          orgId: "ORG",
          roleCode: "NO_ACCESS",
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          projects: [{ projectId: "P_STAGE", roleCode: "BASIC_USER" }],
          createdMs: 0,
          createdByUser: "owner",
        });
        const git = yield* gitHost.git;
        const noted = yield* git
          .commitFiles({ appId, id: "group" }, "refs/heads/main", {
            files: { "README.md": "Shop\n" },
            message: "A note",
            author: { name: "Ada", email: "ada@mate.test" },
            expectedHead: NodeChildProcess.execFileSync(
              "git",
              ["-C", NodePath.join(gitRoot, appId, "group.git"), "rev-parse", "main"],
              { encoding: "utf8" },
            ).trim(),
          })
          .pipe(Effect.orElseSucceed(() => ({ kind: "head_moved" as const })));
        assert.notProperty(noted, "kind");
        yield* rowsWhere(
          url,
          `SELECT 1 FROM hq_repo WHERE name = 'group' AND main_head = '${"sha" in noted ? noted.sha : ""}'`,
          (rows) => rows.length === 1,
        );
        yield* Effect.sleep(Duration.millis(500));
        assert.deepStrictEqual([fake.imports, fake.appVersions.size], [[], 0]);
        const records = yield* rowsWhere(
          url,
          "SELECT service, state, failure FROM hq_deploy ORDER BY service",
          () => true,
        );
        assert.deepStrictEqual(
          records.map((row) => Object.values(row)),
          [
            ["app", "live", null],
            ["appstage", "live", null],
            ["workerstage", "failed", "job"],
          ],
        );

        const mates = yield* rowsWhere(
          url,
          `SELECT project_id, name, face, standup_requested_by, closed_off_at IS NOT NULL AS closed
           FROM hq_mate ORDER BY project_id`,
          (rows) => rows.length === 2,
        );
        assert.deepStrictEqual(
          mates.map((row) => Object.values(row)),
          [
            ["P_BEA", "Bea", "", "owner", true],
            ["P_MATE", "Ada", "sky:pick", null, true],
          ],
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a run that died halfway resumes under the next leader, and writes nothing twice",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const first = yield* startCore(true, { gitRoot, importRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(first.fake, id);
          yield* untilHealth(first.call, "active");
          const written = yield* syntheticBundle(importRoot);
          const appdev = NodePath.join(written.dir, "repos", "g1", "appdev.bundle");
          const frozen = NodeFS.readFileSync(appdev);
          NodeFS.writeFileSync(appdev, "not what was frozen");
          // Queued as the command queues it: the command itself would refuse what the run finds.
          yield* rowsWhere(
            first.url,
            `INSERT INTO hq_import (digest, dir, state)
           VALUES ('${written.digest}', '${written.dir}', 'queued') RETURNING digest`,
            (rows) => rows.length === 1,
          );
          const [stopped] = yield* rowsWhere(
            first.url,
            "SELECT state, error FROM hq_import",
            (rows) => rows[0]?.["state"] === "failed",
          );
          assert.strictEqual(
            stopped?.["error"],
            "git:g1/appdev: repos/g1/appdev.bundle is not what was frozen",
          );
          const items = (url: string) =>
            rowsWhere(
              url,
              "SELECT key, target, done_at FROM hq_import_item ORDER BY key",
              () => true,
            );
          const before = yield* items(first.url);
          const appId = String(
            (before.find((row) => row["key"] === "app:g1")?.["target"] as { appId?: string })
              ?.appId,
          );
          // The records came first: appdev's changes are recorded, and git holds no branch of them.
          assert.deepStrictEqual(
            before.map((row) => row["key"]),
            ["app:g1", "git:g1/group", "records:g1/appdev", "records:g1/group"],
          );
          assert.isTrue(NodeFS.existsSync(NodePath.join(gitRoot, appId, "group.git")));
          assert.isFalse(NodeFS.existsSync(NodePath.join(gitRoot, appId, "appdev.git")));
          yield* first.stop;

          NodeFS.writeFileSync(appdev, frozen);
          const next = yield* startCore(true, { url: first.url, gitRoot, importRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(next.fake, id);
          yield* untilHealth(next.call, "active");
          const done = yield* importAs(next.url, written.dir);
          assert.strictEqual(done.lines[1], `import ${written.digest} done and verified`);
          const after = yield* items(next.url);
          // What the first run finished was not done again.
          for (const row of before) {
            assert.deepStrictEqual(
              after.find((candidate) => candidate["key"] === row["key"]),
              row,
            );
          }
          const [counts] = yield* rowsWhere(
            next.url,
            `SELECT (SELECT count(*) FROM hq_app)::int AS apps,
                  (SELECT count(*) FROM hq_change)::int AS changes,
                  (SELECT count(*) FROM hq_change_comment)::int AS comments,
                  (SELECT count(*) FROM hq_change_attachment)::int AS pictures,
                  (SELECT count(*) FROM hq_release)::int AS releases`,
            () => true,
          );
          assert.deepStrictEqual(counts, {
            apps: 1,
            changes: 3,
            comments: 2,
            pictures: 1,
            releases: 1,
          });
        }).pipe(Effect.scoped),
    );

    it.effect("leaves a tier's build from another org's repository as it is, and says so", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const gitRoot = yield* tempDir("hq-git-");
        const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
        yield* untilHealth(call, "active");
        const borrowed = [
          "  - hostname: shared",
          "    buildFromGit: https://gitea.example/heron/appdev.git",
          "    zeropsSetup: shared",
          "",
        ].join("\n");
        const written = yield* syntheticBundle(
          importRoot,
          undefined,
          undefined,
          STAGE_TIER + borrowed,
        );
        const done = yield* importAs(url, written.dir);
        assert.include(done.lines, "  recipe notes:");
        assert.include(
          done.lines,
          "    g1 3 — Stage/import.yaml: line 14 builds from heron/appdev on Gitea, no repository of this application's",
        );
        const [app] = yield* rowsWhere(
          url,
          "SELECT id::text AS id FROM hq_app",
          (rows) => rows.length === 1,
        );
        const stage = fileAt(gitRoot, String(app?.["id"]), "group", "3 — Stage/import.yaml");
        assert.include(stage, "    buildFromGit: https://gitea.example/heron/appdev.git\n");
        assert.notInclude(stage, "https://gitea.example/shop/");
      }).pipe(Effect.scoped),
    );

    it.effect("takes one bundle: another is refused, and the same again only verifies", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const gitRoot = yield* tempDir("hq-git-");
        const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
        yield* untilHealth(call, "active");
        const under = (name: string) => {
          const dir = NodePath.join(importRoot, name);
          NodeFS.mkdirSync(dir);
          return dir;
        };
        const shop = yield* syntheticBundle(under("shop"));
        assert.strictEqual((yield* importAs(url, shop.dir)).code, 0);
        const [app] = yield* rowsWhere(
          url,
          "SELECT id::text AS id FROM hq_app",
          (rows) => rows.length === 1,
        );
        const recipe = mainCommit(gitRoot, String(app?.["id"]), "group");

        const other = yield* syntheticBundle(under("other"), (parts) => ({
          ...parts,
          mapping: {
            apps: (parts.mapping["apps"] as ReadonlyArray<Record<string, unknown>>).map((app) => ({
              ...app,
              name: "Other",
            })),
          },
        }));
        const refused = yield* importAs(url, other.dir);
        assert.deepStrictEqual(refused, {
          code: 1,
          lines: [
            `bundle ${other.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
            `this HQ holds import ${shop.digest}: one HQ takes one import`,
          ],
        });

        const again = yield* importAs(url, shop.dir);
        // The recipe was rewritten once: the same run again commits nothing more.
        assert.deepStrictEqual(mainCommit(gitRoot, String(app?.["id"]), "group"), recipe);
        assert.strictEqual(again.lines[1], `import ${shop.digest} done and verified`);
        const [counts] = yield* rowsWhere(
          url,
          `SELECT (SELECT count(*) FROM hq_app)::int AS apps,
                  (SELECT count(*) FROM hq_change)::int AS changes,
                  (SELECT count(*) FROM hq_change_attachment)::int AS pictures,
                  (SELECT count(*) FROM hq_release)::int AS releases,
                  (SELECT count(*) FROM hq_import)::int AS imports`,
          () => true,
        );
        assert.deepStrictEqual(counts, {
          apps: 1,
          changes: 3,
          pictures: 1,
          releases: 1,
          imports: 1,
        });
      }).pipe(Effect.scoped),
    );
  });
});
