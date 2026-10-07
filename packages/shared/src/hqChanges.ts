/**
 * A Mate's changes in HQ (SPEC §3.2a), what replaces a pull request: the wire between HQ, zcp and
 * the client. A change is HQ's record of a Mate's work toward `main` in one repository of its
 * application, on the branch `mate/<Mate's project id>/<number>`; a Mate has at most one open
 * change per repository. HQ checks every body it reads with these schemas; zcp reads this file as
 * the spec.
 *
 * **The Mate's side**, `Authorization: Mate <credential>` (`apps/hq/src/mateCredentials.ts`), always
 * within the application HQ holds the Mate in (`mate` or `devstage`):
 *
 * - `POST /api/mate/repos` {@link EnsureRepoRequest} → {@link HqRepo};
 * - `POST /api/mate/changes` {@link OpenChangeRequest} → {@link OpenChangeResponse};
 * - `PATCH /api/mate/changes/:repo/:n` {@link EditChangeRequest} → {@link HqChange};
 * - `POST /api/mate/changes/:repo/:n/attachments`, a raster picture → {@link AttachmentResponse};
 * - `GET /api/mate/self` → its state (`mateLink.ts` `MateState`), {@link MateChanges} included;
 * - git over HTTPS at `/git/<appId>/<repo>.git`, Basic auth with the user `mate` and the credential
 *   as the password. A Mate fetches its application's repositories and pushes only to the branch of
 *   its own open change, only forward; nobody deletes a branch and `main` moves only by HQ's merge.
 *   A push refused is refused per ref in git's own report.
 *
 * **A person's side**, `Authorization: Bearer <session>`, wherever they may read the application:
 *
 * - `GET /api/apps/:appId/repos` → {@link RepoListResponse};
 * - HQ socket `compare` (`appId`, `repo`, {@link CompareQuery}) → {@link CompareResponse}: the
 *   commits between two of a repository's commits, each with the change that landed it;
 * - `GET /api/apps/:appId/changes` → {@link ChangeListResponse};
 * - `GET /api/apps/:appId/changes/:repo/:n` → {@link ChangeDetailResponse};
 * - `GET`, `POST /api/apps/:appId/changes/:repo/:n/comments` → {@link CommentListResponse},
 *   {@link HqChangeComment};
 * - `POST /api/apps/:appId/changes/:repo/:n/merge` {@link MergeChangeRequest} and `POST …/close`,
 *   by whoever develops the application → the change, merged or closed;
 * - `GET` {@link attachmentPath} → the picture with its detected raster Content-Type;
 * - the structure socket carries changes too: {@link ChangesSnapshot}, {@link ChangesMessage};
 *   and its load data (`hqAppReads.ts`);
 * - a change's address, {@link changeUrl}, is HQ's: `GET /changes/<appId>/<repo>/<n>` redirects
 *   (`302`) to the first client origin HQ answers, at {@link changeRoutePath}.
 *
 * **Answers.** A refusal is `{ code, reason }`: `403 forbidden` with a permission's reason
 * (`zeropsPermissions.ts`), `404` `repo_not_found` / `change_not_found` / `attachment_not_found` /
 * `commit_not_found`,
 * `409 conflict` `change_not_open` for a change merged or closed, `400 invalid` for a body these
 * schemas refuse, `413 too_large`. Only the HQ that leads serves any of it: a standby answers `503
 * not_active` with `Retry-After` (two instances overlap through a deploy), which is "try again",
 * never a refusal; so is `503 zerops_unavailable`.
 *
 * @module hqChanges
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** An id the git layer takes for an application or a repository (`@t3tools/hq-git`, mirrored). */
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";

/** A change's title, at most this many characters (code points: zcp counts runes). */
export const CHANGE_TITLE_MAX = 120;
/** A change's description, at most this many characters. */
export const CHANGE_BODY_MAX = 20_000;
/** A comment on a change, at most this many characters. */
export const COMMENT_BODY_MAX = 20_000;

