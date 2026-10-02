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

import {
  type BundleParts,
  PICTURE,
  PICTURE_URL,
  STAGE_TIER,
  syntheticBundle,
} from "../test/harness/bundle.ts";
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

/** A directory `name` under `root`, for one bundle of several. */
const under = (root: string, name: string) => {
  const dir = NodePath.join(root, name);
  NodeFS.mkdirSync(dir);
  return dir;
};

/** The synthetic bundle as another application's: its own key, name, projects and picture. */
const anotherApp = (parts: BundleParts): BundleParts => {
  const moved = (value: Record<string, unknown>) =>
    JSON.parse(
      [
        ['"g1"', '"g2"'],
        ['"Shop"', '"Lab"'],
        ['"P_MATE"', '"Q_MATE"'],
        ['"P_BEA"', '"Q_BEA"'],
        ['"P_STAGE"', '"Q_STAGE"'],
        ['"P_PROD"', '"Q_PROD"'],
        ['"shop-stage"', '"lab-stage"'],
        ['"shop-production"', '"lab-production"'],
        ['"u1"', '"u2"'],
      ].reduce((text, [from = "", to = ""]) => text.replaceAll(from, to), JSON.stringify(value)),
    ) as Record<string, unknown>;
  return {
    mapping: moved(parts.mapping),
    changes: moved(parts.changes),
    releases: moved(parts.releases),
  };
};

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

/** `git` on a repository in Core's git root, its output trimmed. */
const gitAt = (gitRoot: string, appId: string, repo: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-C", NodePath.join(gitRoot, appId, `${repo}.git`), ...args],
    { encoding: "utf8" },
  ).trim();

/** `git log -1` of a revision of a repository in Core's git root: its message and its parents. */
const commitAt = (gitRoot: string, appId: string, repo: string, rev: string) => {
  const [parents = "", ...message] = gitAt(
    gitRoot,
    appId,
    repo,
    "log",
    "-1",
    "--format=%P%n%B",
    rev,
  ).split("\n");
  return { parents: parents.split(" "), message: message.join("\n") };
};

/** `git log -1` of a repository's `main` in Core's git root: its message and its parents. */
const mainCommit = (gitRoot: string, appId: string, repo: string) =>
  commitAt(gitRoot, appId, repo, "main");

/** Whether two revisions of a repository merge: git's exit, 0 clean, 1 a conflict. */
const mergeExit = (gitRoot: string, appId: string, repo: string, ours: string, theirs: string) =>
  NodeChildProcess.spawnSync(
    "git",
    [
      "-C",
      NodePath.join(gitRoot, appId, `${repo}.git`),
      "merge-tree",
      "--write-tree",
      ours,
      theirs,
    ],
    { encoding: "utf8" },
  ).status;

/** As Snap's recipe change did: a line inserted right under a build the import's rewrite moves. */
const underBuild = (tier: string) =>
  tier.replace(
    "    buildFromGit: https://gitea.example/shop/appdev.git\n",
    "    buildFromGit: https://gitea.example/shop/appdev.git\n    enableSubdomainAccess: true\n",
  );

/** A tier as the import rewrites it: each build from Shop's appdev on Gitea from HQ's. */
const fromHq = (tier: string, appId: string) => {
  const hq = `https://hqzone.prg1-zerops.zone/git/${appId}/appdev.git`;
  return tier
    .replace("https://gitea.example/shop/appdev.git", hq)
    .replace("https://gitea.example/shop/appdev\n", `${hq}\n`);
};

