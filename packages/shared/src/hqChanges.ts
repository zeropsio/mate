/**
 * A Mate's changes in HQ (SPEC §3.2a), what replaces a pull request: the wire between HQ, zcp and
 * the client. A change is HQ's record of a Mate's work toward `main` in one repository of its
 * application, on a branch: the one it was opened on, `mate/<Mate's project id>/<number>` where it
 * named none. A Mate has at most one open change per repository, and a branch is one open change's. HQ checks every body it reads with these schemas; zcp reads this file as
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
 *   as the password. A Mate fetches its application's repositories and pushes any branch but
 *   `main`, only forward: never a branch another Mate's open change is on (`not_your_ref`), nor one
 *   whose change was merged or closed until a change is opened on it again (`change_closed`), nor
 *   under `mate/` but its own change's (`unknown_change`), nor a tag. Nobody deletes a branch and `main` moves only by HQ's merge. A push refused is refused per
 *   ref in git's own report.
 *
 * **A person's side**, `Authorization: Bearer <session>`, wherever they may read the application:
 *
 * - `GET /api/apps/:appId/repos` → {@link RepoListResponse};
 * - `PUT /api/apps/:appId/repos/:repo/upstream` {@link FollowRepoUpstreamRequest} → `204`, by a
 *   structure writer: HQ keeps the repository's code, made if new, and follows the GitHub
 *   repository at `url` — fetched by the application's Mates (`MateRepo.origin`, `follow`), never
 *   pushed to, no token kept;
 * - HQ socket `compare` (`appId`, `repo`, {@link CompareQuery}) → {@link CompareResponse}: the
 *   commits between two of a repository's commits, each with the change that landed it;
 * - `GET /api/apps/:appId/changes` → {@link ChangeListResponse};
 * - `GET /api/apps/:appId/changes/:repo/:n` → {@link ChangeDetailResponse};
 * - `GET`, `POST /api/apps/:appId/changes/:repo/:n/comments` → {@link CommentListResponse},
 *   {@link HqChangeComment};
 * - `POST /api/apps/:appId/changes/:repo/:n/merge` {@link MergeChangeRequest} and `POST …/close`,
 *   by whoever develops the application → the change, merged or closed; `POST …/hand`
 *   {@link HandChangeRequest}, by whoever may close it → the change, its gone Mate's no longer;
 * - `GET` {@link attachmentPath} → the picture with its detected raster Content-Type;
 * - the structure socket carries changes too: {@link ChangesSnapshot}, {@link ChangesMessage};
 *   and its load data (`hqAppReads.ts`);
 * - a change's address, {@link changeUrl}, is HQ's: `GET /changes/<appId>/<repo>/<n>` redirects
 *   (`302`) to the first client origin HQ answers, at {@link changeRoutePath}.
 *
 * **Answers.** A refusal is `{ code, reason }`: `403 forbidden` with a permission's reason
 * (`zeropsPermissions.ts`), `404` `repo_not_found` / `change_not_found` / `attachment_not_found` /
 * `commit_not_found` / `path_not_found`,
 * `409 conflict` `change_not_open` for a change merged or closed, `branch_taken` / `protected_ref`
 * for a change opened on another open change's branch / on `main`, `mate/…` or a full ref,
 * `400 invalid` for a body these
 * schemas refuse, `413 too_large`. Only the HQ that leads serves any of it: a standby answers `503
 * not_active` with `Retry-After` (two instances overlap through a deploy), which is "try again",
 * never a refusal; so is `503 zerops_unavailable`.
 *
 * @module hqChanges
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HqPullRequest } from "./hqGithub.ts";
import { HqDirectGitTarget, HqGitBranch, HqTargetTimestamp } from "./hqEnvironment.ts";

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
 * rest read `unknown` until their detail is read. A task's change is judged beside them, every time:
 * its Mate is told when it stops merging. A push judges its own change.
 */
export const JUDGED_PER_MAIN_MOVE = 20;

/**
 * A branch a change is on: its name under `refs/heads/`, as git takes it (`fix-login`, never
 * `refs/heads/fix-login`); HQ refuses what git would not take.
 */
