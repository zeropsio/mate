import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import versionedReleasePackages from "./versionedReleasePackages.json" with { type: "json" };

export const VERSIONED_RELEASE_PACKAGES = Object.freeze(versionedReleasePackages);

const decodePackage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

type GitRead<E, R> = (
  args: ReadonlyArray<string>,
) => Effect.Effect<{ readonly output: string; readonly code: number }, E, R>;

/** Legacy releases are their own source; a detached release must contain only version bumps. */
export const readReleaseSource = <E, R>(ref: string, git: GitRead<E, R>) =>
  Effect.gen(function* () {
    const subject = yield* git(["log", "-1", "--format=%s", ref]);
    if (subject.code !== 0) return undefined;
    const version = /^chore\(release\): mate (\d+\.\d+\.\d+)$/.exec(subject.output.trim())?.[1];
    if (version === undefined) return ref;
    const parents = yield* git(["rev-list", "--parents", "-n", "1", ref]);
    const parts = parents.output.trim().split(/\s+/);
    if (parents.code !== 0 || parts.length !== 2) return undefined;
    const source = parts[1]!;
    const changed = yield* git(["diff", "--no-renames", "--name-only", "-z", source, ref]);
    if (changed.code !== 0) return undefined;
    const paths = changed.output.split("\0").filter(Boolean);
    if (
      paths.length !== VERSIONED_RELEASE_PACKAGES.length ||
      paths.some((path) => !VERSIONED_RELEASE_PACKAGES.some((file) => file === path))
    )
      return undefined;
    for (const file of VERSIONED_RELEASE_PACKAGES) {
      const before = yield* git(["show", `${source}:${file}`]);
      const after = yield* git(["show", `${ref}:${file}`]);
      if (before.code !== 0 || after.code !== 0) return undefined;
      const a = decodePackage(before.output),
        b = decodePackage(after.output);
      if (
        Option.isNone(a) ||
        Option.isNone(b) ||
        b.value.version !== version ||
        a.value.version === version
      )
        return undefined;
      const withoutVersion = (pkg: Record<string, unknown>) =>
        JSON.stringify(
          Object.fromEntries(Object.entries(pkg).filter(([key]) => key !== "version")),
        );
      if (withoutVersion(a.value) !== withoutVersion(b.value)) return undefined;
    }
    return source;
  });