/** Text of at most `max` characters, counted as code points, and no NUL, which no text in HQ keeps. */
const upTo = (max: number) =>
  Schema.String.check(
    Schema.makeFilter((text: string) =>
      text.includes("\u0000")
        ? "Expected no NUL"
        : [...text].length <= max
          ? undefined
          : `Expected at most ${String(max)} characters`,
    ),
  );

/** A repository's name in its application: its dev service's hostname. */
export const RepoName = Schema.String.check(Schema.isPattern(new RegExp(`^${ID}$`, "u")));

export const ChangeNumber = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

/** A commit as git names it in full: SHA-1 or SHA-256. */
export const Sha = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u));

export const ChangeTitle = upTo(CHANGE_TITLE_MAX).check(
  Schema.makeFilter((title: string) => (title.trim() === "" ? "Expected a title" : undefined)),
);
export const ChangeBody = upTo(CHANGE_BODY_MAX);

/** `open` until it is merged into `main`, or closed without merging. */
export const ChangeState = Schema.Literals(["open", "merged", "closed"]);
export type ChangeState = typeof ChangeState.Type;

/** An instant, ISO 8601. */
const Instant = Schema.String;

/**
 * Whether a change merges into `main`, as its record keeps it ({@link Mergeability} without the
 * conflict's paths): `unknown` until HQ has judged it.
 */
export const MergeabilityKind = Schema.Literals([
  "clean",
  "conflict",
  "empty",
  "already_merged",
  "unrelated",
  "unknown",
]);
export type MergeabilityKind = typeof MergeabilityKind.Type;

/**
 * How many open changes of a repository HQ judges again when its `main` moves, newest first; the
 * rest read `unknown` until their detail is read. A push judges its own change.
 */
export const JUDGED_PER_MAIN_MOVE = 20;

/**
 * A change as HQ records it. Its branch is `mate/<mateProjectId>/<number>`; `head` is the commit
 * that branch was last pushed to, none until the first push lands. Once merged, `mergedSha` is the
 * squash on `main` and `landedHead` the head it squashed.
 */
/** Requirements and results supplied by the repository owner for one exact head. */
export const ChangePipeline = Schema.Struct({
  head: Sha,
  requirements: Schema.Literals(["known", "unknown"]),
  checks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      requirement: Schema.Literals(["required", "advisory", "unknown"]),
      state: Schema.Literals(["running", "passed", "failed", "unknown"]),
    }),
  ),
});
export type ChangePipeline = typeof ChangePipeline.Type;

export const HqChange = Schema.Struct({
  pipeline: Schema.optionalKey(ChangePipeline),
  appId: Schema.String,
  repo: RepoName,
  /** Grows within the repository, from 1. */
  number: ChangeNumber,
  /** The Mate's Zerops project. */
  mateProjectId: Schema.String,
  title: ChangeTitle,
  /** Markdown; empty until the Mate describes the change. */
  body: ChangeBody,
  state: ChangeState,
  head: Schema.NullOr(Sha),
  mergedSha: Schema.NullOr(Sha),
  landedHead: Schema.NullOr(Sha),
  openedAt: Instant,
  mergedAt: Schema.NullOr(Instant),
  closedAt: Schema.NullOr(Instant),
  /** Its last push, edit of its words, or comment. */
  updatedAt: Instant,
  /**
   * As HQ judged it on the last push to it or move of `main`
   * ({@link JUDGED_PER_MAIN_MOVE}), or the last read of its detail.
   */
  mergeability: MergeabilityKind,
  /** Whether `main` has moved past the change's merge base, judged with `mergeability`. */
  behind: Schema.Boolean,
  /**
   * On a merged code change: whether it was the first of its application's to merge, no other code
   * change merged before it. Recorded by HQ as it merges. Absent for a change not merged, a recipe
   * repository's, and one merged before HQ recorded it.
   */
  firstCodeMerge: Schema.optionalKey(Schema.Boolean),
  /**
   * Whether it asks for review: the Mate described it at its head. A draft — before its first
   * description, and again after a push the description has not caught up with — stays readable
   * and never asks. Added after the rest: an older HQ's change, which knows no drafts, is ready.
   */
  ready: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  /**
   * How many comments were said on it: the room its review's conversation holds while it reads
   * them. Added after the rest: an older HQ's change counts none.
   */
  comments: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
});
export type HqChange = typeof HqChange.Type;