export const ChangeBranchName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255));

/**
 * A change as HQ records it. `branch` is the branch it is on; `head` is the commit that branch was
 * last pushed to, none until the first push lands. Once merged, `mergedSha` is the
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

/**
 * One part's preview as zcp last left it in the Mate's work session (spec-mate §2.8a.6): its
 * stage service, its last deploy and whether a verify passed after it. `deployedCommit` is the dev
 * HEAD, written only for an `ok` deploy from a clean workspace.
 */
export const ChangeReceiptPart = Schema.Struct({
  /** The part: its `zeropsSetup`. */
  setup: Schema.String,
  previewHostname: Schema.String,
  deploy: Schema.Literals(["ok", "failed", "none"]),
  /** That deploy's time; absent for a preview never deployed (`none`). */
  deployedAt: Schema.optionalKey(Instant),
  workspaceClean: Schema.Boolean,
  deployedCommit: Schema.optionalKey(Sha),
  verified: Schema.Boolean,
});
export type ChangeReceiptPart = typeof ChangeReceiptPart.Type;

/**
 * What zcp says of each part's preview after a push of the change's branch, only for an
 * application of more than one part; its `parts` follow the pair's stages.
 */
export const ChangeReceipt = Schema.Struct({
  at: Instant,
  parts: Schema.Array(ChangeReceiptPart),
});
export type ChangeReceipt = typeof ChangeReceipt.Type;

export const HqChange = Schema.Struct({
  pipeline: Schema.optionalKey(ChangePipeline),
  appId: Schema.String,
  repo: RepoName,
  /** Grows within the repository, from 1. */
  number: ChangeNumber,
  /** The Mate's Zerops project. */
  mateProjectId: Schema.String,
  /**
   * On an open change: its Mate is no longer one of the application's — its project deleted, or
   * taken out of it. A person may close it or hand it to another of the application's Mates
   * ({@link HandChangeRequest}). Absent otherwise, and from an older HQ.
   */
  mateGone: Schema.optionalKey(Schema.Literal(true)),
  /** The branch it is on. Absent from an older HQ, whose changes are all on their default. */
  branch: Schema.optionalKey(ChangeBranchName),
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
   * On a merged change: whether GitHub merged a head no person merged in Mate — merged outside
   * Mate. Absent for a change not merged, and from an older HQ.
   */
  landedOutside: Schema.optionalKey(Schema.Boolean),
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
  /**
   * The pull request it is mirrored to on GitHub, through the organization's GitHub app; absent
   * where its repository mirrors through no app.
   */
  pullRequest: Schema.optionalKey(HqPullRequest),
  /**
   * Since when its branch on GitHub holds commits its head here does not, and its head commits
   * GitHub's does not: nothing is pushed there until either side moves. Absent while they follow.
   */
  mirrorDivergedSince: Schema.optionalKey(HqTargetTimestamp),
  /**
   * The last receipt zcp wrote on it, whole; `null` for a single-part application's change. Added
   * after the rest: an older HQ's change has no key.
   */
  receipt: Schema.optionalKey(Schema.NullOr(ChangeReceipt)),
});
export type HqChange = typeof HqChange.Type;

/** A repository HQ keeps for an application, served at `/git/<appId>/<name>.git`. */
export const HqRepo = Schema.Struct({ appId: Schema.String, name: RepoName });
export type HqRepo = typeof HqRepo.Type;

