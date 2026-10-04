// @effect-diagnostics nodeBuiltinImport:off -- tests read real git repositories through Core's HTTP API.
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

describe("person repository browsing (E203)", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "reads a branch, directory and file at a pinned commit, without exposing another person's source",
      () =>
        Effect.gen(function* () {
          const { call, gitHost } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const reader = yield* sessionFor(call, "door-reader");
          const dev = yield* sessionFor(call, "door-dev");
          const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (app.body as { id: string }).id;
          const source = `/api/apps/${appId}/repos/group/source`;
          const git = yield* gitHost.opened(Duration.seconds(3));
          const made = yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
            expectedHead: (yield* git.branches({ appId, id: "group" })).items[0]!.sha,
            message: "First source",
            author: { name: "A", email: "a@example.test" },
            files: {
              "README.md": "Hello <script>world</script>\n",
              "src/a.ts": "export const a = 1;\n",
              "image.bin": new Uint8Array([1, 0, 2]),
              "large.txt": "x".repeat(300_000),
            },
          });
          assert.isTrue("sha" in made);
          const sha = "sha" in made ? made.sha : "";
          const root = yield* call("GET", source, { session: reader });
          assert.strictEqual(root.status, 200);
          const tree = root.body as {
            revision: string;
            branches: Array<{ ref: string; sha: string }>;
            entries: Array<{ path: string; type: string }>;
          };
          assert.strictEqual(tree.revision, sha);
          assert.deepStrictEqual(tree.branches, [{ ref: "refs/heads/main", sha }]);
          assert.isTrue(
            tree.entries.some((entry) => entry.path === "src" && entry.type === "tree"),
          );
          const directory = yield* call("GET", `${source}?rev=${sha}&path=src`, {
            session: reader,
          });
          assert.strictEqual(directory.status, 200);
          assert.deepStrictEqual(
            (directory.body as { entries: Array<{ path: string }> }).entries.map(
              (entry) => entry.path,
            ),
            ["a.ts"],
          );
          const file = yield* call("GET", `${source}?rev=${sha}&path=src%2Fa.ts&kind=file`, {
            session: reader,
          });
          assert.strictEqual(file.status, 200);
          assert.strictEqual((file.body as { content: string }).content, "export const a = 1;\n");
          const binary = yield* call("GET", `${source}?path=image.bin&kind=file`, {
            session: reader,
          });
          assert.deepStrictEqual(
            [
              (binary.body as { binary: boolean }).binary,
              (binary.body as { content: string | null }).content,
            ],
            [true, null],
          );
          const large = yield* call("GET", `${source}?path=large.txt&kind=file`, {
            session: reader,
          });
          assert.isTrue((large.body as { truncated: boolean }).truncated);
          assert.isAtMost((large.body as { content: string }).content.length, 262_144);
          assert.strictEqual((yield* call("GET", source, { session: dev })).status, 403);
          assert.strictEqual((yield* call("GET", source)).status, 401);
          assert.strictEqual(
            (yield* call("GET", `${source}?rev=--help`, { session: reader })).status,
            400,
          );
          assert.strictEqual(
            (yield* call("GET", `${source}?path=..%2Fsecret`, { session: reader })).status,
            400,
          );
        }),
    );
    it.effect("distinguishes an empty repository from a missing repository or revision", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Empty" } });
        const appId = (app.body as { id: string }).id;
        const source = `/api/apps/${appId}/repos/group/source`;
        const empty = yield* call("GET", source, { session: owner });
        assert.strictEqual(empty.status, 200);
        assert.isString((empty.body as { revision: string | null }).revision);
        assert.deepStrictEqual((empty.body as { entries: unknown[] }).entries, []);
        assert.strictEqual(
          (yield* call("GET", `${source}?rev=${"a".repeat(40)}`, { session: owner })).status,
          404,
        );
        assert.strictEqual(
          (yield* call("GET", `/api/apps/${appId}/repos/missing/source`, { session: owner }))
            .status,
          404,
        );
      }),
    );
  });
});
