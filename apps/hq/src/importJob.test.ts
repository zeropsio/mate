// @effect-diagnostics nodeBuiltinImport:off -- bundles are temp directories; the repositories are read on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { PICTURE, PICTURE_URL, syntheticBundle } from "../test/harness/bundle.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
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

describe("the migration's import", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("brings a bundle in whole, as the leader writes, and verifies it", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const gitRoot = yield* tempDir("hq-git-");
        const { call, fake, url } = yield* startCore(true, { gitRoot, importRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
        yield* untilHealth(call, "active");
        const written = yield* syntheticBundle(importRoot);

        const done = yield* importAs(url, written.dir);
        assert.deepStrictEqual(done, {
          code: 0,
          lines: [
            `bundle ${written.digest}: 1 application, 2 repositories, 3 changes, 1 picture, 1 release`,
            `import ${written.digest} done and verified`,
            "  merged otherwise than by HQ's squash: none",
            "  Mates not enrolled yet: P_MATE, P_BEA",
            // Its tiers name no runtime: nothing is wanted anywhere, so nothing is held.
            "  environments:",
            "    shop-stage: nothing to deploy yet",
            "    shop-production: nothing to deploy yet",
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

    it.effect("takes one bundle: another is refused, and the same again only verifies", () =>
      Effect.gen(function* () {
        const importRoot = yield* tempDir("hq-import-");
        const { call, fake, url } = yield* startCore(true, { importRoot });
        for (const id of ["P_BEA", "P_STAGE", "P_PROD"]) addProject(fake, id);
        yield* untilHealth(call, "active");
        const under = (name: string) => {
          const dir = NodePath.join(importRoot, name);
          NodeFS.mkdirSync(dir);
          return dir;
        };
        const shop = yield* syntheticBundle(under("shop"));
        assert.strictEqual((yield* importAs(url, shop.dir)).code, 0);

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
