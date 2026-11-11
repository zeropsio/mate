/**
 * What every Git browse read shares on the wire (`GET /api/apps/:appId/repos/:repo/browse/<read>`):
 * one file per read beside this one, each a query whose encoded side is a URL's search parameters
 * and an answer.
 *
 * @module hqGitBrowse/common
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** What a person reads a ref as; `commit` where the page names a commit, not a ref. */
export const GitRefKind = Schema.Literals([
  "branch",
  "tag",
  "change",
  "github-branch",
  "github-tag",
  "commit",
]);
export type GitRefKind = typeof GitRefKind.Type;

export const GitRef = Schema.Struct({ name: Schema.String, kind: GitRefKind });
export type GitRef = typeof GitRef.Type;

/**
 * A moving revision only `home` and `refs` accept: a branch, `refs/heads/x`, `refs/tags/x`,
 * `refs/github/{heads,tags}/x`, or a 7-40 hex commit. Every other read takes the commit it answered.
 */
export const GitRevision = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((rev: string) =>
    rev === "" || rev.startsWith("-") || rev.includes("\0")
      ? "Expected a branch, tag or commit"
      : undefined,
  ),
);

/**
 * A path as HQ reads it from git (mate-hq `hq-git` `pathText`): a byte that is not UTF-8 is the lone
 * surrogate U+DC00 + byte, shown as "�". A URL cannot carry a lone surrogate: a query writes it
 * `\xHH` and a backslash `\\`, so a path of text without a backslash reads the same in both.
 */
export const PathText = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (written: string) =>
        written.replace(/\\(\\|x[89a-f][0-9a-f])/giu, (_, code: string) =>
          code === "\\" ? code : String.fromCharCode(0xdc00 + Number.parseInt(code.slice(1), 16)),
        ),
      encode: (path: string) =>
        path.replace(/[\\\uDC80-\uDCFF]/gu, (char) =>
          char === "\\" ? "\\\\" : `\\x${(char.charCodeAt(0) - 0xdc00).toString(16)}`,
        ),
    }),
  ),
);

/** A path inside a commit: `""` its top folder; never `.`, `..`, an empty segment or a backslash. */
export const GitPath = PathText.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter((path: string) =>
    path.includes("\0") ||
    path.includes("\\") ||
    (path !== "" && path.split("/").some((part) => part === "" || part === "." || part === ".."))
      ? "Expected a repository-relative path"
      : undefined,
  ),
);

/** A file, never the top folder. */
export const FilePath = GitPath.check(Schema.isMinLength(1));

/** A file's bytes the browser shows; past them it shows these and says it stops. */
export const SOURCE_FILE_MAX_BYTES = 256 * 1024;
/** A file's bytes the browser reads at all (raw, download, an image); past them HQ refuses. */
export const RAW_MAX_BYTES = 1024 * 1024;
