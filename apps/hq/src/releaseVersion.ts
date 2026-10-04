/** Small root declarations only, at the recorded main head; no repository checkout or source scan. */
import type { HqGit, Repo } from "@t3tools/hq-git";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { releaseTagOfVersion } from "@t3tools/shared/hqRelease";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const packageVersion = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

export const readReleaseVersion = Effect.fnUntraced(function* (
  git: Pick<HqGit, "tree" | "file">,
  repo: Repo,
  head: string | null,
): Effect.fn.Return<RepoListEntry["releaseVersion"]> {
  if (head === null) return undefined;
  // A suggestion is optional: missing or unreadable metadata never withholds a release.
  return yield* Effect.gen(function* () {
    const root = yield* git.tree(repo, head, "");
    for (const path of ["VERSION", "package.json"] as const) {
      if (
        !root.items.some(
          (entry) => entry.path === path && entry.type === "blob" && entry.mode !== "120000",
        )
      )
        continue;
      const file = yield* git.file(repo, head, path, 16_384);
      if (file.binary || file.truncated) continue;
      const content = file.content.toString("utf8");
      const parsed = path === "package.json" ? packageVersion(content) : undefined;
      const value =
        path === "VERSION"
          ? content
          : parsed !== undefined && Option.isSome(parsed)
            ? parsed.value.version
            : undefined;
      const tag = value === undefined ? undefined : releaseTagOfVersion(value);
      if (tag !== undefined) return { tag, path };
    }
    return undefined;
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));
});
