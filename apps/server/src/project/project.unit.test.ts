import { expect, it } from "@effect/vitest";
import { SourceControlProviderError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { TestClock } from "effect/testing";

import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

// What Git answers: `root` for `rev-parse --show-toplevel`, `remotes` for `remote -v`; null fails
// the call with exit code 1. A case changes the answers between resolves.
interface GitAnswers {
  root: string | null;
  remotes: string | null;
}

const fakeGit = (answers: GitAnswers) => {
  const calls: Array<ReadonlyArray<string>> = [];
  const layer = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) =>
      Effect.sync(() => {
        calls.push(input.args);
        const answer = input.args.includes("rev-parse")
          ? answers.root === null
            ? null
            : `${answers.root}\n`
          : answers.remotes;
        return {
          stdout: answer ?? "",
          stderr: answer === null ? "temporary Git failure" : "",
          code: ChildProcessSpawner.ExitCode(answer === null ? 1 : 0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });
  return { calls, layer };
};

const resolverOver = (
  git: ReturnType<typeof fakeGit>,
  options?: RepositoryIdentityResolver.RepositoryIdentityResolverOptions,
) =>
  Layer.effect(
    RepositoryIdentityResolver.RepositoryIdentityResolver,
    RepositoryIdentityResolver.make(options),
  ).pipe(Layer.provide(git.layer));

const T3CODE = "origin\tgit@github.com:T3Tools/t3code.git (fetch)\n";

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | for (const preferredRemoteName of ["upstream", "origin"] as const) { → for (const preferredRemoteName of ["origin", "upstream"] as const) {
it.effect(
  "RI1: A folder with both an `upstream` and an `origin` remote is identified by `upstream`, and a fork's own `origin` is reported beside it",
  () => {
    const git = fakeGit({
      root: "/repo",
      remotes:
        "origin\tgit@github.com:julius/t3code-fork.git (fetch)\n" +
        "upstream\tgit@github.com:T3Tools/t3code.git (fetch)\n",
    });
    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve("/repo");

      expect(identity?.locator.remoteName).toBe("upstream");
      expect(identity?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(identity?.displayName).toBe("t3tools/t3code");
      expect(identity?.origin).toEqual({
        canonicalKey: "github.com/julius/t3code-fork",
        displayName: "julius/t3code-fork",
      });
    }).pipe(Effect.provide(resolverOver(git)));
  },
);

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | const repositoryName = repositoryPathSegments.at(-1); → const repositoryName = repositoryPathSegments.at(1);
it.effect(
  "RI2: A remote's identity is its host and lower-cased path, its owner the first path segment and its name the last, nested groups included",
  () => {
    const answers: GitAnswers = { root: "/repo", remotes: T3CODE };
    const git = fakeGit(answers);
    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const github = yield* resolver.resolve("/repo");
      expect(github?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(github?.displayName).toBe("t3tools/t3code");
      expect(github?.provider).toBe("github");
      expect(github?.owner).toBe("t3tools");
      expect(github?.name).toBe("t3code");

      answers.root = "/platform";
      answers.remotes = "origin\tgit@gitlab.com:T3Tools/platform/t3code.git (fetch)\n";
      const nested = yield* resolver.resolve("/platform");
      expect(nested?.canonicalKey).toBe("gitlab.com/t3tools/platform/t3code");
      expect(nested?.displayName).toBe("t3tools/platform/t3code");
      expect(nested?.owner).toBe("t3tools");
      expect(nested?.name).toBe("t3code");
    }).pipe(Effect.provide(resolverOver(git)));
  },
);

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | if (options?.refresh) yield* Cache.invalidate(repositoryRootCache, cwd); → yield* Cache.invalidate(repositoryRootCache, cwd);
it.effect(
  "RI3: A folder's repository root is Git's top level, read once and read again only when a refresh is asked",
  () => {
    const answers: GitAnswers = { root: "/repo", remotes: T3CODE };
    const git = fakeGit(answers);
    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const first = yield* resolver.resolve("/repo/packages/web");
      answers.root = "/repo/packages/web";
      const second = yield* resolver.resolve("/repo/packages/web");

      expect(first?.rootPath).toBe("/repo");
      expect(first?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(second).toEqual(first);
      expect(git.calls).toEqual([
        ["-C", "/repo/packages/web", "rev-parse", "--show-toplevel"],
        ["-C", "/repo", "remote", "-v"],
      ]);

      const refreshed = yield* resolver.resolve("/repo/packages/web", { refresh: true });
      expect(refreshed?.rootPath).toBe("/repo/packages/web");
      expect(yield* resolver.resolve("/repo/packages/web")).toEqual(refreshed);
      expect(git.calls.slice(2)).toEqual([
        ["-C", "/repo/packages/web", "rev-parse", "--show-toplevel"],
        ["-C", "/repo/packages/web", "remote", "-v"],
      ]);
    }).pipe(Effect.provide(resolverOver(git)));
  },
);

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | { capacity: cacheCapacity, timeToLive: timeToLive(Duration.zero) }, → { capacity: cacheCapacity, timeToLive: timeToLive(Duration.minutes(1)) },
it.effect(
  "RI4: A folder found outside a repository, or whose root lookup failed, is asked again on the next resolve, so a fresh `git init` shows at once",
  () => {
    const answers: GitAnswers = { root: null, remotes: T3CODE };
    const git = fakeGit(answers);
    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      expect(yield* resolver.resolve("/repo/packages/web")).toBeNull();

      answers.root = "/repo";
      const recovered = yield* resolver.resolve("/repo/packages/web");
      expect(recovered?.rootPath).toBe("/repo");
      expect(recovered?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(git.calls).toEqual([
        ["-C", "/repo/packages/web", "rev-parse", "--show-toplevel"],
        ["-C", "/repo/packages/web", "rev-parse", "--show-toplevel"],
        ["-C", "/repo", "remote", "-v"],
      ]);
    }).pipe(Effect.provide(resolverOver(git)));
  },
);

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | onFailure: () => Duration.zero, → onFailure: () => Duration.minutes(1),
it.effect("RI5: A remote lookup that failed is not kept: the next resolve asks Git again", () => {
  const answers: GitAnswers = { root: "/repo", remotes: null };
  const git = fakeGit(answers);
  return Effect.gen(function* () {
    const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
    expect(yield* resolver.resolve("/repo")).toBeNull();

    answers.remotes = T3CODE;
    expect((yield* resolver.resolve("/repo"))?.canonicalKey).toBe("github.com/t3tools/t3code");
  }).pipe(Effect.provide(resolverOver(git)));
});

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | timeToLive: timeToLive(options.negativeCacheTtl ?? DEFAULT_NEGATIVE_CACHE_TTL), → timeToLive: timeToLive(DEFAULT_NEGATIVE_CACHE_TTL),
it.effect(
  "RI6: A repository without a remote stays without an identity until its negative lifetime passes, and then a remote added meanwhile shows",
  () => {
    const answers: GitAnswers = { root: "/repo", remotes: "" };
    const git = fakeGit(answers);
    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      expect(yield* resolver.resolve("/repo")).toBeNull();

      answers.remotes = T3CODE;
      for (const _attempt of [1, 2, 3]) {
        expect(yield* resolver.resolve("/repo")).toBeNull();
      }

      yield* TestClock.adjust(Duration.millis(120));

      const refreshed = yield* resolver.resolve("/repo");
      expect(refreshed?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(refreshed?.name).toBe("t3code");
    }).pipe(
      Effect.provide(
        resolverOver(git, {
          cacheCapacity: 16,
          negativeCacheTtl: Duration.millis(50),
          positiveCacheTtl: Duration.seconds(1),
        }),
      ),
    );
  },
);

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | value === null ? missTtl : (options.positiveCacheTtl ?? DEFAULT_POSITIVE_CACHE_TTL), → value === null ? missTtl : DEFAULT_POSITIVE_CACHE_TTL,
it.effect(
  "RI7: A found identity is kept for its positive lifetime, and a changed remote shows once it passes",
  () => {
    const answers: GitAnswers = { root: "/repo", remotes: T3CODE };
    const git = fakeGit(answers);
    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      expect((yield* resolver.resolve("/repo"))?.canonicalKey).toBe("github.com/t3tools/t3code");

      answers.remotes = "origin\tgit@github.com:T3Tools/t3code-next.git (fetch)\n";
      expect((yield* resolver.resolve("/repo"))?.canonicalKey).toBe("github.com/t3tools/t3code");

      yield* TestClock.adjust(Duration.millis(180));

      const refreshed = yield* resolver.resolve("/repo");
      expect(refreshed?.canonicalKey).toBe("github.com/t3tools/t3code-next");
      expect(refreshed?.displayName).toBe("t3tools/t3code-next");
      expect(refreshed?.name).toBe("t3code-next");
    }).pipe(
      Effect.provide(
        resolverOver(git, {
          cacheCapacity: 16,
          negativeCacheTtl: Duration.millis(50),
          positiveCacheTtl: Duration.millis(100),
        }),
      ),
    );
  },
);

