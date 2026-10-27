/**
 * A commit's changes on the Git page are read where the code lives: the dev service's own git,
 * over ssh, with the checkout's mount path as the location — never git in the zcp container,
 * which has none.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../config.ts";
import { makeGitVcsDriverCore } from "../vcs/GitVcsDriverCore.ts";
import { makeZeropsGitSpawner, shellQuote } from "./ZeropsGitSpawner.ts";

const shop = { host: "shopdev", mountPath: "/var/www/shopdev", remotePath: "/var/www" };

const run = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return (yield* spawner.string(ChildProcess.make("git", args, { cwd }))).trim();
  });

describe("a commit's changes on the Git page", () => {
  it.effect("are read by the dev service's own git, over ssh, never by git here", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const service = yield* fileSystem.makeTempDirectoryScoped({ prefix: "mate-commit-diff-" });
      yield* run(service, ["init", "--quiet"]);
      yield* run(service, ["config", "user.email", "nova@example.com"]);
      yield* run(service, ["config", "user.name", "Nova"]);
      yield* fileSystem.writeFileString(`${service}/README.md`, "# Tea Shop\n");
      yield* run(service, ["add", "."]);
      yield* run(service, ["commit", "--quiet", "-m", "Start the shop"]);
      yield* fileSystem.writeFileString(`${service}/menu.txt`, "green tea\n");
      yield* run(service, ["add", "."]);
      yield* run(service, ["commit", "--quiet", "-m", "Add the menu"]);
      const commit = yield* run(service, ["rev-parse", "HEAD"]);

      // The service's side of ssh: its shell runs the one command it is handed, in its own
      // checkout, which here is a directory standing in for the service's /var/www.
      const platform = yield* ChildProcessSpawner.ChildProcessSpawner;
      const spawned: Array<{ readonly command: string; readonly host?: string }> = [];
      const inner = ChildProcessSpawner.make((command) => {
        if (!ChildProcess.isStandardCommand(command)) return platform.spawn(command);
        if (command.command !== "ssh") {
          spawned.push({ command: command.command });
          return platform.spawn(command);
        }
        const host = command.args.at(-2) ?? "";
        spawned.push({ command: "ssh", host });
        const remote = (command.args.at(-1) ?? "").replace(
          /(^|\s)git -C \/var\/www(?= )/,
          (_match, lead: string) => `${lead}git -C ${shellQuote(service)}`,
        );
        return platform.spawn(ChildProcess.make("sh", ["-c", remote]));
      });
      const driver = yield* makeGitVcsDriverCore().pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          makeZeropsGitSpawner({
            enabled: true,
            repositories: Effect.succeed({ _tag: "available", repositories: [shop] }),
            inner,
          }),
        ),
      );

      const preview = yield* driver.getReviewDiffPreview({
        cwd: shop.mountPath,
        commit: commit.slice(0, 7),
      });

      assert.deepStrictEqual(
        preview.sources.map((source) => [source.id, source.headRef, source.files]),
        [
          [
            "commit",
            commit,
            [{ path: "menu.txt", previousPath: null, additions: 1, deletions: 0 }],
          ],
        ],
      );
      assert.isAbove(spawned.length, 0);
      assert.deepStrictEqual(
        spawned.filter((call) => call.command !== "ssh" || call.host !== shop.host),
        [],
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "mate-commit-diff-config-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});
