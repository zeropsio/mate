/** Person-bound source reads and HTTPS Git at HQ. All source reads are bounded and commit-pinned. */
import * as Schema from "effect/Schema";
import { Sha } from "./hqChanges.ts";

export const SOURCE_FILE_MAX_BYTES = 256 * 1024;
const Branch = Schema.Struct({ ref: Schema.String, sha: Sha });
const Entry = Schema.Struct({
  path: Schema.String,
  sha: Sha,
  mode: Schema.String,
  type: Schema.String,
});
const Path = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter((path: string) =>
    path.includes("\0") ||
    path.includes("\\") ||
    (path !== "" && path.split("/").some((part) => part === "" || part === "." || part === ".."))
      ? "Expected a repository-relative path"
      : undefined,
  ),
);
const Revision = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((rev: string) =>
    rev === "" || rev.startsWith("-") || rev.includes("\0")
      ? "Expected a branch or commit"
      : undefined,
  ),
);
export const RepositoryQuery = Schema.Struct({
  rev: Schema.optionalKey(Revision),
  path: Path,
  kind: Schema.Literals(["tree", "file"]),
});
export type RepositoryQuery = typeof RepositoryQuery.Type;
const Common = {
  revision: Schema.NullOr(Sha),
  branches: Schema.Array(Branch),
  branchesTruncated: Schema.Boolean,
  path: Schema.String,
  truncated: Schema.Boolean,
};
export const RepositorySource = Schema.Union([
  Schema.Struct({ ...Common, kind: Schema.Literal("tree"), entries: Schema.Array(Entry) }),
  Schema.Struct({
    ...Common,
    kind: Schema.Literal("file"),
    content: Schema.NullOr(Schema.String),
    binary: Schema.Boolean,
  }),
]);
export type RepositorySource = typeof RepositorySource.Type;
