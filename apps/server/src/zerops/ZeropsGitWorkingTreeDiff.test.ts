/**
 * What a checkout has not committed shows in Diff as the service's own git reads it, over ssh:
 * the service is another machine, which shares only its `/var/www` with this one (the mount), so
 * whatever git is handed outside it lies on the service's own disk, never this container's.
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
import type { ZeropsRepository } from "./ZeropsRepositorySource.ts";

const run = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return (yield* spawner.string(ChildProcess.make("git", args, { cwd }))).trim();
  });

/**
 * The service's side of ssh: its shell runs the one command it is handed. Its `/var/www` is the
 * checkout the mount shows here; any other absolute path in git's environment is a place on the
 * service's own disk (`disk` stands in for its root), which this container cannot see.
 */
const serviceSide = (checkout: string, disk: string) => (remote: string) =>
  remote
    .replace(
      /(^|\s)'?(GIT_[A-Z_]+)=(\/[^\s']*)'?/gu,
      (_match, lead: string, key: string, value: string) =>
        `${lead}${shellQuote(
          `${key}=${
            value === "/var/www" || value.startsWith("/var/www/")
              ? `${checkout}${value.slice("/var/www".length)}`
              : `${disk}${value}`
          }`,
        )}`,
    )
    .replace(
      /(^|\s)git -C \/var\/www(?= )/u,
      (_match, lead: string) => `${lead}git -C ${shellQuote(checkout)}`,
    );

describe("a checkout's changes not committed, in Diff", () => {
  it.effect.each([
    { shape: "a dev service", host: "shopdev", kind: undefined },
    { shape: "a lease", host: "matepool-2", kind: "lease" as const },
  ])(
    "include its untracked files, read by $shape's own git over ssh, never by git here",
    ({ host, kind }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        // The mount shows the service's checkout, file for file: one directory stands for both.
        const checkout = yield* fileSystem.makeTempDirectoryScoped({ prefix: `mate-${host}-` });
        const disk = yield* fileSystem.makeTempDirectoryScoped({ prefix: `mate-${host}-disk-` });
        yield* run(checkout, ["init", "--quiet"]);
        yield* run(checkout, ["config", "user.email", "nova@example.com"]);
        yield* run(checkout, ["config", "user.name", "Nova"]);
        yield* fileSystem.writeFileString(`${checkout}/README.md`, "# Tea Shop\n");
        yield* run(checkout, ["add", "."]);
        yield* run(checkout, ["commit", "--quiet", "-m", "Start the shop"]);
        yield* fileSystem.writeFileString(`${checkout}/README.md`, "# Tea Shop\nOpen daily\n");
        yield* fileSystem.writeFileString(`${checkout}/menu.txt`, "green tea\n");

        const platform = yield* ChildProcessSpawner.ChildProcessSpawner;
        const spawned: Array<{ readonly command: string; readonly host?: string }> = [];
        const remote = serviceSide(checkout, disk);
        const inner = ChildProcessSpawner.make((command) => {
          if (!ChildProcess.isStandardCommand(command)) return platform.spawn(command);
          if (command.command !== "ssh") {
            spawned.push({ command: command.command });
            return platform.spawn(command);
          }
          spawned.push({ command: "ssh", host: command.args.at(-2) ?? "" });
          return platform.spawn(ChildProcess.make("sh", ["-c", remote(command.args.at(-1) ?? "")]));
        });
        const repository: ZeropsRepository = {
          host,
          ...(kind === undefined ? {} : { kind }),
          mountPath: checkout,
          remotePath: "/var/www",
        };
        const driver = yield* makeGitVcsDriverCore().pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            makeZeropsGitSpawner({
              enabled: true,
              repositories: Effect.succeed({ _tag: "available", repositories: [repository] }),
              inner,
            }),
          ),
        );

        const preview = yield* driver.getReviewDiffPreview({ cwd: checkout });

        const notCommitted = preview.sources.find((source) => source.kind === "working-tree");
        assert.deepStrictEqual(notCommitted?.files, [
          { path: "README.md", previousPath: null, additions: 1, deletions: 0 },
          { path: "menu.txt", previousPath: null, additions: 1, deletions: 0 },
        ]);
        assert.include(notCommitted?.diff ?? "", "+green tea");
        assert.deepStrictEqual(
          spawned.filter((call) => call.command !== "ssh" || call.host !== host),
          [],
        );
        // Nothing the read used is left in the service's repository.
        assert.deepStrictEqual(
          (yield* fileSystem.readDirectory(`${checkout}/.git`)).filter((entry) =>
            entry.includes("review-index"),
          ),
          [],
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "mate-working-tree-diff-config-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );
});
