// @effect-diagnostics nodeBuiltinImport:off -- an offline checkout is the historical fixture's input.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makePreExpandCore, PRE_EXPAND_PACKAGES, PRE_EXPAND_SHA } from "./preExpandCore.ts";
import { tempDir } from "./tempDir.ts";
import { TempPostgres, tempPostgresLayer } from "./tempPostgres.ts";
import { startCore, untilHealth, sessionFor } from "./runningCore.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const repoRoot = NodePath.resolve(import.meta.dirname, "../../../..");
const NAME = "0052_environment_identity.sql";

describe("historical Core fixture", () => {
  it.layer(Layer.merge(tempPostgresLayer, NodeServices.layer), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "Historical Core resolves its own packages and starts offline from a shallow checkout against the expanded database.",
        () =>
          Effect.gen(function* () {
            const parent = yield* tempDir("hq-offline-shallow-");
            const checkout = NodePath.join(parent, "checkout");
            yield* Effect.promise(() =>
              execFile("git", [
                "clone",
                "--depth",
                "1",
                "--single-branch",
                "--no-tags",
                NodeURL.pathToFileURL(repoRoot).href,
                checkout,
              ]),
            );
            const git = (args: ReadonlyArray<string>) =>
              Effect.promise(() =>
                execFile("git", [...args], {
                  cwd: checkout,
                  env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
                }),
              );
            assert.strictEqual(
              (yield* git(["rev-parse", "--is-shallow-repository"])).stdout.trim(),
              "true",
            );
            yield* git(["remote", "remove", "origin"]);
            assert.strictEqual((yield* git(["remote"])).stdout.trim(), "");
            assert.strictEqual(
              (yield* Effect.exit(git(["cat-file", "-e", `${PRE_EXPAND_SHA}^{tree}`])))._tag,
              "Failure",
            );
            // Reuse installed external dependencies as an offline CI installation would.
            // The archive itself must arrive through the shallow checkout, with no copy-in.
            NodeFS.symlinkSync(
              NodePath.join(repoRoot, "node_modules"),
              NodePath.join(checkout, "node_modules"),
            );
            for (const directory of Object.values(PRE_EXPAND_PACKAGES)) {
              NodeFS.symlinkSync(
                NodePath.join(repoRoot, directory, "node_modules"),
                NodePath.join(checkout, directory, "node_modules"),
              );
            }
            const old = yield* makePreExpandCore(checkout);
            assert.notInclude(
              old.oldMigrations.treeMigrations().map((file) => file.name),
              NAME,
            );
            // Resolve imports from a real module in every archived consumer, including shared's
            // contracts dependency. Node's package exports and symlink traversal choose the code.
            for (const directory of Object.values(PRE_EXPAND_PACKAGES)) {
              const manifest = JSON.parse(
                NodeFS.readFileSync(
                  NodePath.join(old.fixtureRoot, directory, "package.json"),
                  "utf8",
                ),
              ) as { dependencies: Record<string, string> };
              const imports = Object.keys(manifest.dependencies).filter((name) =>
                name.startsWith("@t3tools/"),
              );
              const specifiers = [
                ...imports.map((name) =>
                  name === "@t3tools/shared" ? `${name}/hqEnvironment` : name,
                ),
                "effect/Effect",
              ];
              const probe = NodePath.join(old.fixtureRoot, directory, "resolution.mjs");
              NodeFS.writeFileSync(
                probe,
                `console.log(JSON.stringify(${JSON.stringify(specifiers)}.map(specifier => import.meta.resolve(specifier))));`,
              );
              const result = yield* Effect.promise(() => execFile(process.execPath, [probe]));
              const resolved = (JSON.parse(result.stdout) as Array<string>).map((url) =>
                NodeFS.realpathSync(NodeURL.fileURLToPath(url)),
              );
              for (const [index, name] of imports.entries()) {
                assert.isTrue(
                  resolved[index]!.startsWith(
                    NodePath.join(
                      old.fixtureRoot,
                      PRE_EXPAND_PACKAGES[name as keyof typeof PRE_EXPAND_PACKAGES],
                      "src",
                    ) + NodePath.sep,
                  ),
                  `${directory} resolves historical ${name}`,
                );
              }
              assert.strictEqual(
                resolved.at(-1),
                NodeFS.realpathSync(
                  NodeModule.createRequire(NodePath.join(repoRoot, "apps/hq/package.json")).resolve(
                    "effect/Effect",
                  ),
                ),
              );
            }
            // Exercise the old build configuration too; its bundled migration list must come from
            // the archived tree. The emitted bundle is disposable and never overlays source files.
            yield* Effect.promise(() =>
              execFile(NodePath.join(repoRoot, "node_modules/.bin/vp"), ["pack"], {
                cwd: NodePath.join(old.fixtureRoot, "apps/hq"),
                maxBuffer: 4 * 1024 * 1024,
              }),
            );
            assert.isTrue(
              NodeFS.existsSync(NodePath.join(old.fixtureRoot, "apps/hq/dist/main.mjs")),
            );
            const url = yield* (yield* TempPostgres).createDatabase;
            const gitRoot = yield* tempDir("hq-offline-git-");
            const initial = yield* startCore(true, { url, gitRoot });
            yield* untilHealth(initial.call, "active");
            const receipt =
              yield* initial.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`;
            assert.strictEqual(receipt.length, 1);
            yield* initial.stop;
            const rollback = yield* old.startCore(true, { url, gitRoot });
            yield* untilHealth(rollback.call, "active");
            const owner = yield* sessionFor(rollback.call, "door-owner");
            const made = yield* rollback.call("POST", "/api/apps", {
              session: owner,
              body: { name: "Offline rollback" },
            });
            assert.strictEqual(made.status, 201);
            const appId = (made.body as { id: string }).id;
            assert.strictEqual(
              (yield* rollback.call("POST", `/api/apps/${appId}/projects`, {
                session: owner,
                body: { projectId: "P_MATE", kind: "stage", environment: { name: "offline" } },
              })).status,
              201,
            );
            const read = yield* rollback.call("GET", "/api/structure", { session: owner });
            assert.strictEqual(read.status, 200);
            const apps = (
              read.body as {
                apps: Array<{
                  id: string;
                  environments: Array<{ projectId: string; name: string }>;
                }>;
              }
            ).apps;
            assert.deepStrictEqual(
              apps
                .find((app) => app.id === appId)!
                .environments.map(({ projectId, name }) => ({ projectId, name })),
              [{ projectId: "P_MATE", name: "offline" }],
            );
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT id, project_id, target FROM hq_environment`,
              [{ id: null, project_id: "P_MATE", target: "zerops" }],
            );
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              receipt,
            );
            yield* rollback.stop;
          }),
        120_000,
      );
    },
  );
});