/** Credential-free repository address; userinfo, query and fragment are never public metadata. */
export const HqRemoteUrl = Schema.String.check(
  Schema.makeFilter((value: string) => {
    try {
      const url = new URL(value);
      return value.trim() === value &&
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.hostname !== "" &&
        url.pathname !== "/" &&
        !/[\s\\]/u.test(value) &&
        !/%(?![0-9a-f]{2})/iu.test(value) &&
        !/(?:^|\/)(?:\.|\.\.)(?:\/|$)/u.test(value) &&
        !Array.from(decodeURIComponent(url.pathname)).some(
          (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        )
        ? undefined
        : "Expected a credential-free HTTPS repository URL";
    } catch {
      return "Expected a credential-free HTTPS repository URL";
    }
  }),
);

/** GitHub supplies a stable repository id; other hosts may prove only the URL. */
export const HqRemoteIdentity = Schema.Struct({
  url: HqRemoteUrl,
  repositoryId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
});
export type HqRemoteIdentity = typeof HqRemoteIdentity.Type;

/**
 * Whether GitHub lets only what Mate approved reach a repository's default branch: `governed` — an
 * active ruleset there requires a pull request and the status `mate/gate` from this HQ's GitHub app,
 * which HQ writes only on a head a person merged in Mate — else advisory, by its first missing
 * step: the app's installation has not approved writing statuses, no ruleset requires a pull
 * request, `mate/gate` is not required, or it is required from any source. Who may bypass the
 * ruleset is GitHub's and unread.
 */
export const HqRepoGovernance = Schema.Literals([
  "governed",
  "permission_not_approved",
  "no_ruleset",
  "gate_not_required",
  "gate_not_pinned",
]);
export type HqRepoGovernance = typeof HqRepoGovernance.Type;

/** Safe custody evidence, never the sealed or plaintext credential. */
export const HqRepoRemote = Schema.Struct({
  ...HqRemoteIdentity.fields,
  keptAt: HqTargetTimestamp,
  keptBy: Schema.String,
  expiresAt: Schema.NullOr(HqTargetTimestamp),
  invalidSince: Schema.NullOr(HqTargetTimestamp),
  /**
   * How HQ reaches it: the organization's GitHub app (no token kept) or a person's token. Absent
   * from an older HQ: a token.
   */
  via: Schema.optionalKey(Schema.Literals(["app", "token"])),
  /**
   * Since when HQ's `main` and the default branch there hold histories neither contains, so the
   * mirror moves neither (`githubMirror.ts`); absent while they follow each other.
   */
  divergedSince: Schema.optionalKey(HqTargetTimestamp),
  /** Through the app only, as the mirror last read GitHub's rules; absent before it has. */
  governance: Schema.optionalKey(HqRepoGovernance),
});
export type HqRepoRemote = typeof HqRepoRemote.Type;

/** A token's expiry reads as its day on every Git surface; an absent expiry header leaves it unknown. */
export const tokenExpiryLabel = (expiresAt: string | null, now?: number) =>
  expiresAt === null
    ? "Expiry not reported"
    : `Token ${now !== undefined && Date.parse(expiresAt) <= now ? "expired" : "expires"} ${expiresAt.slice(0, 10)}`;

/** Candidate token input is confined to the person-facing mutating remote verbs. */
const RemoteToken = Schema.String.check(Schema.isMinLength(1));
export const KeepRepoRemoteRequest = Schema.Struct({ url: HqRemoteUrl, token: RemoteToken });
export type KeepRepoRemoteRequest = typeof KeepRepoRemoteRequest.Type;
export const ReplaceRepoRemoteTokenRequest = Schema.Struct({ token: RemoteToken });
export type ReplaceRepoRemoteTokenRequest = typeof ReplaceRepoRemoteTokenRequest.Type;
export const UpdateRepoRemoteAddressRequest = Schema.Struct({ url: HqRemoteUrl });
export type UpdateRepoRemoteAddressRequest = typeof UpdateRepoRemoteAddressRequest.Type;
export const FollowRepoUpstreamRequest = Schema.Struct({ url: HqRemoteUrl });
export type FollowRepoUpstreamRequest = typeof FollowRepoUpstreamRequest.Type;

/**
 * What a GitHub token may read of the repository's CI, as one read each proved: `granted` (GitHub
 * answered), `missing` (GitHub refused it this permission) or `unknown`. Needed only to show CI;
 * a missing one never refuses the token.
 */
const HqTokenReadAccess = Schema.Literals(["granted", "missing", "unknown"]);
export const HqTokenCiAccess = Schema.Struct({
  checks: HqTokenReadAccess,
  statuses: HqTokenReadAccess,
  actions: HqTokenReadAccess,
});
export type HqTokenCiAccess = typeof HqTokenCiAccess.Type;

/** Host probes return proven facts or a named refusal, never host bodies or credential values. */
export const HqRemoteProbe = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    remote: Schema.Struct({
      ...HqRemoteIdentity.fields,
      expiresAt: Schema.NullOr(HqTargetTimestamp),
      invalidSince: Schema.NullOr(HqTargetTimestamp),
      keptAt: Schema.optionalKey(HqTargetTimestamp),
      keptBy: Schema.optionalKey(Schema.String),
    }),
    /** GitHub tokens only. */
    ci: Schema.optionalKey(HqTokenCiAccess),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.String,
    status: Schema.optionalKey(Schema.Int),
    retryAt: Schema.optionalKey(Schema.NullOr(HqTargetTimestamp)),
  }),
]);
export type HqRemoteProbe = typeof HqRemoteProbe.Type;