/** A repository HQ keeps for an application, served at `/git/<appId>/<name>.git`. */
export const HqRepo = Schema.Struct({ appId: Schema.String, name: RepoName });
export type HqRepo = typeof HqRepo.Type;

/**
 * One of an application's repositories as a person reads it: `main`'s head as HQ last recorded it
 * (none before HQ has), and when `main` last moved — the repository's making, before it ever has.
 */
export const RepoListEntry = Schema.Struct({
  name: RepoName,
  mainHead: Schema.NullOr(Sha),
  updatedAt: Instant,
  /** An optional suggestion, read from bounded root metadata at this exact main head. */
  releaseVersion: Schema.optionalKey(
    Schema.Struct({
      tag: Schema.String,
      path: Schema.Literals(["VERSION", "package.json"]),
    }),
  ),
});
export type RepoListEntry = typeof RepoListEntry.Type;

/** `GET /api/apps/:appId/repos`: the application's repositories, its recipe's too, by name. */
export const RepoListResponse = Schema.Struct({ repos: Schema.Array(RepoListEntry) });
export type RepoListResponse = typeof RepoListResponse.Type;

/** `POST /api/mate/repos`: the repository of this name in the Mate's application, made if new. */
export const EnsureRepoRequest = Schema.Struct({ name: RepoName });

/**
 * `POST /api/mate/changes`: the Mate's open change in the repository, or the next number opened
 * with `title`. An open change keeps its title: retitling it is zcp's call, by `PATCH`.
 */
export const OpenChangeRequest = Schema.Struct({
  repo: RepoName,
  title: ChangeTitle,
  /** Git's content hash of the candidate tree, before a change branch exists. */
  tree: Schema.optionalKey(Sha),
});
export const OpenChangeResponse = Schema.Union([
  Schema.Struct({ change: HqChange, created: Schema.Boolean }),
  Schema.Struct({
    change: Schema.Null,
    created: Schema.Literal(false),
    reason: Schema.Literal("nothing_to_deliver"),
  }),
]);
export type OpenChangeResponse = typeof OpenChangeResponse.Type;

/** `PATCH /api/mate/changes/:repo/:n`: the Mate's open change's title, description, or both. */
export const EditChangeRequest = Schema.Struct({
  title: Schema.optionalKey(ChangeTitle),
  body: Schema.optionalKey(ChangeBody),
}).check(
  Schema.makeFilter((edit: { readonly title?: string; readonly body?: string }) =>
    edit.title === undefined && edit.body === undefined ? "Expected a title or a body" : undefined,
  ),
);

/**
 * `POST /api/mate/changes/:repo/:n/attachments`: a picture for the open change's description, sent
 * as the body itself with its raster Content-Type (PNG, JPEG, GIF, WebP or AVIF), at most {@link ATTACHMENT_MAX_BYTES}.
 */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The picture kept: its id, and its path at HQ ({@link attachmentPath}). A description shows it at
 * the official address followed by that path, the address zcp already speaks to.
 */
export const AttachmentResponse = Schema.Struct({ id: Schema.String, path: Schema.String });
export type AttachmentResponse = typeof AttachmentResponse.Type;

/** How many of a Mate's changes in a repository its own state carries, newest first. */
export const MATE_CHANGES_PER_REPO = 10;

/**
 * One of a Mate's own changes, as the Mate reads its outcome: open, merged, or closed — and its
 * title, so a Mate tells its changes in one repository apart without opening one.
 */
export const MateChange = Schema.Struct({
  repo: RepoName,
  number: ChangeNumber,
  /** Added after the rest: an older HQ's change names none. */
  title: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  state: ChangeState,
  head: Schema.NullOr(Sha),
  mergedSha: Schema.NullOr(Sha),
  landedHead: Schema.NullOr(Sha),
});
export type MateChange = typeof MateChange.Type;

