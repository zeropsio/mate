// @effect-diagnostics nodeBuiltinImport:off -- the tests read the restored repositories with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import { gitClient } from "../test/harness/gitClient.ts";
import { addProject, mateWithChange, remoteOf, rowsWhere } from "../test/harness/mates.ts";
import { groupCheckout, propose, stateBecomes } from "../test/harness/recipe.ts";
import {
  type Call,
  sessionFor,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { directoryStore } from "./backup.ts";
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

const temporaryDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-restore-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

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
          const manifest = yield* a.backup.take;
          yield* a.stop;

          // Into a fresh database and git root.
          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* temporaryDir;
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* temporaryDir,
          });
          const b = yield* startCore(true, { url, gitRoot });
          yield* Stream.runHead(Stream.filter(b.gitHost.recorded, (tick) => tick > 0));

          // A session from before is gone; a person signs in again and reads the same.
          assert.strictEqual(
            (yield* b.call("GET", `/api/apps/${appId}/changes`, { session: owner })).status,
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
          const gitRoot = yield* temporaryDir;
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* temporaryDir,
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
          // A set apart in time, so the two never share an id.
          yield* Effect.sleep("1100 millis");
          const newer = yield* a.backup.take;
          yield* a.stop;

          // The newer set's database over the older set's git: sources mixed.
          const url = yield* (yield* TempPostgres).createDatabase;
          const gitRoot = yield* temporaryDir;
          const store = directoryStore(a.storeDir);
          yield* restoreDatabase(store, newer.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* temporaryDir,
          });
          yield* restoreRepos(store, older.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* temporaryDir,
          });
          const b = yield* startCore(true, { url, gitRoot });
          const health = yield* untilHealth(b.call, "failed");
          assert.strictEqual(
            (health.body as { readonly reason?: string }).reason,
            "restore_mismatch",
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
              const snapshot = (yield* socket.next("snapshot")) as {
                readonly changes: Readonly<
                  Record<string, ReadonlyArray<{ readonly repo: string }>>
                >;
              };
              return { socket, changes: repos(snapshot.changes[appId] ?? []) };
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
          const gitRoot = yield* temporaryDir;
          yield* restoreSet(directoryStore(a.storeDir), manifest.id, {
            databaseUrl: Redacted.make(url),
            gitRoot,
            workDir: yield* temporaryDir,
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
  });
});