// witness: apps/server/src/project/RepositoryIdentityResolver.ts | (identity) => refine(identity).pipe(Effect.orElseSucceed(() => identity)), → (identity) => refine(identity).pipe(Effect.orElseSucceed(() => null)),
it.effect(
  "RI8: A provider refinement of an identity runs once per kept identity, and when it fails the plain identity is kept",
  () => {
    const git = fakeGit({
      root: "/repo",
      remotes: "origin\tgit@ssh.forge.test:team/repo.git (fetch)\n",
    });
    let refinements = 0;
    let refinementFails = false;
    const resolverLayer = resolverOver(git, {
      refine: (identity) => {
        refinements++;
        if (refinementFails)
          return Effect.fail(
            new SourceControlProviderError({
              provider: "forgejo",
              operation: "detectProvider",
              cwd: "/repo",
              detail: "account unavailable",
            }),
          );
        return Effect.succeed({
          ...identity,
          provider: "forgejo",
          webUrl: "http://forge.test:3000/git/team/repo",
        });
      },
    });

    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const forgejo = yield* resolver.resolve("/repo");
      expect(forgejo?.provider).toBe("forgejo");
      expect(forgejo?.webUrl).toBe("http://forge.test:3000/git/team/repo");
      expect(forgejo?.canonicalKey).toBe("ssh.forge.test/team/repo");
      expect(yield* resolver.resolve("/repo")).toEqual(forgejo);
      expect(refinements).toBe(1);
    }).pipe(
      Effect.provide(resolverLayer),
      Effect.andThen(
        Effect.gen(function* () {
          refinementFails = true;
          const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
          const plain = yield* resolver.resolve("/repo");
          expect(plain?.webUrl).toBeUndefined();
          expect(plain?.canonicalKey).toBe("ssh.forge.test/team/repo");
        }).pipe(Effect.provide(resolverLayer)),
      ),
    );
  },
);