/**
 * What a Mate's own state carries of its changes, beside its record (`@t3tools/shared/mateLink`
 * `MateState`, which `GET /api/mate/self` answers and its link brings down). The application HQ holds the Mate
 * in, by id and by its name now, none for a Mate in no application; and in each of that application's repositories, the
 * Mate's latest {@link MATE_CHANGES_PER_REPO} changes, newest first — its open one, if any, is the
 * newest, since a number is opened only while none is.
 */
export const MateChanges = Schema.Struct({
  appId: Schema.NullOr(Schema.String),
  /** Added after `appId`: an older HQ's state, without it, names none. */
  appName: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  changes: Schema.Array(MateChange),
});
export type MateChanges = typeof MateChanges.Type;

/** How many merged or closed changes of an application its list carries beside the open ones. */
export const CHANGE_LIST_SETTLED = 20;

/**
 * `GET /api/apps/:appId/changes`: the application's open changes and its latest
 * {@link CHANGE_LIST_SETTLED} merged or closed ones, newest first — the same window its stream
 * carries.
 */
export const ChangeListResponse = Schema.Struct({ changes: Schema.Array(HqChange) });
export type ChangeListResponse = typeof ChangeListResponse.Type;

/** Whether a change merges into `main` now, as the git layer judges it (`@t3tools/hq-git`). */
export const Mergeability = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("clean") }),
  Schema.Struct({ kind: Schema.Literal("conflict"), paths: Schema.Array(Schema.String) }),
  /**
   * `empty`: it would change nothing on `main`; `already_merged`; `no_change`: nothing was pushed
   * to it; `unrelated`: it shares no history with `main`.
   */
  Schema.Struct({ kind: Schema.Literals(["empty", "already_merged", "no_change", "unrelated"]) }),
]);
export type Mergeability = typeof Mergeability.Type;

/** A file the change touches against its merge base with `main`: its counts and its patch. */
export const ChangeFile = Schema.Struct({
  path: Schema.String,
  /** Lines added and deleted; none for a binary file. */
  added: Schema.NullOr(Schema.Number),
  deleted: Schema.NullOr(Schema.Number),
  hunks: Schema.String,
  binary: Schema.Boolean,
  /** Whether `hunks` was cut at the read's bound. */
  truncated: Schema.Boolean,
});
export type ChangeFile = typeof ChangeFile.Type;

/** A commit on the change and not on `main`. */
export const ChangeCommit = Schema.Struct({
  sha: Sha,
  /** Its message's first line. */
  subject: Schema.String,
  authorName: Schema.String,
  /** When it was committed. */
  at: Instant,
});
export type ChangeCommit = typeof ChangeCommit.Type;

/** How many commits a comparison names at most: the git layer's bound on a log (`@t3tools/hq-git`). */
export const COMPARE_COMMITS_MAX = 100;

/** How far a comparison counts: the git layer's bound on a walk of history. */
export const COMPARE_COUNT_MAX = 10000;

/**
 * HQ socket `compare` with `base?` and `head`, by the repository's name: the
 * commits git's `base..head` names — reachable from `head`, not from `base` — and with no
 * `base`, every commit up to `head`. Both are commits anywhere in the repository's history, and
 * `base` need not come before `head`: a rollback asks both ways, what leaves (`target..running`)
 * and what comes back (`running..target`). Either one not a commit of the repository is `compare-error` with `commit_not_found`.
 */
export const CompareQuery = Schema.Struct({ base: Schema.optionalKey(Sha), head: Sha });
export type CompareQuery = typeof CompareQuery.Type;

/** A commit a comparison names, and the change whose merge it is, where one of this application's is. */
export const CompareCommit = Schema.Struct({
  sha: Sha,
  /** Its message's first line. */
  subject: Schema.String,
  authorName: Schema.String,
  /** When it was committed. */
  at: Instant,
  /** None for a commit no change of HQ's landed: a recipe's, a person's, one from before HQ. */
  change: Schema.NullOr(
    Schema.Struct({ number: ChangeNumber, title: ChangeTitle, mateProjectId: Schema.String }),
  ),
});
export type CompareCommit = typeof CompareCommit.Type;

/**
 * The comparison: its commits newest first, at most {@link COMPARE_COMMITS_MAX} (`truncated` when
 * more lie between), and how many lie between, counted up to {@link COMPARE_COUNT_MAX} — that many
 * means at least as many. None between is an answer too.
 */
