import { assert, describe, it } from "@effect/vitest";
import { VcsProcessExitError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsProcess, type VcsProcessInput } from "../vcs/VcsProcess.ts";
import * as ZeropsCommitAuthorModule from "./ZeropsCommitAuthor.ts";
import { ZeropsCommitAuthor } from "./ZeropsCommitAuthor.ts";
import { ZeropsRepositorySource, type ZeropsRepositories } from "./ZeropsRepositorySource.ts";

const AUTHOR = {
  name: "acme-mate[bot]",
  email: "4242+acme-mate[bot]@users.noreply.github.com",
};

const repository = (host: string) => ({
  host,
  mountPath: `/var/www/${host}`,
  remotePath: "/var/www",
});

const available = (...hosts: ReadonlyArray<string>): ZeropsRepositories => ({
  _tag: "available",
  repositories: hosts.map(repository),
});

/** The service over working copies as `listed`, git refusing in the working copies `refusing`. */
const rig = (listed: ZeropsRepositories, refusing: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const ran: Array<VcsProcessInput> = [];
    const vcs = Layer.mock(VcsProcess)({
      run: (input) =>
        Effect.suspend(() => {
          ran.push(input);
          return refusing.includes(input.cwd)
            ? Effect.fail(
                new VcsProcessExitError({
                  operation: input.operation,
                  command: "git config",
                  cwd: input.cwd,
                  exitCode: 128,
                  detail: "fatal: not in a git directory",
                }),
              )
            : Effect.succeed({
                exitCode: 0 as never,
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              });
        }),
    });
    const source = Layer.mock(ZeropsRepositorySource)({ list: Effect.succeed(listed) });
    const built = yield* Layer.build(
      ZeropsCommitAuthorModule.layer.pipe(Layer.provide(Layer.mergeAll(vcs, source))),
    );
    return { author: Context.get(built, ZeropsCommitAuthor), ran };
  });

/** Each working copy's git config writes, as `cwd: key=value`. */
const writes = (ran: ReadonlyArray<VcsProcessInput>) =>
  ran.map((input) => `${input.cwd}: ${input.args.join(" ")}`).toSorted();

describe("a task's commit author on the Mate's working copies", () => {
  it.effect("every working copy the Mate reaches gets the author as its own git identity", () =>
    Effect.gen(function* () {
      const { author, ran } = yield* rig(available("appdev", "apidev"));
      yield* author.set(AUTHOR);
      assert.deepStrictEqual(writes(ran), [
        "/var/www/apidev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/apidev: config --local user.name acme-mate[bot]",
        "/var/www/appdev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/appdev: config --local user.name acme-mate[bot]",
      ]);
      assert.isTrue(ran.every((input) => input.command === "git"));
    }),
  );

  it.effect("a pool container a thread's agent leased never gets the author", () =>
    Effect.gen(function* () {
      const { author, ran } = yield* rig({
        _tag: "available",
        repositories: [repository("appdev"), { ...repository("webpool-3"), kind: "lease" }],
      });
      yield* author.set(AUTHOR);
      assert.deepStrictEqual(writes(ran), [
        "/var/www/appdev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/appdev: config --local user.name acme-mate[bot]",
      ]);
    }),
  );

  it.effect("a working copy git refuses is named, and the others still get the author", () =>
    Effect.gen(function* () {
      const { author, ran } = yield* rig(available("appdev", "apidev"), ["/var/www/apidev"]);
      const unset = yield* Effect.flip(author.set(AUTHOR));
      assert.deepStrictEqual(unset.where, ["apidev"]);
      assert.includeMembers(writes(ran), [
        "/var/www/appdev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/appdev: config --local user.name acme-mate[bot]",
      ]);
    }),
  );

  it.effect("working copies the Mate cannot list are said unset, never skipped silently", () =>
    Effect.gen(function* () {
      const { author, ran } = yield* rig({ _tag: "unavailable", reason: "mount table unreadable" });
      const unset = yield* Effect.flip(author.set(AUTHOR));
      assert.deepStrictEqual(unset.where, []);
      assert.deepStrictEqual(ran, []);
    }),
  );

  it.effect("outside a Zerops container there is no working copy to change", () =>
    Effect.gen(function* () {
      const { author, ran } = yield* rig({ _tag: "disabled" });
      yield* author.set(AUTHOR);
      assert.deepStrictEqual(ran, []);
    }),
  );
});
