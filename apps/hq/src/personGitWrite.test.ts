// @effect-diagnostics nodeBuiltinImport:off -- a real Git client exercises the person push boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const git = (args: string[], token: string) =>
  Effect.promise(() =>
    exec("git", ["-c", "credential.helper=", ...args], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`person:${token}`).toString("base64")}`,
      },
    }).then(
      () => true,
      () => false,
    ),
  );

describe("person Git write rights (E202)", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "pushes with a current app developer grant, protects HQ refs, and refuses lowered or inactive membership",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, gitHost } = yield* startCore(true, {
            viewTtl: Duration.zero,
          });
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const dev = yield* sessionFor(call, "door-dev");
          const reader = yield* sessionFor(call, "door-reader");
          const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (made.body as { id: string }).id;
          assert.strictEqual(
            (yield* call("POST", `/api/apps/${appId}/projects`, {
              session: owner,
              body: { projectId: "P_MATE", kind: "mate", mate: { face: "face-1" } },
            })).status,
            201,
          );
          const grant = (roleCode: string) => {
            const index = fake.projects.findIndex((p) => p.id === "P_MATE");
            fake.projects[index] = {
              ...fake.projects[index]!,
              userRoles: [{ clientUserId: "C-dev", roleCode }],
            };
          };
          grant("BASIC_USER");
          const issue = (session: string) =>
            Effect.map(call("POST", `/api/apps/${appId}/git-credentials`, { session }), (reply) => {
              assert.strictEqual(reply.status, 201);
              return (reply.body as { token: string }).token;
            });
          const token = yield* issue(dev);
          const readerToken = yield* issue(reader);
          const layer = yield* gitHost.opened(Duration.seconds(3));
          const repo = { appId, id: "group" };
          const initial = (yield* layer.branches(repo)).items.find(
            (b) => b.ref === "refs/heads/main",
          )!.sha;
          const dir = NodePath.join(yield* tempDir("person-push-"), "clone");
          assert.isTrue(yield* git(["clone", `${origin}/git/${appId}/group.git`, dir], token));
          assert.isTrue(
            yield* git(
              [
                "-C",
                dir,
                "-c",
                "user.name=Person",
                "-c",
                "user.email=person@example.test",
                "commit",
                "--allow-empty",
                "-m",
                "Topic",
              ],
              token,
            ),
          );
          assert.isTrue(yield* git(["-C", dir, "push", "origin", "HEAD:refs/heads/topic"], token));
          assert.isTrue(
            (yield* layer.branches(repo)).items.some((b) => b.ref === "refs/heads/topic"),
          );
          assert.strictEqual(
            (yield* call("GET", `/api/apps/${appId}/repos/group/source?rev=refs%2Fheads%2Ftopic`, {
              session: dev,
            })).status,
            200,
          );
          assert.isFalse(
            yield* git(["-C", dir, "push", "origin", "HEAD:refs/heads/reader"], readerToken),
          );
          for (const ref of ["refs/heads/main", "refs/tags/v1", "refs/heads/mate/P_MATE/1"]) {
            assert.isFalse(yield* git(["-C", dir, "push", "origin", `HEAD:${ref}`], token));
          }
          assert.isFalse(yield* git(["-C", dir, "push", "origin", ":refs/heads/topic"], token));
          assert.strictEqual(
            (yield* layer.branches(repo)).items.find((b) => b.ref === "refs/heads/main")!.sha,
            initial,
          );
          grant("READ_ONLY");
          assert.isFalse(yield* git(["-C", dir, "fetch", "origin"], token));
          assert.isFalse(
            yield* git(["-C", dir, "push", "origin", "HEAD:refs/heads/lowered"], token),
          );
          grant("BASIC_USER");
          assert.isTrue(
            yield* git(["-C", dir, "push", "origin", "HEAD:refs/heads/restored"], token),
          );
          fake.members.set(
            "ORG",
            fake.members
              .get("ORG")!
              .map((m) => (m.userId === "dev" ? { ...m, status: "INVITED" } : m)),
          );
          assert.isFalse(
            yield* git(["-C", dir, "push", "origin", "HEAD:refs/heads/inactive"], token),
          );
        }),
    );
    it.effect("preserves the active owner's site Git rights on an app without projects", () =>
      Effect.gen(function* () {
        const { call, origin } = yield* startCore(true, { viewTtl: Duration.zero });
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Empty" } });
        const appId = (app.body as { id: string }).id;
        const issued = yield* call("POST", `/api/apps/${appId}/git-credentials`, {
          session: owner,
        });
        assert.strictEqual(issued.status, 201);
        const token = (issued.body as { token: string }).token;
        const dir = NodePath.join(yield* tempDir("owner-push-"), "clone");
        assert.isTrue(yield* git(["clone", `${origin}/git/${appId}/group.git`, dir], token));
        assert.isTrue(
          yield* git(
            [
              "-C",
              dir,
              "-c",
              "user.name=Owner",
              "-c",
              "user.email=owner@example.test",
              "commit",
              "--allow-empty",
              "-m",
              "Topic",
            ],
            token,
          ),
        );
        assert.isTrue(yield* git(["-C", dir, "push", "origin", "HEAD:refs/heads/topic"], token));
      }),
    );
  });
});