export const CompareResponse = Schema.Struct({
  base: Schema.NullOr(Sha),
  head: Sha,
  commits: Schema.Array(CompareCommit),
  truncated: Schema.Boolean,
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CompareResponse = typeof CompareResponse.Type;

/**
 * `GET /api/apps/:appId/changes/:repo/:n`: the change and what its review reads — `main`'s head and
 * the change's merge base with it (behind when they differ), its mergeability, its files with their
 * patches, and its commits, newest first. Reads are bounded; a `…Truncated` flag says one was cut.
 */
export const ChangeDetailQuery = Schema.Struct({
  expectedHead: Schema.optionalKey(Sha),
  expectedMain: Schema.optionalKey(Sha),
});
export type ChangeDetailQuery = typeof ChangeDetailQuery.Type;

export const ChangeDetailResponse = Schema.Struct({
  change: HqChange,
  mainHead: Schema.NullOr(Sha),
  /** None while the change has no head. */
  mergeBase: Schema.NullOr(Sha),
  mergeability: Mergeability,
  files: Schema.Array(ChangeFile),
  filesTruncated: Schema.Boolean,
  commits: Schema.Array(ChangeCommit),
  commitsTruncated: Schema.Boolean,
});
export type ChangeDetailResponse = typeof ChangeDetailResponse.Type;

export const CommentBody = upTo(COMMENT_BODY_MAX).check(
  Schema.makeFilter((body: string) => (body.trim() === "" ? "Expected words" : undefined)),
);

/**
 * A comment on a change, by exactly one author: a person, or a Mate whose words on main's Gitea were
 * brought over by the one-time import (T13). Nothing writes a Mate's any more; a person comments
 * through HQ's API.
 */
export const HqChangeComment = Schema.Struct({
  id: Schema.String,
  /** The Zerops user who wrote it; none for a Mate's. */
  authorUserId: Schema.NullOr(Schema.String),
  /** The Mate's project, for a Mate's. Added after `authorUserId`: an older HQ's comment, without it, is a person's. */
  authorMateProjectId: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  body: CommentBody,
  createdAt: Instant,
});
export type HqChangeComment = typeof HqChangeComment.Type;

/** `GET /api/apps/:appId/changes/:repo/:n/comments`: oldest first. */
export const CommentListResponse = Schema.Struct({ comments: Schema.Array(HqChangeComment) });
export type CommentListResponse = typeof CommentListResponse.Type;

/** `POST /api/apps/:appId/changes/:repo/:n/comments` → the comment ({@link HqChangeComment}). */
export const PostCommentRequest = Schema.Struct({ body: CommentBody });

/**
 * `POST /api/apps/:appId/changes/:repo/:n/merge`, by whoever develops the application: the change
 * squashed into `main` as one commit, if its head is still `expectedHead` — the head the person was
 * shown. HQ moves `main` from where it is then; the client never names it. The commit's subject is
 * {@link mergeSubject}, its body the change's description, its trailers the `Crew-Lane` and
 * `Crew-Assignment` of the change's own commits and `Mate-Change`. → the merged change
 * ({@link HqChange}: `mergedSha` the squash, `landedHead` the head it squashed), or `409 conflict`
 * with one of {@link MERGE_REFUSALS}. Its branch stays.
 */
export const MergeChangeRequest = Schema.Struct({ expectedHead: Sha });

/** A close applies only to the head the person reviewed, including an unpushed change. */
export const CloseChangeRequest = Schema.Struct({ expectedHead: Schema.NullOr(Sha) });

/**
 * Why HQ does not merge: the head moved since it was shown; the change conflicts with `main`, would
 * change nothing, is on `main` already, shares no history with it, has nothing pushed; `main` kept
 * moving; or the change is merged or closed.
 */
export const MERGE_REFUSALS = [
  "head_moved",
  "conflict",
  "empty",
  "already_merged",
  "unrelated",
  "no_change",
  "main_moved",
  "change_not_open",
] as const;

/** A merge's subject on `main`, as Gitea's squash wrote it: what a release reads as the task. */
export function mergeSubject(title: string, number: number): string {
  return `${title} (#${String(number)})`;
}

/**
 * The structure socket's snapshot (`/api/structure/ws`) carries this beside its applications, under
 * `changes`: by application id, each application's changes the reader may read (`read_change`), in
 * the window of {@link ChangeListResponse}.
 */
export const ChangesSnapshot = Schema.Record(Schema.String, Schema.Array(HqChange));
export type ChangesSnapshot = typeof ChangesSnapshot.Type;

/**
 * After the snapshot, the socket sends an application's changes whole, whenever they differ from
 * the last sent: `changes: null` once the reader may no longer read them. A type of its own, so a
 * client that knows only the structure's `change` messages passes it by.
 */
export const ChangesMessage = Schema.Struct({
  type: Schema.Literal("changes"),
  appId: Schema.String,
  changes: Schema.NullOr(Schema.Array(HqChange)),
});
export type ChangesMessage = typeof ChangesMessage.Type;

/** The official address as the anchor names it, without a trailing slash (`hq/anchor.ts`). */
const addressOf = (address: string) => address.replace(/\/+$/u, "");

/** A change's own address at HQ, which HQ redirects into the client: what zcp hands a person. */
export function changeUrl(hqAddress: string, appId: string, repo: string, number: number): string {
  return `${addressOf(hqAddress)}/changes/${appId}/${repo}/${String(number)}`;
}

/** The client's route of a change, where HQ's change address leads. */
export function changeRoutePath(appId: string, repo: string, number: number): string {
  return `/change/${appId}/${repo}/${String(number)}`;
}

export interface ChangeLink {
  readonly appId: string;
  readonly repo: string;
  readonly number: number;
}

/** A picture of a change, as HQ keeps it (`POST /api/mate/changes/:repo/:n/attachments`). */
export interface AttachmentLink extends ChangeLink {
  readonly id: string;
}

/** Where HQ serves a picture of a change, to whoever may read the change. */
export function attachmentPath(appId: string, repo: string, number: number, id: string): string {
  return `/api/apps/${appId}/changes/${repo}/${String(number)}/attachments/${id}`;
}

const CHANGE_PATH = new RegExp(`^/changes/(${ID})/(${ID})/([0-9]+)/?$`, "u");
const ATTACHMENT_PATH = new RegExp(
  `^/api/apps/(${ID})/changes/(${ID})/([0-9]+)/attachments/(${ID})$`,
  "u",
);

/**
 * The path of a link to the official HQ's own origin — scheme, host and port, never a hostname's
 * shape — matched by `path`; `null` for any other link. A query or a fragment is no part of it.
 */
function officialPath(href: string, officialHqAddress: string, path: RegExp) {
  let url: URL;
  let official: URL;
  try {
    url = new URL(href);
    official = new URL(addressOf(officialHqAddress));
  } catch {
    return null;
  }
  return url.origin === official.origin ? path.exec(url.pathname) : null;
}

/** A change's number as a path spells it: a safe positive integer, else nothing. */
const numberOf = (digits: string | undefined) => {
  const number = Number(digits);
  return Number.isSafeInteger(number) && number >= 1 ? number : undefined;
};

/** The change a link to the official HQ names, or `null`. */
export function parseChangeUrl(href: string, officialHqAddress: string): ChangeLink | null {
  const match = officialPath(href, officialHqAddress, CHANGE_PATH);
  const number = numberOf(match?.[3]);
  const [, appId, repo] = match ?? [];
  return appId === undefined || repo === undefined || number === undefined
    ? null
    : { appId, repo, number };
}

/** The picture a link to the official HQ names, or `null`: what the client fetches as the person. */
export function parseAttachmentUrl(href: string, officialHqAddress: string): AttachmentLink | null {
  const match = officialPath(href, officialHqAddress, ATTACHMENT_PATH);
  const number = numberOf(match?.[3]);
  const [, appId, repo, , id] = match ?? [];
  return appId === undefined || repo === undefined || id === undefined || number === undefined
    ? null
    : { appId, repo, number, id };
}
