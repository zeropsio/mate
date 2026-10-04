// @effect-diagnostics nodeBuiltinImport:off -- real Git clients and a disposable Postgres exercise the HTTPS boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const basic = (token: string) => ({
  authorization: `Basic ${Buffer.from(`person:${token}`).toString("base64")}`,
});
const runGit = (args: string[], token: string) =>
  Effect.promise(() =>
    exec("git", ["-c", "credential.helper=", ...args], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: basic(token).authorization.replace(/^/u, "Authorization: "),
      },
    }),
  );

describe("person HTTPS Git credentials (E199)", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "clones and fetches as a person, scopes their credential to its application, and revokes it without revoking their app session",
      () =>
        Effect.gen(function* () {
          const { call, gitHost, origin } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const reader = yield* sessionFor(call, "door-reader");
          const dev = yield* sessionFor(call, "door-dev");
          const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (app.body as { id: string }).id;
          const credentialPath = `/api/apps/${appId}/git-credentials`;
          const issued = yield* call("POST", credentialPath, { session: reader });
          assert.strictEqual(issued.status, 201);
          const credential = issued.body as { id: string; token: string; expiresAt: string };
          const git = yield* gitHost.opened(Duration.seconds(3));
          const repo = { appId, id: "group" };
          const made = yield* git.commitFiles(repo, "refs/heads/main", {
            expectedHead: (yield* git.branches(repo)).items[0]!.sha,
            files: { "README.md": "Private source\n" },
            message: "Source",
            author: { name: "A", email: "a@example.test" },
          });
          assert.isTrue("sha" in made);
          const dir = NodePath.join(yield* tempDir("person-clone-"), "clone");
          yield* runGit(["clone", `${origin}/git/${appId}/group.git`, dir], credential.token);
          assert.strictEqual(
            yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(dir, "README.md"), "utf8")),
            "Private source\n",
          );
          yield* runGit(["-C", dir, "fetch", "origin"], credential.token);
          const advertised = `/git/${appId}/group.git/info/refs?service=git-upload-pack`;
          assert.strictEqual((yield* call("GET", advertised)).status, 401);
          assert.strictEqual(
            (yield* call("GET", advertised, { headers: basic(reader) })).status,
            401,
          );
          assert.strictEqual(
            (yield* call("GET", "/api/structure", { session: credential.token })).status,
            401,
          );
          assert.strictEqual((yield* call("POST", credentialPath, { session: dev })).status, 403);
          const other = yield* call("POST", "/api/apps", {
            session: owner,
            body: { name: "Other" },
          });
          const otherId = (other.body as { id: string }).id;
          assert.strictEqual(
            (yield* call("GET", `/git/${otherId}/group.git/info/refs?service=git-upload-pack`, {
              headers: basic(credential.token),
            })).status,
            403,
          );
          // A colleague cannot revoke this credential, even knowing its id.
          yield* call("DELETE", `${credentialPath}/${credential.id}`, { session: owner });
          assert.strictEqual(
            (yield* call("GET", advertised, { headers: basic(credential.token) })).status,
            200,
          );
          const listed = yield* call("GET", credentialPath, { session: reader });
          assert.strictEqual(listed.status, 200);
          assert.notInclude(encodeJson(listed.body), credential.token);
          assert.strictEqual((listed.body as { credentials: unknown[] }).credentials.length, 1);
          yield* call("DELETE", `${credentialPath}/${credential.id}`, { session: reader });
          assert.strictEqual(
            (yield* call("GET", advertised, { headers: basic(credential.token) })).status,
            401,
          );
          assert.strictEqual(
            (yield* call("GET", "/api/structure", { session: reader })).status,
            200,
          );
        }),
    );
    it.effect(
      "stores only a digest for twelve hours, denies expired or departed holders, and checks the organization",
      () =>
        Effect.gen(function* () {
          const { call, fake, url } = yield* startCore(true, { viewTtl: Duration.zero });
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const reader = yield* sessionFor(call, "door-reader");
          const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (app.body as { id: string }).id;
          const path = `/api/apps/${appId}/git-credentials`;
          const issue = () =>
            Effect.map(call("POST", path, { session: reader }), (reply) => {
              assert.strictEqual(reply.status, 201);
              return reply.body as { id: string; token: string };
            });
          const credential = yield* issue();
          const db = yield* PgConnection.make({ url: Redacted.make(url) });
          const stored = yield* db.query(
            "SELECT token_hash, extract(epoch FROM expires_at-created_at)/3600 AS hours FROM hq_git_credential",
          );
          const row = stored.rows[0] as { token_hash: string; hours: string };
          assert.strictEqual(row.token_hash.length, 64);
          assert.notInclude(row.token_hash, credential.token);
          assert.strictEqual(Number(row.hours), 12);
          const advertised = `/git/${appId}/group.git/info/refs?service=git-upload-pack`;
          yield* db.query("UPDATE hq_git_credential SET expires_at=now()-interval '1 second'");
          assert.strictEqual(
            (yield* call("GET", advertised, { headers: basic(credential.token) })).status,
            401,
          );
          const current = yield* issue();
          yield* db.query("UPDATE hq_git_credential SET org_id='another-org'");
          assert.strictEqual(
            (yield* call("GET", advertised, { headers: basic(current.token) })).status,
            401,
          );
          yield* db.query("UPDATE hq_git_credential SET org_id='ORG'");
          fake.members.set(
            "ORG",
            fake.members.get("ORG")!.filter((member) => member.userId !== "reader"),
          );
          assert.strictEqual(
            (yield* call("GET", advertised, { headers: basic(current.token) })).status,
            403,
          );
          assert.strictEqual((yield* call("POST", path, { session: reader })).status, 403);
        }),
    );
  });
});
