import { scopeReset, scopeValue } from "../test/harness/scopes.ts";
// @effect-diagnostics nodeBuiltinImport:off -- the tests read the restored repositories with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { gitClient } from "../test/harness/gitClient.ts";
import { OTHER_KEY_SECRET, TEST_KEY_SECRET, testKey } from "../test/harness/deployKeys.ts";
import {
  addProject,
  mateInApp,
  mateWithChange,
  remoteOf,
  rowsWhere,
} from "../test/harness/mates.ts";
import { groupCheckout, propose, stateBecomes } from "../test/harness/recipe.ts";
import {
  type Call,
  sessionFor,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";
import { directoryStore } from "./backup.ts";
import { mainOf } from "./gitHost.ts";
import { restoreDatabase, restoreRepos, restoreSet } from "./restore.ts";

/** A PNG's signature and a little more: what HQ checks a picture by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** `git <args>` on the bare repository `dir`; its output. */
const native = (dir: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", ["--git-dir", dir, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();

/** Everything a person reads of the application `appId`, as `session` reads it. */
const reads = (call: Call, session: string, appId: string, picture: string) =>
  Effect.all({
    changes: call("GET", `/api/apps/${appId}/changes`, { session }),
    review: call("GET", `/api/apps/${appId}/changes/appdev/2`, { session }),
    comments: call("GET", `/api/apps/${appId}/changes/appdev/2/comments`, { session }),
    picture: call("GET", picture, { session }),
    releases: call("GET", `/api/apps/${appId}/releases`, { session }),
    repos: call("GET", `/api/apps/${appId}/repos`, { session }),
  }).pipe(
    Effect.map((answers) =>
      Object.fromEntries(
        Object.entries(answers).map(([name, answer]) => [name, [answer.status, answer.body]]),
      ),
    ),
  );

describe("a backup set, restored", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "restores whole: every read and every ref, and a takeover with nothing to record",
      () =>
        Effect.gen(function* () {
          const a = yield* startCore(true);
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const { appId, credential, auth } = yield* mateWithChange(a.call, a.fake, owner);
          const git = yield* gitClient;

          // Change 1, pushed and merged; change 2, open, with a picture and a comment.
          yield* git.checked(["clone", remoteOf(a.origin, credential, appId, "appdev"), "work"]);
          const work = NodePath.join(git.dir, "work");
          NodeFS.writeFileSync(NodePath.join(work, "page.ts"), "export const page = 1;\n");
          yield* git.checked(["add", "page.ts"], work);
          yield* git.checked(["commit", "-q", "-m", "Add a page"], work);
          yield* git.checked(["push", "-q", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          const head = yield* git.checked(["rev-parse", "HEAD"], work);
          yield* rowsWhere(
            a.url,
            "SELECT head FROM hq_change",
            (rows) => rows[0]?.["head"] === head,
          );
          const merged = yield* a.call("POST", `/api/apps/${appId}/changes/appdev/1/merge`, {
            session: owner,
            body: { expectedHead: head },
          });
          assert.strictEqual(merged.status, 200);
          yield* a.call("POST", "/api/mate/changes", {
            headers: auth,
            body: { repo: "appdev", title: "A second page" },
          });
          const kept = yield* a.call("POST", "/api/mate/changes/appdev/2/attachments", {
            headers: { ...auth, "content-type": "image/png" },
            body: PNG,
          });
          const picture = (kept.body as { readonly path: string }).path;
          yield* a.call("POST", `/api/apps/${appId}/changes/appdev/2/comments`, {
            session: owner,
            body: { body: "Looks good" },
          });

          // The recipe's production tier, the production, a release and a rollback.
          const number = yield* propose(a.call, auth);
          const group = yield* groupCheckout(git, a.origin, credential, appId, "group");
          yield* group.write(
            {
              "4 — Small Production/import.yaml": [
                "services:",
                "  - hostname: app",
                "    type: nodejs@22",
                `    buildFromGit: ${a.origin}/git/${appId}/appdev.git`,
                "    zeropsSetup: app",
                "",
              ].join("\n"),
            },
            "The production's",
          );
          yield* group.push("P_MATE", number);
          yield* stateBecomes(a.call, owner, appId, number, "merged");
          addProject(a.fake, "P_PROD");
          yield* a.call("POST", `/api/apps/${appId}/projects`, {
            session: owner,
            body: { projectId: "P_PROD", kind: "production", environment: { name: "production" } },
          });
          const groupHead = yield* group.main;
          const app = (yield* git.checked([
            "ls-remote",
            remoteOf(a.origin, credential, appId, "appdev"),
            "refs/heads/main",
          ])).split("\t")[0];
          const released = yield* a.call("POST", `/api/apps/${appId}/releases`, {
            session: owner,
            body: { tag: "v0.1.0", groupHead, entries: [{ service: "app", sha: app }] },
          });
          assert.strictEqual(released.status, 201);
          yield* a.call("POST", `/api/apps/${appId}/releases/v0.1.0/rollback`, {
            session: owner,
            body: { groupHead },
          });

          const before = yield* reads(a.call, owner, appId, picture);
          const gitPassword = (yield* a.call("POST", `/api/apps/${appId}/git-credentials`, {
            session: owner,
          })).body as { token: string };
          const manifest = yield* a.backup.take;
          yield* a.stop;

          // Into a fresh database and git root.
          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* tempDir("hq-restore-");
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          });
          const b = yield* startCore(true, { url, gitRoot });
          yield* Stream.runHead(Stream.filter(b.gitHost.recorded, (tick) => tick > 0));

          // A session from before is gone; a person signs in again and reads the same.
          assert.strictEqual(
            (yield* b.call("GET", `/api/apps/${appId}/changes`, { session: owner })).status,
            401,
          );
          assert.strictEqual(
            (yield* b.call("GET", `/git/${appId}/appdev.git/info/refs?service=git-upload-pack`, {
              headers: {
                authorization: `Basic ${Buffer.from(`person:${gitPassword.token}`).toString("base64")}`,
              },
            })).status,
            401,
          );
          const again = yield* sessionFor(b.call, "door-owner-2");
          assert.deepStrictEqual(yield* reads(b.call, again, appId, picture), before);
          for (const repo of manifest.repos) {
            const dir = NodePath.join(repo.appId, `${repo.id}.git`);
            const refs = (root: string) =>
              native(NodePath.join(root, dir), [
                "for-each-ref",
                "--format=%(refname) %(objectname)",
              ]);
            assert.strictEqual(refs(gitRoot), refs(a.gitRoot), `${repo.id}'s refs`);
            native(NodePath.join(gitRoot, dir), ["fsck", "--full", "--strict"]);
          }
          // Cloned from the restored HQ, with the Mate's credential from before.
          yield* git.checked(["clone", remoteOf(b.origin, credential, appId, "appdev"), "again"]);
          assert.strictEqual(
            yield* git.checked(["rev-parse", "HEAD"], NodePath.join(git.dir, "again")),
            app,
          );
          // The records and git agreed: the takeover recorded nothing.
          const reconciled = yield* rowsWhere(
            url,
            "SELECT count(*)::int AS n FROM hq_git_event WHERE (data->>'reconciled')::boolean",
            () => true,
          );
          assert.deepStrictEqual(reconciled, [{ n: 0 }]);
        }),
      // HQ's whole life over real git and Postgres, about 6 s alone: under a full suite's load it
      // took past the default 60 s (2026-10-03), every wait in it on a condition, none on a clock.
      { timeout: 180_000 },
    );

    it.effect(
      "restores a set whose git moved on past its dump: the takeover records the push and the merge",
      () =>
        Effect.gen(function* () {
          // What happens between the set's dump and its bundles.
          const between = yield* Ref.make<Effect.Effect<void>>(Effect.void);
          const a = yield* startCore(true, {
            afterDump: Effect.flatten(Ref.get(between)),
          });
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const { appId, credential } = yield* mateWithChange(a.call, a.fake, owner);
          const git = yield* gitClient;
          yield* git.checked(["clone", remoteOf(a.origin, credential, appId, "appdev"), "work"]);
          const work = NodePath.join(git.dir, "work");
          const push = (file: string) =>
            Effect.gen(function* () {
              NodeFS.writeFileSync(NodePath.join(work, file), `${file}\n`);
              yield* git.checked(["add", file], work);
              yield* git.checked(["commit", "-q", "-m", file], work);
              yield* git.checked(["push", "-q", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
              const head = yield* git.checked(["rev-parse", "HEAD"], work);
              yield* rowsWhere(
                a.url,
                "SELECT head FROM hq_change",
                (rows) => rows[0]?.["head"] === head,
              );
              return head;
            }).pipe(Effect.orDie);
          yield* push("one.txt");
          yield* Ref.set(
            between,
            Effect.gen(function* () {
              const head = yield* push("two.txt");
              const merged = yield* a.call("POST", `/api/apps/${appId}/changes/appdev/1/merge`, {
                session: owner,
                body: { expectedHead: head },
              });
              assert.strictEqual(merged.status, 200);
            }),
          );
          const manifest = yield* a.backup.take;
          const main = native(NodePath.join(a.gitRoot, appId, "appdev.git"), ["rev-parse", "main"]);
          yield* a.stop;

          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* tempDir("hq-restore-");
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          });
          const b = yield* startCore(true, { url, gitRoot });
          yield* Stream.runHead(Stream.filter(b.gitHost.recorded, (tick) => tick > 0));
          const head = native(NodePath.join(gitRoot, appId, "appdev.git"), [
            "rev-parse",
            "refs/heads/mate/P_MATE/1",
          ]);
          assert.deepStrictEqual(
            yield* rowsWhere(
              url,
              "SELECT state, head, merged_sha AS merged FROM hq_change WHERE number = 1",
              () => true,
            ),
            [{ state: "merged", head, merged: main }],
          );
          const reconciled = yield* rowsWhere(
            url,
            "SELECT kind FROM hq_git_event WHERE (data->>'reconciled')::boolean ORDER BY seq",
            () => true,
          );
          assert.includeDeepMembers([...reconciled], [{ kind: "merged" }]);
        }),
    );

    it.effect(
      "refuses a database newer than its git: the Core holds the lead and serves nothing",
      () =>
        Effect.gen(function* () {
          const a = yield* startCore(true);
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const { appId, credential } = yield* mateWithChange(a.call, a.fake, owner);
          const older = yield* a.backup.take;
          // Kept elsewhere: in the store the newer set of the same hour replaces it.
          const elsewhere = yield* tempDir("hq-restore-");
          NodeFS.cpSync(
            NodePath.join(a.storeDir, "sets", older.id),
            NodePath.join(elsewhere, "sets", older.id),
            { recursive: true },
          );
          // After the older set: a push and its merge.
          const git = yield* gitClient;
          yield* git.checked(["clone", remoteOf(a.origin, credential, appId, "appdev"), "work"]);
          const work = NodePath.join(git.dir, "work");
          yield* git.checked(["commit", "-q", "--allow-empty", "-m", "Later"], work);
          yield* git.checked(["push", "-q", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          const head = yield* git.checked(["rev-parse", "HEAD"], work);
          yield* rowsWhere(
            a.url,
            "SELECT head FROM hq_change",
            (rows) => rows[0]?.["head"] === head,
          );
          yield* a.call("POST", `/api/apps/${appId}/changes/appdev/1/merge`, {
            session: owner,
            body: { expectedHead: head },
          });
          const newer = yield* a.backup.take;
          yield* a.stop;

          // The newer set's database over the older set's git: sources mixed.
          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* tempDir("hq-restore-");
          yield* restoreDatabase(directoryStore(a.storeDir), newer.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          });
          yield* restoreRepos(directoryStore(elsewhere), older.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          });
          const b = yield* startCore(true, { url, gitRoot });
          const health = yield* untilHealth(b.call, "failed");
          assert.strictEqual(
            (health.body as { readonly reason?: string }).reason,
            "restore_mismatch",
          );
        }),
    );

    // A Mate enrolled after the set is unknown to the restored HQ, and told so: zcp's keep loop reads
    // this answer as "enroll again" (vysledky/hq-backup.md §6).
    it.effect(
      "tells a Mate enrolled after the set its credential is unknown, and knows the earlier",
      () =>
        Effect.gen(function* () {
          const a = yield* startCore(true);
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const earlier = yield* mateWithChange(a.call, a.fake, owner);
          const manifest = yield* a.backup.take;
          addProject(a.fake, "P_LATE");
          const late = yield* mateInApp(a.call, a.fake, owner, "P_LATE", "Later");
          yield* a.stop;

          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* tempDir("hq-restore-");
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          });
          const b = yield* startCore(true, { url, gitRoot });
          yield* untilHealth(b.call, "active");
          const whoami = (auth: Readonly<Record<string, string>>) =>
            Effect.map(b.call("GET", "/api/mate/whoami", { headers: auth }), (answer) => [
              answer.status,
              answer.body,
            ]);
          assert.deepStrictEqual(yield* whoami(late.auth), [
            401,
            { code: "mate_credential_required" },
          ]);
          assert.deepStrictEqual(yield* whoami(earlier.auth), [200, { projectId: "P_MATE" }]);
        }),
    );

    // H3: a restore holds the database's lock from its first look to its last write, and looks at
    // a git root without touching it: a running Core is refused before anything of it is touched.
    it.effect("refuses a database a Core holds, leaving that Core's git root as it is", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* untilHealth(a.call, "active");
        const owner = yield* sessionFor(a.call, "door-owner");
        const { appId } = yield* mateWithChange(a.call, a.fake, owner);
        const manifest = yield* a.backup.take;
        // What the running Core has in flight: its git home, a build.
        const home = NodePath.join(a.gitRoot, ".home-live");
        const build = NodePath.join(a.gitRoot, appId, ".build-live");
        NodeFS.mkdirSync(home);
        NodeFS.mkdirSync(build);
        const refused = yield* Effect.flip(
          restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(a.url),
            gitRoot: a.gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          }),
        );
        assert.deepStrictEqual(
          [refused._tag, "reason" in refused && refused.reason],
          ["BackupError", "core_running"],
        );
        assert.isTrue(NodeFS.existsSync(home), "the running Core's git home went");
        assert.isTrue(NodeFS.existsSync(build), "the running Core's build went");
      }),
    );

    it.effect("restores no repository while a Core holds the database", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* untilHealth(a.call, "active");
        const owner = yield* sessionFor(a.call, "door-owner");
        yield* mateWithChange(a.call, a.fake, owner);
        const manifest = yield* a.backup.take;
        const gitRoot = yield* tempDir("hq-restore-");
        const refused = yield* Effect.flip(
          restoreRepos(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(a.url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          }),
        );
        assert.deepStrictEqual(
          [refused._tag, "reason" in refused && refused.reason],
          ["BackupError", "core_running"],
        );
        assert.deepStrictEqual(NodeFS.readdirSync(gitRoot), []);
      }),
    );

    // Without `replace`, a target that holds anything is refused before either is written.
    it.effect("refuses a database or git root that holds anything, and writes neither", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* untilHealth(a.call, "active");
        const owner = yield* sessionFor(a.call, "door-owner");
        yield* mateWithChange(a.call, a.fake, owner);
        const manifest = yield* a.backup.take;
        yield* a.stop;
        const store = directoryStore(a.storeDir);
        const tables = (url: string) =>
          rowsWhere(
            url,
            "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
            () => true,
          );

        // The live database: refused, and its git root left as it was.
        const live = yield* Effect.flip(
          restoreSet(store, manifest.id, {
            databaseUrl: Redacted.make(a.url),
            gitRoot: yield* tempDir("hq-restore-"),
            workDir: yield* tempDir("hq-restore-"),
          }),
        );
        assert.deepStrictEqual(
          [live._tag, "reason" in live && live.reason],
          ["BackupError", "target_not_empty"],
        );

        // An empty database beside the live git root: refused before the database is written.
        const url = yield* (yield* TempPostgres).createDatabase;
        const git = yield* Effect.flip(
          restoreSet(store, manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot: a.gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          }),
        );
        assert.deepStrictEqual(
          [git._tag, "reason" in git && git.reason],
          ["BackupError", "target_not_empty"],
        );
        assert.deepStrictEqual(yield* tables(url), [{ n: 0 }]);
      }),
    );

    // `restore --replace` (vysledky/hq-backup.md §10): the live HQ kept beside, then the set in its
    // place; the epoch never goes back, so no write of a Core from before can pass the fence.
    it.effect(
      "replaces a live HQ, keeping it, and its next leader leads above the epoch it had",
      () =>
        Effect.gen(function* () {
          const a = yield* startCore(true);
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const { appId, auth } = yield* mateWithChange(a.call, a.fake, owner);
          const manifest = yield* a.backup.take;
          // After the set: a repository the restored HQ will not have.
          yield* a.call("POST", "/api/mate/repos", { headers: auth, body: { name: "api" } });
          yield* a.stop;
          // Another lead on the same HQ: the epoch the restore must pass.
          const again = yield* startCore(true, { url: a.url, gitRoot: a.gitRoot });
          const led = (yield* untilHealth(again.call, "active")).body as { readonly epoch: number };
          yield* again.stop;

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              for (const entry of NodeFS.readdirSync(NodePath.dirname(a.gitRoot))) {
                if (entry.startsWith(`${NodePath.basename(a.gitRoot)}.before-`)) {
                  NodeFS.rmSync(NodePath.join(NodePath.dirname(a.gitRoot), entry), {
                    recursive: true,
                    force: true,
                  });
                }
              }
            }),
          );
          const workDir = yield* tempDir("hq-restore-");
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(a.url),
            gitRoot: a.gitRoot,
            workDir,
            replace: true,
          });
          // What was there is kept: the database's dump, and the repositories beside the git root.
          const kept = NodeFS.readdirSync(workDir).filter((entry) =>
            /^before-.*\.dump$/u.test(entry),
          );
          assert.lengthOf(kept, 1);
          assert.isAbove(NodeFS.statSync(NodePath.join(workDir, kept[0] ?? "")).size, 0);
          const aside = NodeFS.readdirSync(NodePath.dirname(a.gitRoot)).filter((entry) =>
            entry.startsWith(`${NodePath.basename(a.gitRoot)}.before-`),
          );
          assert.lengthOf(aside, 1);
          assert.isTrue(
            NodeFS.existsSync(
              NodePath.join(NodePath.dirname(a.gitRoot), aside[0] ?? "", appId, "api.git"),
            ),
          );

          const b = yield* startCore(true, { url: a.url, gitRoot: a.gitRoot });
          const restored = (yield* untilHealth(b.call, "active")).body as {
            readonly epoch: number;
          };
          assert.isAbove(restored.epoch, led.epoch);
          const repos = yield* b.call("GET", `/api/apps/${appId}/repos`, {
            session: yield* sessionFor(b.call, "door-owner-2"),
          });
          assert.deepStrictEqual(
            (repos.body as { readonly repos: ReadonlyArray<{ readonly name: string }> }).repos
              .map((repo) => repo.name)
              .sort(),
            ["appdev", "group"],
          );
        }),
    );

    // No subscriber resumes past a restore: every one reconnects to the restored state, whole.
    it.effect(
      "gives a socket and a Mate link the restored state whole, never what came after the set",
      () =>
        Effect.gen(function* () {
          const a = yield* startCore(true);
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const { appId, auth } = yield* mateWithChange(a.call, a.fake, owner);
          const manifest = yield* a.backup.take;
          // After the set: a change in another repository, which A's subscribers see.
          yield* a.call("POST", "/api/mate/repos", { headers: auth, body: { name: "api" } });
          yield* a.call("POST", "/api/mate/changes", {
            headers: auth,
            body: { repo: "api", title: "After the set" },
          });
          const repos = (changes: ReadonlyArray<{ readonly repo: string }>) =>
            changes.map((change) => change.repo).sort();
          const openSocket = (core: typeof a, session: string) =>
            Effect.gen(function* () {
              const socket = yield* core.socket(
                `/api/structure/ws?ticket=${yield* ticketFor(core.call, session)}`,
              );
              const values = yield* scopeReset(socket, { kind: "app-detail", appId });
              const changes = scopeValue<ReadonlyArray<{ repo: string }>>(values, "changes");
              return { socket, changes: repos(changes) };
            });
          const openLink = (core: typeof a) =>
            Effect.gen(function* () {
              const ticket = (yield* core.call("POST", "/api/mate/link-ticket", { headers: auth }))
                .body as { readonly ticket: string };
              const link = yield* core.socket(`/api/mate/link?ticket=${ticket.ticket}`);
              const state = (yield* link.next("state")) as {
                readonly mate: { readonly changes: ReadonlyArray<{ readonly repo: string }> };
              };
              return { link, changes: repos(state.mate.changes) };
            });
          const beforeSocket = yield* openSocket(a, owner);
          const beforeLink = yield* openLink(a);
          assert.deepStrictEqual(
            [beforeSocket.changes, beforeLink.changes],
            [
              ["api", "appdev"],
              ["api", "appdev"],
            ],
          );
          yield* a.stop;
          // Told to reconnect: this Core no longer leads.
          assert.strictEqual(yield* beforeSocket.socket.closedWith, 1001);

          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* tempDir("hq-restore-");
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* tempDir("hq-restore-"),
          });
          const b = yield* startCore(true, { url, gitRoot });
          yield* Stream.runHead(Stream.filter(b.gitHost.recorded, (tick) => tick > 0));
          const afterSocket = yield* openSocket(b, yield* sessionFor(b.call, "door-owner-2"));
          const afterLink = yield* openLink(b);
          assert.deepStrictEqual(
            [afterSocket.changes, afterLink.changes],
            [["appdev"], ["appdev"]],
          );
        }),
    );

    // Audit D4: a set carries an environment's deploy token only sealed, and never HQ's key, which
    // lives in HQ's env. Restored onto an HQ with the same key, the stage deploys with it; onto one
    // with another key, its deploys are refused, named, and `/health` tells it.
    it.effect(
      "restores deploy tokens only sealed: they deploy under the same key, and are refused under another",
      () =>
        Effect.gen(function* () {
          const VALUE = "key-stage-sealed-in-the-set";
          const a = yield* startCore(true);
          yield* untilHealth(a.call, "active");
          const owner = yield* sessionFor(a.call, "door-owner");
          const { appId, credential, auth } = yield* mateInApp(
            a.call,
            a.fake,
            owner,
            "P_MATE",
            "Shop",
          );
          /** Zerops as each HQ meets it: the stage's project, its service `app`, the key. */
          const stageIn = (fake: FakeWorld) => {
            addProject(fake, "P_STAGE");
            fake.services.push({
              id: "S-app-stage",
              projectId: "P_STAGE",
              name: "app",
              status: "ACTIVE",
              isSystem: false,
              subdomainAccess: false,
              http: true,
              named: { id: "V0-app", name: "" },
              activeVersionId: "V0-app",
            });
            fake.tokens.set(VALUE, {
              id: "T_STAGE",
              name: "deploy-stage",
              orgId: "ORG",
              roleCode: "NO_ACCESS",
              canCreateProjects: false,
              canViewFinances: false,
              canEditFinances: false,
              projects: [{ projectId: "P_STAGE", roleCode: "BASIC_USER" }],
              createdMs: 0,
              createdByUser: "owner",
            });
          };
          stageIn(a.fake);
          const attached = yield* a.call("POST", `/api/apps/${appId}/projects`, {
            session: owner,
            body: { projectId: "P_STAGE", kind: "stage", environment: { name: "stage" } },
          });
          assert.strictEqual(attached.status, 201);
          const kept = yield* a.call("PUT", `/api/apps/${appId}/environments/stage/deploy-token`, {
            session: owner,
            body: { token: VALUE },
          });
          assert.strictEqual(kept.status, 200);
          // The stage's tier builds `app` from appdev, whose main carries no zerops.yaml yet.
          yield* a.call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          const number = yield* propose(a.call, auth);
          const group = yield* groupCheckout(
            yield* gitClient,
            a.origin,
            credential,
            appId,
            "group",
          );
          yield* group.write(
            {
              "3 — Stage/import.yaml": [
                "services:",
                "  - hostname: app",
                "    type: nodejs@22",
                `    buildFromGit: ${a.origin}/git/${appId}/appdev.git`,
                "    zeropsSetup: app",
                "",
              ].join("\n"),
            },
            "The stage's",
          );
          yield* group.push("P_MATE", number);
          yield* stateBecomes(a.call, owner, appId, number, "merged");
          const manifest = yield* a.backup.take;
          yield* a.stop;

          // The set's dump, as SQL: neither the token nor HQ's key is in it.
          const dump = NodeChildProcess.execFileSync(
            "pg_restore",
            ["--file=-", NodePath.join(a.storeDir, "sets", manifest.id, "db.dump")],
            { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
          );
          // pg_restore writes bytea in hex: the row is there under the key's id, its bytes no value.
          assert.include(dump, testKey().id);
          assert.notInclude(dump, VALUE);
          assert.notInclude(dump, Buffer.from(VALUE, "utf8").toString("hex"));
          assert.notInclude(dump, TEST_KEY_SECRET);

          for (const [keySecret, keys, outcome] of [
            [TEST_KEY_SECRET, "ok", ["live", null]],
            [
              OTHER_KEY_SECRET,
              "other_secret",
              [
                "refused",
                "stage's deploy token does not open with HQ's key: HQ deploys again once HQ_KEY_SECRET is the key it was sealed under, or once an admin who opens the projects page in Zerops Mate mints a new one",
              ],
            ],
          ] as const) {
            const url = yield* (yield* TempPostgres).createDatabase;
            const gitRoot = yield* tempDir("hq-restore-");
            yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
              databaseUrl: Redacted.make(url),
              gitRoot,
              workDir: yield* tempDir("hq-restore-"),
            });
            const b = yield* startCore(true, { url, gitRoot, keySecret });
            stageIn(b.fake);
            const health = yield* untilHealth(b.call, "active");
            assert.strictEqual((health.body as { readonly keys: string }).keys, keys);
            // Main moves to a commit carrying the stage's setup: the stage deploys it, or is refused.
            // Once its takeover is through and git open.
            const git = yield* b.gitHost.git.pipe(
              Effect.retry(Schedule.spaced(Duration.millis(50))),
              Effect.timeout(Duration.seconds(10)),
            );
            const appdev = { appId, id: "appdev" };
            yield* git.commitFiles(appdev, "refs/heads/main", {
              files: {
                "zerops.yaml": "zerops:\n  - setup: app\n    run:\n      start: node index.js\n",
              },
              expectedHead: yield* mainOf(git, appdev),
              message: "Build it",
              author: { name: "Ada", email: "ada@mate.test" },
            });
            const [deployed] = yield* rowsWhere(
              url,
              "SELECT state, reason FROM hq_deploy_job WHERE kind = 'deploy'",
              (rows) =>
                rows.length === 1 && ["live", "refused"].includes(String(rows[0]?.["state"])),
            );
            assert.deepStrictEqual<ReadonlyArray<unknown>>(
              [deployed?.["state"], deployed?.["reason"]],
              outcome,
            );
            yield* b.stop;
          }
        }),
      { timeout: 180_000 },
    );
  });
});