/** A change's branch head in Core's git root. */
const changeHeadAt = (gitRoot: string, appId: string, repo: string, mate: string, number: number) =>
  gitAt(gitRoot, appId, repo, "rev-parse", `refs/heads/mate/${mate}/${String(number)}`);

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

    it.effect(
      "an open recipe change the rewrite alone made conflict takes main in by Core, and merges cleanly",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
          yield* untilHealth(call, "active");
          const written = yield* syntheticBundle(importRoot, undefined, undefined, undefined, [
            { number: 1, state: "open", stage: underBuild },
          ]);
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          const [app] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const appId = String(app?.["id"]);
          const proposed = written.groupHeads[1]!;
          const main = gitAt(gitRoot, appId, "group", "rev-parse", "main");
          // As the bundle brought it, the change conflicts with main: main is the rewrite's.
          assert.strictEqual(mergeExit(gitRoot, appId, "group", main, proposed), 1);

          const head = changeHeadAt(gitRoot, appId, "group", "P_MATE", 1);
          assert.deepStrictEqual(commitAt(gitRoot, appId, "group", head), {
            parents: [proposed, main],
            message: `Core: the change builds from HQ, as main does\n\nHQ-Import: ${written.digest}`,
          });
          assert.strictEqual(mergeExit(gitRoot, appId, "group", main, head), 0);
          assert.strictEqual(
            gitAt(gitRoot, appId, "group", "show", `${head}:3 — Stage/import.yaml`),
            fromHq(underBuild(STAGE_TIER), appId).trim(),
          );
          const [record] = yield* rowsWhere(
            url,
            "SELECT head, mergeability FROM hq_change WHERE repo = 'group' AND number = 1",
            (rows) => rows.length === 1,
          );
          assert.deepStrictEqual(record, { head, mergeability: "clean" });
          // An application repository's change is never merged up: appdev's open #3 is as brought.
          assert.strictEqual(
            changeHeadAt(gitRoot, appId, "appdev", "P_MATE", 3),
            written.shas.open,
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a recipe change that rewrote a build itself keeps its build, and every other moves to HQ",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
          yield* untilHealth(call, "active");
          // The worker builds from elsewhere now: the line main's rewrite moves, moved otherwise.
          const elsewhere = (tier: string) =>
            tier.replace(
              "buildFromGit: https://gitea.example/shop/appdev\n",
              "buildFromGit: https://github.com/shop/worker\n",
            );
          const written = yield* syntheticBundle(importRoot, undefined, undefined, undefined, [
            { number: 1, state: "open", stage: elsewhere },
          ]);
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          const [app] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const appId = String(app?.["id"]);
          const main = gitAt(gitRoot, appId, "group", "rev-parse", "main");
          assert.strictEqual(mergeExit(gitRoot, appId, "group", main, written.groupHeads[1]!), 1);
          const head = changeHeadAt(gitRoot, appId, "group", "P_MATE", 1);
          assert.deepStrictEqual(commitAt(gitRoot, appId, "group", head).parents, [
            written.groupHeads[1],
            main,
          ]);
          assert.strictEqual(mergeExit(gitRoot, appId, "group", main, head), 0);
          assert.strictEqual(
            gitAt(gitRoot, appId, "group", "show", `${head}:3 — Stage/import.yaml`),
            fromHq(elsewhere(STAGE_TIER), appId).trim(),
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a recipe change merged up once is not merged again: an earlier run's merge is found, a done one only verified",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
          yield* untilHealth(call, "active");
          const written = yield* syntheticBundle(importRoot, undefined, undefined, undefined, [
            { number: 1, state: "open", stage: underBuild },
          ]);
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          const [app] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const appId = String(app?.["id"]);
          const head = changeHeadAt(gitRoot, appId, "group", "P_MATE", 1);
          // A run that merged the change up and died before its item landed: the merge is found.
          yield* rowsWhere(
            url,
            `WITH gone AS (DELETE FROM hq_import_item WHERE key = 'heal:g1/group#1' RETURNING 1)
             UPDATE hq_import SET state = 'failed' RETURNING (SELECT count(*) FROM gone)::int AS n`,
            (rows) => rows[0]?.["n"] === 1,
          );
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          assert.strictEqual(changeHeadAt(gitRoot, appId, "group", "P_MATE", 1), head);
          // A done one again only verifies.
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          assert.strictEqual(changeHeadAt(gitRoot, appId, "group", "P_MATE", 1), head);
          assert.strictEqual(
            gitAt(gitRoot, appId, "group", "rev-list", "--count", `${head}^1..${head}`),
            "2",
          );
        }).pipe(Effect.scoped),
    );

    it.effect("a closed recipe change is never merged up, whatever the rewrite makes of it", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const gitRoot = yield* tempDir("hq-git-");
        const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
        yield* untilHealth(call, "active");
        const written = yield* syntheticBundle(importRoot, undefined, undefined, undefined, [
          { number: 1, state: "closed", stage: underBuild },
        ]);
        assert.strictEqual(
          (yield* importAs(url, written.dir)).lines[1],
          `import ${written.digest} done and verified`,
        );
        const [app] = yield* rowsWhere(
          url,
          "SELECT id::text AS id FROM hq_app",
          (rows) => rows.length === 1,
        );
        const appId = String(app?.["id"]);
        assert.strictEqual(
          changeHeadAt(gitRoot, appId, "group", "P_MATE", 1),
          written.groupHeads[1],
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a done import run again after its application lived takes the step it lacked and stays done",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
          yield* untilHealth(call, "active");
          const written = yield* syntheticBundle(importRoot, undefined, undefined, undefined, [
            { number: 1, state: "open", stage: underBuild },
          ]);
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          const [app] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const appId = String(app?.["id"]);
          const healedHead = changeHeadAt(gitRoot, appId, "group", "P_MATE", 1);
          // As an HQ imported before the step existed: the change as brought, the step not taken.
          gitAt(
            gitRoot,
            appId,
            "group",
            "update-ref",
            "refs/heads/mate/P_MATE/1",
            written.groupHeads[1]!,
            healedHead,
          );
          yield* rowsWhere(
            url,
            `WITH gone AS (DELETE FROM hq_import_item WHERE key = 'heal:g1/group#1' RETURNING 1)
             UPDATE hq_change SET head = '${written.groupHeads[1]}'
             WHERE repo = 'group' AND number = 1 RETURNING (SELECT count(*) FROM gone)::int AS n`,
            (rows) => rows[0]?.["n"] === 1,
          );
          // The application lived since: a Mate opened a change the bundle never knew.
          yield* rowsWhere(
            url,
            `INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, state, head)
             VALUES ('${appId}', 'appdev', 4, 'P_BEA', 'Live work', 'open', '${written.shas.squash}')
             RETURNING number`,
            (rows) => rows.length === 1,
          );

          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          const head = changeHeadAt(gitRoot, appId, "group", "P_MATE", 1);
          assert.deepStrictEqual(
            commitAt(gitRoot, appId, "group", head).parents[0],
            written.groupHeads[1],
          );
          const [state] = yield* rowsWhere(
            url,
            "SELECT state FROM hq_import",
            (rows) => rows.length === 1,
          );
          assert.strictEqual(state?.["state"], "done");
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a done import run again after main moved leaves a recipe change as brought, and stays done",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
          yield* untilHealth(call, "active");
          const written = yield* syntheticBundle(importRoot, undefined, undefined, undefined, [
            { number: 1, state: "open", stage: underBuild },
          ]);
          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          const [app] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const appId = String(app?.["id"]);
          const healedHead = changeHeadAt(gitRoot, appId, "group", "P_MATE", 1);
          gitAt(
            gitRoot,
            appId,
            "group",
            "update-ref",
            "refs/heads/mate/P_MATE/1",
            written.groupHeads[1]!,
            healedHead,
          );
          yield* rowsWhere(
            url,
            `WITH gone AS (DELETE FROM hq_import_item WHERE key = 'heal:g1/group#1' RETURNING 1)
             UPDATE hq_change SET head = '${written.groupHeads[1]}'
             WHERE repo = 'group' AND number = 1 RETURNING (SELECT count(*) FROM gone)::int AS n`,
            (rows) => rows[0]?.["n"] === 1,
          );
          // Main moved on since: a merge landed after the import.
          const main = gitAt(gitRoot, appId, "group", "rev-parse", "main");
          const tree = gitAt(gitRoot, appId, "group", "rev-parse", `${main}^{tree}`);
          const moved = NodeChildProcess.execFileSync(
            "git",
            [
              "-C",
              NodePath.join(gitRoot, appId, "group.git"),
              "commit-tree",
              tree,
              "-p",
              main,
              "-m",
              "Later work",
            ],
            {
              encoding: "utf8",
              env: {
                ...process.env,
                GIT_AUTHOR_NAME: "Ada",
                GIT_AUTHOR_EMAIL: "ada@mate.test",
                GIT_COMMITTER_NAME: "Ada",
                GIT_COMMITTER_EMAIL: "ada@mate.test",
              },
            },
          ).trim();
          gitAt(gitRoot, appId, "group", "update-ref", "refs/heads/main", moved, main);

          assert.strictEqual(
            (yield* importAs(url, written.dir)).lines[1],
            `import ${written.digest} done and verified`,
          );
          assert.strictEqual(
            changeHeadAt(gitRoot, appId, "group", "P_MATE", 1),
            written.groupHeads[1],
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "imports a second application's bundle beside the first, each verified on its own",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD", "Q_MATE", "Q_BEA", "Q_STAGE", "Q_PROD"]) {
            addProject(fake, id);
          }
          yield* untilHealth(call, "active");
          const shop = yield* syntheticBundle(under(importRoot, "shop"));
          assert.strictEqual(
            (yield* importAs(url, shop.dir)).lines[1],
            `import ${shop.digest} done and verified`,
          );
          const [first] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const shopId = String(first?.["id"]);
          const recipe = mainCommit(gitRoot, shopId, "group");

          const lab = yield* syntheticBundle(under(importRoot, "lab"), anotherApp);
          assert.strictEqual(
            (yield* importAs(url, lab.dir)).lines[1],
            `import ${lab.digest} done and verified`,
          );
          // The first application is as its import left it.
          assert.deepStrictEqual(mainCommit(gitRoot, shopId, "group"), recipe);
          const apps = yield* rowsWhere(
            url,
            `SELECT a.name,
                  (SELECT count(*) FROM hq_change c WHERE c.app_id = a.id)::int AS changes,
                  (SELECT count(*) FROM hq_release r WHERE r.app_id = a.id)::int AS releases
           FROM hq_app a ORDER BY a.name`,
            (rows) => rows.length === 2,
          );
          assert.deepStrictEqual(
            apps.map((row) => Object.values(row)),
            [
              ["Lab", 3, 1],
              ["Shop", 3, 1],
            ],
          );
          const done = yield* rowsWhere(
            url,
            "SELECT digest FROM hq_import WHERE state = 'done' ORDER BY digest",
            () => true,
          );
          assert.deepStrictEqual(
            done.map((row) => row["digest"]),
            [shop.digest, lab.digest].toSorted(),
          );
        }).pipe(Effect.scoped),
    );

    it.effect("refuses a bundle while another import is not done, until that one is", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const gitRoot = yield* tempDir("hq-git-");
        const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD", "Q_MATE", "Q_BEA", "Q_STAGE", "Q_PROD"]) {
          addProject(fake, id);
        }
        yield* untilHealth(call, "active");
        const shop = yield* syntheticBundle(under(importRoot, "shop"));
        const appdev = NodePath.join(shop.dir, "repos", "g1", "appdev.bundle");
        const frozen = NodeFS.readFileSync(appdev);
        NodeFS.writeFileSync(appdev, "not what was frozen");
        // Queued as the command queues it: the command itself would refuse what the run finds.
        yield* rowsWhere(
          url,
          `INSERT INTO hq_import (digest, dir, state)
           VALUES ('${shop.digest}', '${shop.dir}', 'queued') RETURNING digest`,
          (rows) => rows.length === 1,
        );
        yield* rowsWhere(
          url,
          "SELECT state FROM hq_import",
          (rows) => rows[0]?.["state"] === "failed",
        );

        const lab = yield* syntheticBundle(under(importRoot, "lab"), anotherApp);
        assert.deepStrictEqual(yield* importAs(url, lab.dir), {
          code: 1,
          lines: [
            `bundle ${lab.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
            `import ${shop.digest} is not done: run its bundle again to finish it`,
          ],
        });

        NodeFS.writeFileSync(appdev, frozen);
        assert.strictEqual(
          (yield* importAs(url, shop.dir)).lines[1],
          `import ${shop.digest} done and verified`,
        );
        assert.strictEqual(
          (yield* importAs(url, lab.dir)).lines[1],
          `import ${lab.digest} done and verified`,
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a takeover during a later import reconciles the applications done, and leaves the importing one to its import",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const projects = ["P_BEA", "P_STAGE", "P_PROD", "Q_MATE", "Q_BEA", "Q_STAGE", "Q_PROD"];
          const first = yield* startCore(true, { gitRoot, importRoot });
          for (const id of projects) addProject(first.fake, id);
          yield* untilHealth(first.call, "active");
          const shop = yield* syntheticBundle(under(importRoot, "shop"));
          assert.strictEqual(
            (yield* importAs(first.url, shop.dir)).lines[1],
            `import ${shop.digest} done and verified`,
          );
          const [done] = yield* rowsWhere(
            first.url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          // Git holds a release of Shop's that the records lack: a takeover records it.
          const shopRelease = (tag: string) =>
            NodeChildProcess.execFileSync("git", [
              "-C",
              NodePath.join(gitRoot, String(done?.["id"]), "group.git"),
              "-c",
              "user.name=Ada",
              "-c",
              "user.email=ada@mate.test",
              "tag",
              "-a",
              tag,
              "-m",
              `app ${shop.shas.squash}`,
              "main",
            ]);
          const releases = `SELECT a.name, r.tag, r.released_by FROM hq_release r
                            JOIN hq_app a ON a.id = r.app_id ORDER BY a.name, r.tag`;
          const lab = yield* syntheticBundle(under(importRoot, "lab"), anotherApp);
          const spoilt = (path: string) => {
            const file = NodePath.join(lab.dir, path);
            const frozen = NodeFS.readFileSync(file);
            NodeFS.writeFileSync(file, "not what was frozen");
            return () => NodeFS.writeFileSync(file, frozen);
          };
          const restoreAppdev = spoilt(NodePath.join("repos", "g1", "appdev.bundle"));
          const restorePicture = spoilt(NodePath.join("attachments", "u1.png"));
          /** Lab's run queued as the command queues it, and followed until it stops: its error. */
          const runLab = (url: string) =>
            Effect.gen(function* () {
              yield* rowsWhere(
                url,
                `INSERT INTO hq_import (digest, dir, state)
                 VALUES ('${lab.digest}', '${lab.dir}', 'queued')
                 ON CONFLICT (digest) DO UPDATE SET state = 'queued' RETURNING digest`,
                (rows) => rows.length === 1,
              );
              const [stopped] = yield* rowsWhere(
                url,
                `SELECT state, error FROM hq_import WHERE digest = '${lab.digest}'`,
                (rows) => rows[0]?.["state"] === "failed",
              );
              return String(stopped?.["error"]);
            });

          // Lab stops at appdev: its changes are recorded, and git holds no appdev yet.
          assert.strictEqual(
            yield* runLab(first.url),
            "git:g2/appdev: repos/g1/appdev.bundle is not what was frozen",
          );
          shopRelease("v0.2.0");
          yield* first.stop;
          const second = yield* startCore(true, { url: first.url, gitRoot, importRoot });
          for (const id of projects) addProject(second.fake, id);
          yield* untilHealth(second.call, "active");
          const once = yield* rowsWhere(second.url, releases, (rows) =>
            rows.some((row) => row["tag"] === "v0.2.0"),
          );
          assert.deepStrictEqual(
            once.map((row) => Object.values(row)),
            [
              ["Shop", "v0.1.0", "owner"],
              ["Shop", "v0.2.0", "restore"],
            ],
          );

          // Lab stops at its picture: every repository is in git, its release tag too, and the
          // release not recorded yet.
          restoreAppdev();
          assert.match(yield* runLab(second.url), /^picture:u2: /u);
          shopRelease("v0.3.0");
          yield* second.stop;
          const third = yield* startCore(true, { url: first.url, gitRoot, importRoot });
          for (const id of projects) addProject(third.fake, id);
          yield* untilHealth(third.call, "active");
          const twice = yield* rowsWhere(third.url, releases, (rows) =>
            rows.some((row) => row["tag"] === "v0.3.0"),
          );
          assert.deepStrictEqual(
            twice.map((row) => Object.values(row)),
            [
              ["Shop", "v0.1.0", "owner"],
              ["Shop", "v0.2.0", "restore"],
              ["Shop", "v0.3.0", "restore"],
            ],
          );

          restorePicture();
          assert.strictEqual(
            (yield* importAs(third.url, lab.dir)).lines[1],
            `import ${lab.digest} done and verified`,
          );
          // Lab's release is its import's, by its tagger, not a takeover's.
          const after = yield* rowsWhere(third.url, releases, (rows) => rows.length === 4);
          assert.deepStrictEqual(
            after.map((row) => Object.values(row)),
            [
              ["Lab", "v0.1.0", "owner"],
              ["Shop", "v0.1.0", "owner"],
              ["Shop", "v0.2.0", "restore"],
              ["Shop", "v0.3.0", "restore"],
            ],
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "refuses a bundle for an application another import brought; the same again only verifies",
      () =>
        Effect.gen(function* () {
          const importRoot = yield* tempDir("hq-import-");
          const gitRoot = yield* tempDir("hq-git-");
          const { call, fake, url } = yield* startCore(true, { importRoot, gitRoot });
          for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
          yield* untilHealth(call, "active");
          const shop = yield* syntheticBundle(under(importRoot, "shop"));
          assert.strictEqual((yield* importAs(url, shop.dir)).code, 0);
          const [app] = yield* rowsWhere(
            url,
            "SELECT id::text AS id FROM hq_app",
            (rows) => rows.length === 1,
          );
          const recipe = mainCommit(gitRoot, String(app?.["id"]), "group");

          const other = yield* syntheticBundle(under(importRoot, "other"), (parts) => ({
            ...parts,
            mapping: {
              apps: (parts.mapping["apps"] as ReadonlyArray<Record<string, unknown>>).map(
                (app) => ({
                  ...app,
                  name: "Other",
                }),
              ),
            },
          }));
          const refused = yield* importAs(url, other.dir);
          assert.deepStrictEqual(refused, {
            code: 1,
            lines: [
              `bundle ${other.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
              `application g1 (Other) came with import ${shop.digest}`,
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
