import type { HqGit } from "@t3tools/hq-git";
import * as Effect from "effect/Effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vite-plus/test";

import { readReleaseVersion } from "./releaseVersion.ts";

describe("a declared version at the repository's offered main head", () => {
  it.effect.each(
    Array.from(
      [
        ["VERSION", "1.0.0\n", "v1.0.0"],
        ["VERSION", "v2.0.0", "v2.0.0"],
        ["package.json", '{"version":"1.0.0"}', "v1.0.0"],
        ["package.json", '{"version":42}', undefined],
        ["package.json", "broken json", undefined],
        ["VERSION", "01.0.0", undefined],
        ["VERSION", "1.0.0-beta.1", undefined],
        ["package.json", '{"name":"app"}', undefined],
      ] as const,
      ([path, content, tag]) => ({ title: `reads ${path}: ${content}`, path, content, tag }),
    ),
  )("$title", ({ path, content, tag }) =>
    Effect.gen(function* () {
      const asked: Array<unknown> = [];
      const repo = { appId: "app", id: "appdev" };
      const head = "a".repeat(40);
      const git: Pick<HqGit, "tree" | "file"> = {
        tree: (at, rev) => {
          asked.push([at, rev]);
          return Effect.succeed({
            items: [{ path, type: "blob", mode: "100644", sha: "b".repeat(40) }],
            truncated: false,
          });
        },
        file: (at, rev, name, max) => {
          asked.push([at, rev, name, max]);
          return Effect.succeed({
            content: Buffer.from(content),
            truncated: false,
            binary: false,
          });
        },
      };
      expect(yield* readReleaseVersion(git, repo, head)).toEqual(
        tag === undefined ? undefined : { tag, path },
      );
      expect(asked).toEqual([
        [repo, head],
        [repo, head, path, 16384],
      ]);
    }),
  );

  it.effect.each(["binary", "truncated", "missing", "no head"])(
    "does not suggest a %s declaration",
    (kind) =>
      Effect.gen(function* () {
        const git: Pick<HqGit, "tree" | "file"> = {
          tree: () =>
            Effect.succeed({
              items:
                kind === "missing"
                  ? []
                  : [{ path: "VERSION", type: "blob", mode: "100644", sha: "b".repeat(40) }],
              truncated: false,
            }),
          file: () =>
            Effect.succeed({
              content: Buffer.from("1.0.0"),
              truncated: kind === "truncated",
              binary: kind === "binary",
            }),
        };
        expect(
          yield* readReleaseVersion(
            git,
            { appId: "app", id: "appdev" },
            kind === "no head" ? null : "a".repeat(40),
          ),
        ).toBeUndefined();
      }),
  );
});