/** Both displayed tips fence adoption; the server re-reads them under its repository lock. */
export const HqGitAdoption = Schema.Struct({
  repo: RepoName,
  remote: HqRemoteIdentity,
  branch: HqGitBranch,
  mainHead: Sha,
  remoteHead: Schema.NullOr(Sha),
  branchRules: Schema.optionalKey(Schema.Literal("none_on_plan")),
  /** GitHub only: what the kept token may read of this branch's CI. */
  ci: Schema.optionalKey(HqTokenCiAccess),
  changedFiles: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  seed: Schema.Boolean,
});
export type HqGitAdoption = typeof HqGitAdoption.Type;
export const PreviewGitEnvironmentRequest = Schema.Struct({
  target: HqDirectGitTarget,
});
export type PreviewGitEnvironmentRequest = typeof PreviewGitEnvironmentRequest.Type;
export const AddGitEnvironmentRequest = Schema.Struct({
  tier: Schema.Literals(["stage", "production"]),
  name: Schema.String.check(Schema.isMinLength(1)),
  target: HqDirectGitTarget,
  adoption: Schema.Array(HqGitAdoption).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((value) =>
    value.adoption.every((review) => review.branch === value.target.branch) &&
    new Set(value.adoption.map((review) => review.repo)).size === value.adoption.length
      ? undefined
      : "Expected each repository once at the reviewed branch",
  ),
);
export type AddGitEnvironmentRequest = typeof AddGitEnvironmentRequest.Type;

/**
 * One of an application's repositories as a person reads it: `main`'s head as HQ last recorded it
 * (none before HQ has), and when `main` last moved — the repository's making, before it ever has.
 */
export const RepoListEntry = Schema.Struct({
  name: RepoName,
  remote: Schema.optionalKey(Schema.NullOr(HqRepoRemote)),
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

/**
 * One repository of the Mate's application as the Mate reads it: the address of the origin its
 * person connected, never the token HQ keeps for it; none before one is connected — HQ alone keeps
 * the code. `mode` says whose the code is: `github`, mounted through the organization's GitHub app,
 * is GitHub's — HQ follows it; `follow`, connected with a person's token, is HQ's, the origin an
 * upstream to fetch from. Absent from an older HQ.
 */
export const MateRepo = Schema.Struct({
  name: RepoName,
  origin: Schema.optionalKey(
    Schema.Struct({
      url: HqRemoteUrl,
      mode: Schema.optionalKey(Schema.Literals(["github", "follow"])),
    }),
  ),
});
export type MateRepo = typeof MateRepo.Type;

/** `POST /api/mate/repos`: the repository of this name in the Mate's application, made if new. */
export const EnsureRepoRequest = Schema.Struct({ name: RepoName });

/**
 * `POST /api/mate/changes`: the change a delivery goes to — on a task, the task's own open change
 * (an automated Mate holds one per task it delivered, several waiting for review at once); on none,
 * the Mate's one open change in the repository — or the next number opened with `title`. An open
 * change keeps its title: retitling it is zcp's call, by `PATCH`.
 */
export const OpenChangeRequest = Schema.Struct({
  repo: RepoName,
  title: ChangeTitle,
  /**
   * The branch a new change is on, pushed already or not yet; `mate/<Mate's project id>/<number>`
   * where none is named. Refused `branch_taken` while another open change is on it, and
   * `protected_ref` for `main`, a name under `mate/` (those are HQ's) or under `refs/`. An open
   * change answered as it is keeps its own.
   */
  branch: Schema.optionalKey(ChangeBranchName),
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

/**
 * `PATCH /api/mate/changes/:repo/:n`: the Mate's open change's title, description, its parts'
 * {@link ChangeReceipt}, or any of them.
 */
export const EditChangeRequest = Schema.Struct({
  title: Schema.optionalKey(ChangeTitle),
  body: Schema.optionalKey(ChangeBody),
  receipt: Schema.optionalKey(ChangeReceipt),
}).check(
  Schema.makeFilter(
    (edit: { readonly title?: string; readonly body?: string; readonly receipt?: unknown }) =>
      edit.title === undefined && edit.body === undefined && edit.receipt === undefined
        ? "Expected a title, a body or a receipt"
        : undefined,
  ),
);
export type EditChangeRequest = typeof EditChangeRequest.Type;

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
  /** The branch its work is on. Added after the rest: an older HQ's change names none. */
  branch: Schema.optionalKey(ChangeBranchName),
  /**
   * A change a person handed to this Mate after its own Mate was gone: its work is on `branch`,
   * which this Mate pushes from then on. Absent otherwise.
   */
  handed: Schema.optionalKey(Schema.Literal(true)),
});
export type MateChange = typeof MateChange.Type;

/**
 * What a Mate's own state carries of its changes, beside its record (`@t3tools/shared/mateLink`
 * `MateState`, which `GET /api/mate/self` answers and its link brings down). The application HQ holds the Mate
 * in, by id and by its name now, none for a Mate in no application; and in each of that application's repositories, the
 * Mate's latest {@link MATE_CHANGES_PER_REPO} changes, newest first. An automated Mate may hold
 * several open, one per task; a Mate on no task opens a number only while none of its own is.
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

/**
 * The empty first commit HQ starts every repository it makes on (`madeRepo`), as a comparison names
 * it: by HQ, landed by no change. It carries no code, so it is nobody's change to release.
 */
export const HQ_FIRST_COMMIT = { authorName: "HQ", subject: "Initial commit" } as const;

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
  /**
   * The GitHub login of one said on the change's pull request on GitHub, for one said there; then
   * neither of the others is set.
   */
  authorGithubLogin: Schema.optionalKey(Schema.String),
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
 * `POST /api/apps/:appId/changes/:repo/:n/hand`, by whoever may close the application's changes: an
 * open change whose Mate is gone ({@link HqChange} `mateGone`) becomes the Mate `mateProjectId`'s,
 * on the same branch — from then on that Mate's pushes to the branch are taken and nobody else's
 * Mate's. → the change, or `409 conflict` with one of {@link HAND_REFUSALS}.
 */
export const HandChangeRequest = Schema.Struct({ mateProjectId: Schema.String });

/**
 * Why HQ does not hand a change over: it is merged or closed; its Mate is still the application's;
 * the Mate named is not one of the application's; or it holds an open change of its own in the
 * repository already.
 */
export const HAND_REFUSALS = [
  "change_not_open",
  "change_has_mate",
  "not_app_mate",
  "mate_has_change",
] as const;

/**
 * Why HQ does not merge: the head moved since it was shown; the change conflicts with `main`, would
 * change nothing, is on `main` already, shares no history with it, has nothing pushed; `main` kept
 * moving; or the change is merged or closed. A change mirrored to a pull request merges on GitHub:
 * GitHub's rules (branch protection, required checks) held it back, GitHub refused it otherwise, or
 * did not answer; its pull request was moved to merge into another branch, is not open yet, or was
 * closed there; or GitHub merged it and HQ has not followed yet.
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
  "github_blocked",
  "github_refused",
  "github_unreachable",
  "github_wrong_base",
  "github_no_pull",
  "github_closed",
  "github_landing",
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
