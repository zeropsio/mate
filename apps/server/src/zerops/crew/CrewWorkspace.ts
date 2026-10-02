/**
 * CrewWorkspace - lanes: a crewmate's own copy of the code on its dev service.
 *
 * A lane is a linked worktree at `.crew/<handle>` on branch `crew/<handle>`,
 * cut from the integration HEAD (H) of `remotePath`. File tools see it through
 * the mount at `<mountPath>/.crew/<handle>`; git runs on the service
 * (CrewShell). Created at Apply, not at dispatch, so the mount sees the
 * directory before the first turn (CONCEPT §3.1).
 *
 * **The exclude line.** `.crew/` is kept in the repository's
 * `info/exclude` (never in the committed `.gitignore`), re-asserted before
 * every WIP commit and every landing. Without it the person's `git add -A`
 * stages a lane as an embedded-repository gitlink.
 *
 * **Git inside a lane is engine-only.** The lane edits files; the engine
 * commits them at turn end under one precondition (`commitTurn`):
 * - an open merge is never committed while a file it left unmerged still
 *   carries a conflict marker (`<<<<<<< `, a lone `=======`, `>>>>>>> `) - in
 *   the tree before `add -A`, or in what `add -A` staged (a file whose staged
 *   content still has one is marked unmerged again). The task goes back as
 *   rework naming the files. Git cannot clear the unmerged set without a
 *   stage and git in a lane is engine-only, so a marker-free file is the
 *   crewmate's resolution and `add -A` concludes the merge; whitespace in a
 *   resolution is not a marker;
 * - three guards run on what is about to be committed: an unignored
 *   dependency directory (delivery's own guard), a staged blob over the size
 *   cap (10 MB unless the crewmate raises it), and `.env`/`.env.*` or key
 *   files whatever their ignore state (DM-7). They read what `add -A` would
 *   stage before anything is staged, so a trip leaves the index as it was,
 *   parks the lane and names the paths;
 * - the engine records every tip it writes; a lane tip it did not write parks
 *   the lane.
 *
 * **Retry, re-queue and failure** run in one order (`keepAndReset`): WIP
 * commit, keep the tip as `refs/t3/crew/<run>/<task>/<attempt>` (run
 * `manual` for a task the person started outside a run; at most
 * {@link ATTEMPT_REFS_PER_LANE} kept per lane), `reset --hard` to the dispatch
 * commit. A tree nobody serves may be reset hard (MG-6's reason does not
 * apply).
 *
 * **Self-deploys and container replacement** keep `.git` but not the lane
 * directories, or revert the disk. `freeze` stops lane writes on a host;
 * `recover` prunes worktrees, verifies every `crew/<handle>` and every
 * recorded landing's `Crew-Assignment:` trailer in H's first-parent history,
 * and re-adds the lanes - or names what was lost. The boot `sweep` re-derives
 * lane state from git, not from the tables.
 *
 * @module CrewWorkspace
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { CrewChecks, type CheckOutcome } from "./CrewChecks.ts";
import {
  CrewShell,
  runFields,
  type CrewGitError,
  field,
  fieldsOf,
  git,
  laneBranch,
  laneDirectory,
  script,
  shellVariable,
  type CrewShellError,
  type ShellVariable,
} from "./CrewShell.ts";
import {
  CrewStore,
  type CrewLaneNotRecorded,
  type CrewLaneRow,
  type CrewStoreError,
} from "./CrewStore.ts";
import { landedAssignmentsScript } from "./crewTrailers.ts";

/** The integration HEAD a lane script read into `$H`. */
const H = shellVariable("H");

/** Git lines in one crewmate's lane. */
const laneGit = (lane: string) => (args: ReadonlyArray<string | ShellVariable>) =>
  git({ lane }, args);

/** A staged blob larger than this parks the lane unless the crewmate raises it. */
export const DEFAULT_MAX_BLOB_BYTES = 10 * 1024 * 1024;

/** Delivery's unignored-dependency guard (zcp `ops/delivery_git.go`). */
const DEPENDENCY_DIRECTORIES = ["node_modules", "vendor", ".venv"] as const;

/** DM-7's `.env`/`.env.*` and key files, committed whatever their ignore state. */
const SECRET_PATH_PATTERN = String.raw`(^|/)(\.env(\..+)?|id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|key|p12|pfx))$`;

/** A conflict marker git writes at the start of a line. */
const CONFLICT_MARKER_PATTERN = "^(<<<<<<< |=======$|>>>>>>> )";

/** Attempt refs kept per lane. */
export const ATTEMPT_REFS_PER_LANE = 3;

/** How long a lane may take to appear through the mount (probe 6). */
const MOUNT_WAIT_ATTEMPTS = 60;
const MOUNT_WAIT_INTERVAL = Duration.millis(500);

/** Every lane script finishes well inside a minute; setup and checks have their own. */
const LANE_SCRIPT_TIMEOUT = Duration.minutes(2);

export type CrewWorkspaceError =
  | CrewShellError
  | CrewGitError
  | CrewStoreError
  | CrewLaneNotRecorded;

/** A writer's lane as the definition declares it. */
export interface LaneSpec {
  readonly crew: string;
  readonly handle: string;
  readonly host: string;
  readonly setup?: string | undefined;
  readonly crewPort?: number | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export type CreateOutcome =
  | { readonly _tag: "created"; readonly head: string; readonly setup?: CheckOutcome }
  | { readonly _tag: "exists"; readonly tip: string }
  | { readonly _tag: "no-head" }
  | { readonly _tag: "no-space"; readonly needKiB: number; readonly availableKiB: number }
  | { readonly _tag: "mount-unseen" };

/** A lane by its crew and crewmate. */
export interface LaneKey {
  readonly crew: string;
  readonly handle: string;
}

export interface TurnCommit {
  readonly assignment: string;
  readonly turn: number;
  readonly maxBlobBytes?: number | undefined;
}

/** Why a lane stopped: a guard tripped, or its tip is not one the engine wrote. */
export type LaneParkReason = "dependencies" | "secrets" | "size" | "unknown-tip";

export type LaneCommit =
  | { readonly _tag: "committed"; readonly tip: string }
  | { readonly _tag: "unchanged"; readonly tip: string }
  /** An open merge whose conflicted files still carry markers; nothing was committed. */
  | {
      readonly _tag: "rework";
      readonly paths: ReadonlyArray<string>;
      /** The rework's reason, naming the files. */
      readonly reason: string;
    }
  | {
      readonly _tag: "parked";
      readonly reason: Exclude<LaneParkReason, "unknown-tip">;
      readonly paths: ReadonlyArray<string>;
    }
  | { readonly _tag: "parked"; readonly reason: "unknown-tip"; readonly tip: string }
  | { readonly _tag: "frozen" }
  | { readonly _tag: "lane-missing" };

export interface KeepInput {
  /** `null` for a task the person started outside a run. */
  readonly run: string | null;
  readonly assignment: string;
  readonly attempt: number;
  /** The conflict-rework cap was reached: abort the open merge first. */
  readonly abortMerge?: boolean | undefined;
}

/** The kept tip, or why the lane could not be committed first. */
export type KeepOutcome =
  | { readonly _tag: "kept"; readonly ref: string; readonly tip: string }
  | Exclude<LaneCommit, { readonly _tag: "committed" | "unchanged" }>;

/** Where an attempt's tip is kept. */
export const attemptRef = (input: Pick<KeepInput, "run" | "assignment" | "attempt">): string =>
  `refs/t3/crew/${input.run ?? "manual"}/${input.assignment}/${input.attempt}`;

export type DispatchOutcome =
  | { readonly _tag: "ready"; readonly dispatchCommit: string; readonly reset: boolean }
  | { readonly _tag: "parked"; readonly reason: "unknown-tip"; readonly tip: string }
  | { readonly _tag: "frozen" }
  | { readonly _tag: "lane-missing" };

export type RecoverOutcome =
  | {
      readonly _tag: "recovered";
      /** Lanes whose directory was added back (and set up again). */
      readonly readded: ReadonlyArray<string>;
      readonly setups: Readonly<Record<string, CheckOutcome>>;
    }
  | {
      readonly _tag: "lost";
      /** Recorded landings no longer in H's first-parent history. */
      readonly landings: ReadonlyArray<{ readonly assignment: string; readonly title: string }>;
      /** Lanes whose `crew/<handle>` is gone. */
      readonly branches: ReadonlyArray<string>;
      /** Lanes whose branch no longer holds the recorded tip; `since` is what survived. */
      readonly wip: ReadonlyArray<{ readonly handle: string; readonly since: string }>;
    };

/** One lane's state as the boot sweep read it from git. */
export type SweepLane = { readonly handle: string } & (
  | { readonly _tag: "clean"; readonly tip: string }
  | { readonly _tag: "committed"; readonly tip: string }
  /** An open merge; its conflicted files go back as rework. */
  | { readonly _tag: "merging"; readonly paths: ReadonlyArray<string> }
  | {
      readonly _tag: "parked";
      readonly reason: LaneParkReason | "unreadable-ref";
      readonly paths: ReadonlyArray<string>;
    }
  | { readonly _tag: "frozen" }
  /** The directory is gone: `recover` brings it back. */
  | { readonly _tag: "missing" }
);

export interface SweepOutcome {
  readonly lanes: ReadonlyArray<SweepLane>;
  /** Refs git ignores as broken (a 0-byte file from an unclean restart). */
  readonly brokenRefs: ReadonlyArray<string>;
}

export type CleanupOutcome =
  | { readonly _tag: "removed" }
  /** Unlanded commits or uncommitted edits: listed with *Discard*, which only the person presses. */
  | { readonly _tag: "kept"; readonly unlanded: number; readonly dirty: boolean };

/** A `crew/*` branch no lane on the host owns: a lost run's work, offered for *Adopt*. */
export interface OrphanBranch {
  readonly handle: string;
  readonly unlanded: number;
}

/** Widens one outcome literal to the union, so a generator's returns agree. */
const laneCommit = (commit: LaneCommit): LaneCommit => commit;

export interface CrewWorkspaceService {
  /** Apply: exclude line, disk floor, `worktree add`, wait for the mount, setup, record. */
  readonly create: (spec: LaneSpec) => Effect.Effect<CreateOutcome, CrewWorkspaceError>;
  /** Retry, re-queue or failure: WIP, keep the tip, reset to the dispatch commit. */
  readonly keepAndReset: (
    key: LaneKey,
    input: KeepInput,
  ) => Effect.Effect<KeepOutcome, CrewWorkspaceError>;
  /**
   * Before a task's first turn: a lane whose tip is its last landing is reset
   * to the current head (stated in the card); records the dispatch commit.
   */
  readonly prepareDispatch: (key: LaneKey) => Effect.Effect<DispatchOutcome, CrewWorkspaceError>;
  /** A self-deploy started on `host`: no lane writes, setup or resets there. */
  readonly freeze: (host: string) => Effect.Effect<ReadonlyArray<LaneKey>, CrewWorkspaceError>;
  readonly unfreeze: (host: string) => Effect.Effect<void, CrewWorkspaceError>;
  /**
   * After a self-deploy, a container replacement, or whenever a lane directory
   * is missing: prune, verify every branch and recorded landing, then re-add
   * the lanes, set them up and unfreeze - or name the loss and stay frozen.
   */
  readonly recover: (
    host: string,
    specs: ReadonlyArray<LaneSpec>,
  ) => Effect.Effect<RecoverOutcome, CrewWorkspaceError>;
  /**
   * Boot: lane state from git, not from the tables - a WIP commit for a dirty
   * lane that is not merging, a park for an unreadable ref or a tip the engine
   * did not write.
   */
  readonly sweep: (host: string) => Effect.Effect<SweepOutcome, CrewWorkspaceError>;
  /**
   * Finish or *Remove from crew*: a clean lane goes (`worktree remove --force`,
   * `branch -D`); one with unlanded work stays unless `discard` is set.
   */
  readonly cleanup: (
    key: LaneKey,
    options?: { readonly discard?: boolean | undefined },
  ) => Effect.Effect<CleanupOutcome, CrewWorkspaceError>;
  /** The explicit *Look for lost crew work* action; never run on its own. */
  readonly orphanScan: (
    host: string,
  ) => Effect.Effect<ReadonlyArray<OrphanBranch>, CrewWorkspaceError>;
  /** Turn end: the lane-commit precondition, then `wip(<task>): turn <n>`. */
  readonly commitTurn: (
    key: LaneKey,
    turn: TurnCommit,
  ) => Effect.Effect<LaneCommit, CrewWorkspaceError>;
}

export class CrewWorkspace extends Context.Service<CrewWorkspace, CrewWorkspaceService>()(
  "t3/zerops/crew/CrewWorkspace",
) {}

/** Idempotent: `.crew/` in the repository's `info/exclude`. */
export const EXCLUDE_LINE = script(
  `exclude=$(${git("integration", ["rev-parse", "--git-path", "info/exclude"])}) || exit 1\n` +
    `mkdir -p "$(dirname "$exclude")" && ` +
    `{ grep -qxF '.crew/' "$exclude" 2>/dev/null || printf '%s\\n' '.crew/' >> "$exclude"; } || exit 1\n`,
);

/**
 * Makes a lane's `.git` file name its gitdir relative to the lane. Git before
 * 2.48 writes it absolute (`--relative-paths` is newer than the services'
 * git), and the zcp container reaches the tree through its mount at another
 * path, where an absolute gitdir names nothing. The worktree's own
 * `commondir` is relative already.
 */
const relativeGitdir = (handle: string): string => {
  const file = shellQuote(`${laneDirectory(handle)}/.git`);
  return (
    `gitdir=$(sed -n 's/^gitdir: //p' ${file})\n` +
    `case "$gitdir" in /*) printf 'gitdir: ../../.git/worktrees/%s\\n' "\${gitdir##*/.git/worktrees/}" > ${file} || exit 1 ;; esac\n`
  );
};

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;
  const checks = yield* CrewChecks;
  const store = yield* CrewStore;
  const fileSystem = yield* FileSystem.FileSystem;

  const runLane = (host: string, operation: string, body: string) =>
    runFields(shell, host, operation, body, LANE_SCRIPT_TIMEOUT);

  /** Polls the mount until the lane directory is there. */
  const seenThroughMount = (host: string, handle: string) =>
    Effect.gen(function* () {
      const repository = yield* shell.repository(host);
      const path = `${repository.mountPath}/${laneDirectory(handle)}`;
      for (let attempt = 0; attempt < MOUNT_WAIT_ATTEMPTS; attempt += 1) {
        if (yield* fileSystem.exists(path).pipe(Effect.orElseSucceed(() => false))) return true;
        yield* Effect.sleep(MOUNT_WAIT_INTERVAL);
      }
      return false;
    });

  /**
   * The lane-commit precondition and the commit, one ssh script. Guards read
   * what `add -A` would stage before anything is staged, so a trip leaves the
   * index - and an open merge - exactly as they were.
   */
  const commitLane = (row: CrewLaneRow, message: string, maxBlobBytes: number) =>
    Effect.gen(function* () {
      if (row.frozenSince !== null) return laneCommit({ _tag: "frozen" });
      const lane = shellQuote(laneDirectory(row.lane));
      const lg = laneGit(row.lane);
      const out = yield* runLane(
        row.host,
        "commitTurn",
        EXCLUDE_LINE +
          `[ -d ${lane} ] || { printf 'status\\tlane-missing\\n'; exit 0; }\n` +
          `tip=$(${lg(["rev-parse", "HEAD"])}) || exit 1\n` +
          `[ "$tip" = ${shellQuote(row.recordedTip ?? "")} ] || { printf 'status\\tunknown-tip\\ntip\\t%s\\n' "$tip"; exit 0; }\n` +
          `merging=0; ${lg(["rev-parse", "-q", "--verify", "MERGE_HEAD"])} >/dev/null && merging=1\n` +
          `deps=''\n` +
          `for d in ${DEPENDENCY_DIRECTORIES.join(" ")}; do\n` +
          `  if [ -d ${lane}/"$d" ] && ! ${lg(["check-ignore", "-q"])} "$d"; then deps="$deps $d"; fi\n` +
          `done\n` +
          `[ -z "$deps" ] || { printf 'status\\tparked\\nguard\\tdependencies\\n'; for d in $deps; do printf 'path\\t%s\\n' "$d"; done; exit 0; }\n` +
          `unmerged=$(mktemp) && pending=$(mktemp) || exit 1\n` +
          `trap 'rm -f "$unmerged" "$pending"' EXIT\n` +
          `${lg(["diff", "--name-only", "--diff-filter=U"])} > "$unmerged" || exit 1\n` +
          `{ cat "$unmerged" && ${lg(["add", "-A", "--dry-run"])} | sed -n "s/^add '\\(.*\\)'$/\\1/p"; } | sort -u > "$pending" || exit 1\n` +
          `if [ "$merging" = 1 ]; then\n` +
          `  marked=$(while IFS= read -r f; do [ -f ${lane}/"$f" ] && grep -qE '${CONFLICT_MARKER_PATTERN}' ${lane}/"$f" && printf '%s\\n' "$f"; done < "$unmerged")\n` +
          `  [ -z "$marked" ] || { printf 'status\\trework\\n'; printf '%s\\n' "$marked" | sed 's/^/path\t/'; exit 0; }\n` +
          `fi\n` +
          `secrets=$(grep -E '${SECRET_PATH_PATTERN}' "$pending")\n` +
          `[ -z "$secrets" ] || { printf 'status\\tparked\\nguard\\tsecrets\\n'; printf '%s\\n' "$secrets" | sed 's/^/path\t/'; exit 0; }\n` +
          `large=$(while IFS= read -r f; do if [ -f ${lane}/"$f" ] && [ "$(wc -c < ${lane}/"$f" | tr -d ' ')" -gt ${maxBlobBytes} ]; then printf '%s\\n' "$f"; fi; done < "$pending")\n` +
          `[ -z "$large" ] || { printf 'status\\tparked\\nguard\\tsize\\n'; printf '%s\\n' "$large" | sed 's/^/path\t/'; exit 0; }\n` +
          `${lg(["add", "-A"])} || exit 1\n` +
          `if [ "$merging" = 1 ]; then\n` +
          `  marked=$(while IFS= read -r f; do staged=":$f"; ${lg(["show", shellVariable("staged")])} 2>/dev/null | grep -qE '${CONFLICT_MARKER_PATTERN}' && printf '%s\\n' "$f"; done < "$unmerged")\n` +
          `  if [ -n "$marked" ]; then\n` +
          `    printf '%s\\n' "$marked" | while IFS= read -r f; do ${lg(["update-index", "--unresolve", "--", shellVariable("f")])} || exit 1; done || exit 1\n` +
          `    printf 'status\\trework\\n'; printf '%s\\n' "$marked" | sed 's/^/path\t/'; exit 0\n` +
          `  fi\n` +
          `fi\n` +
          `if [ "$merging" = 1 ] || ! ${lg(["diff", "--cached", "--quiet"])}; then\n` +
          `  ${lg(["commit", "-q", "--no-verify", "-m", message])} || exit 1\n` +
          `  printf 'status\\tcommitted\\n'\n` +
          `else\n` +
          `  printf 'status\\tunchanged\\n'\n` +
          `fi\n` +
          `printf 'tip\\t%s\\n' "$(${lg(["rev-parse", "HEAD"])})"\n`,
      );
      const status = field(out, "status");
      const paths = fieldsOf(out, "path");
      const tip = field(out, "tip") ?? "";
      switch (status) {
        case "lane-missing":
          return laneCommit({ _tag: "lane-missing" });
        case "rework":
          return laneCommit({
            _tag: "rework",
            paths,
            reason: `Resolve the conflict markers left in ${paths.join(", ")}`,
          });
        case "unknown-tip":
        case "parked": {
          yield* store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, state: "parked" }));
          return status === "unknown-tip"
            ? laneCommit({ _tag: "parked", reason: "unknown-tip", tip })
            : laneCommit({
                _tag: "parked",
                reason: field(out, "guard") as Exclude<LaneParkReason, "unknown-tip">,
                paths,
              });
        }
        default: {
          yield* store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, recordedTip: tip }));
          return laneCommit({
            _tag: status === "committed" ? "committed" : "unchanged",
            tip,
          });
        }
      }
    });

  const commitTurn: CrewWorkspaceService["commitTurn"] = (key, turn) =>
    store
      .requireLane(key.crew, key.handle)
      .pipe(
        Effect.flatMap((row) =>
          commitLane(
            row,
            `wip(${turn.assignment}): turn ${turn.turn}`,
            turn.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES,
          ),
        ),
      );

  const keepAndReset: CrewWorkspaceService["keepAndReset"] = (key, input) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(key.crew, key.handle);
      const lg = laneGit(row.lane);
      if (input.abortMerge === true && row.frozenSince === null) {
        yield* runLane(
          row.host,
          "keepAndReset",
          `if ${lg(["rev-parse", "-q", "--verify", "MERGE_HEAD"])} >/dev/null; then ${lg(["merge", "--abort"])} || exit 1; fi\n`,
        );
      }
      const committed = yield* commitLane(
        row,
        `wip(${input.assignment}): keep attempt ${input.attempt}`,
        DEFAULT_MAX_BLOB_BYTES,
      );
      if (committed._tag !== "committed" && committed._tag !== "unchanged") return committed;
      const ref = attemptRef(input);
      const lanePattern = (yield* store.assignmentsOf(row.crew, row.lane))
        .map((assignment) => `refs/t3/crew/*/${shellQuote(assignment)}/*`)
        .join("|");
      yield* runLane(
        row.host,
        "keepAndReset",
        `${lg(["update-ref", ref, committed.tip])} || exit 1\n` +
          `${lg(["reset", "-q", "--hard", row.dispatchCommit ?? committed.tip])} || exit 1\n` +
          (lanePattern.length === 0
            ? ""
            : `n=0\n` +
              `for ref in $(${lg(["for-each-ref", "--sort=-refname", "--sort=-creatordate", "--format=%(refname)", "refs/t3/crew/"])}); do\n` +
              `  case "$ref" in refs/t3/crew/landing/*) continue ;; esac\n` +
              `  case "$ref" in ${lanePattern}) n=$((n + 1)); [ "$n" -le ${ATTEMPT_REFS_PER_LANE} ] || ${lg(["update-ref", "-d"])} "$ref" ;; esac\n` +
              `done\n`),
      );
      yield* store.updateLane(row.crew, row.lane, (lane) => ({
        ...lane,
        recordedTip: row.dispatchCommit ?? committed.tip,
      }));
      return { _tag: "kept", ref, tip: committed.tip } satisfies KeepOutcome;
    });

  const prepareDispatch: CrewWorkspaceService["prepareDispatch"] = (key) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(key.crew, key.handle);
      if (row.frozenSince !== null) return { _tag: "frozen" } satisfies DispatchOutcome;
      const lane = shellQuote(laneDirectory(row.lane));
      const lg = laneGit(row.lane);
      const out = yield* runLane(
        row.host,
        "prepareDispatch",
        `[ -d ${lane} ] || { printf 'status\\tlane-missing\\n'; exit 0; }\n` +
          `H=$(${git("integration", ["rev-parse", "HEAD"])}) || exit 1\n` +
          `tip=$(${lg(["rev-parse", "HEAD"])}) || exit 1\n` +
          `[ "$tip" = ${shellQuote(row.recordedTip ?? "")} ] || { printf 'status\\tunknown-tip\\ntip\\t%s\\n' "$tip"; exit 0; }\n` +
          `reset=0\n` +
          `if [ "$tip" = ${shellQuote(row.lastLanding ?? "")} ] && [ "$tip" != "$H" ]; then\n` +
          `  ${lg(["reset", "-q", "--hard", H])} || exit 1\n` +
          `  tip=$H; reset=1\n` +
          `fi\n` +
          `printf 'status\\tready\\ntip\\t%s\\nreset\\t%s\\n' "$tip" "$reset"\n`,
      );
      const status = field(out, "status");
      const tip = field(out, "tip") ?? "";
      if (status === "lane-missing") return { _tag: "lane-missing" } satisfies DispatchOutcome;
      if (status === "unknown-tip") {
        yield* store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, state: "parked" }));
        return { _tag: "parked", reason: "unknown-tip", tip } satisfies DispatchOutcome;
      }
      yield* store.updateLane(row.crew, row.lane, (lane) => ({
        ...lane,
        dispatchCommit: tip,
        recordedTip: tip,
      }));
      return {
        _tag: "ready",
        dispatchCommit: tip,
        reset: field(out, "reset") === "1",
      } satisfies DispatchOutcome;
    });

  const setFrozen = (host: string, frozenSince: string | null) =>
    Effect.gen(function* () {
      const lanes = yield* store.lanesOnHost(host);
      yield* Effect.forEach(lanes, (row) =>
        store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, frozenSince })),
      );
      return lanes.map((row): LaneKey => ({ crew: row.crew, handle: row.lane }));
    });

  const freeze: CrewWorkspaceService["freeze"] = (host) =>
    DateTime.now.pipe(Effect.flatMap((now) => setFrozen(host, DateTime.formatIso(now))));

  const unfreeze: CrewWorkspaceService["unfreeze"] = (host) =>
    setFrozen(host, null).pipe(Effect.asVoid);

  const recover: CrewWorkspaceService["recover"] = (host, specs) =>
    Effect.gen(function* () {
      const lanes = yield* store.lanesOnHost(host);
      const out = yield* runLane(
        host,
        "recover",
        `${git("integration", ["worktree", "prune"])} || exit 1\n` +
          lanes
            .map((row) => {
              const branch = `refs/heads/${laneBranch(row.lane)}`;
              const recorded = shellQuote(row.recordedTip ?? "");
              return (
                `if tip=$(${git("integration", ["rev-parse", "-q", "--verify", branch])}); then\n` +
                `  dir=0; [ -d ${shellQuote(laneDirectory(row.lane))} ] && dir=1\n` +
                `  kept=1; [ -z ${recorded} ] || ${git("integration", ["merge-base", "--is-ancestor", row.recordedTip ?? "", shellVariable("tip")])} 2>/dev/null || kept=0\n` +
                `  printf 'lane\\t%s\\t%s\\t%s\\t%s\\n' ${shellQuote(row.lane)} "$dir" "$kept" "$(${git("integration", ["log", "-1", "--format=%cI", shellVariable("tip")])})"\n` +
                `else\n` +
                `  printf 'missing\\t%s\\n' ${shellQuote(row.lane)}\n` +
                `fi\n`
              );
            })
            .join("") +
          landedAssignmentsScript("HEAD"),
      );
      const landed = new Set(fieldsOf(out, "landed"));
      const lost = (yield* store.landingsOnHost(host))
        .filter((landing) => !landed.has(landing.assignment))
        .map((landing) => ({ assignment: landing.assignment, title: landing.title }));
      const branches = fieldsOf(out, "missing");
      const present = fieldsOf(out, "lane").map((value) => {
        const [handle = "", dir = "", kept = "", since = ""] = value.split("\t");
        return { handle, dir: dir === "1", kept: kept === "1", since };
      });
      const wip = present
        .filter((lane) => !lane.kept)
        .map((lane) => ({ handle: lane.handle, since: lane.since }));
      if (lost.length > 0 || branches.length > 0 || wip.length > 0) {
        yield* Effect.forEach(
          lanes.filter((row) => branches.includes(row.lane)),
          (row) => store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, state: "lost" })),
        );
        return { _tag: "lost", landings: lost, branches, wip } satisfies RecoverOutcome;
      }
      const readded = present.filter((lane) => !lane.dir).map((lane) => lane.handle);
      if (readded.length > 0) {
        yield* runLane(
          host,
          "recover",
          readded
            .map(
              (handle) =>
                `${git("integration", ["worktree", "add", "-q", laneDirectory(handle), laneBranch(handle)])} || exit 1\n` +
                relativeGitdir(handle),
            )
            .join(""),
        );
      }
      const setups: Record<string, CheckOutcome> = {};
      for (const handle of readded) {
        yield* seenThroughMount(host, handle);
        const spec = specs.find((candidate) => candidate.handle === handle);
        if (spec?.setup !== undefined) {
          setups[handle] = yield* checks.run({
            host,
            lane: handle,
            kind: "setup",
            command: spec.setup,
            crewPort: spec.crewPort,
            env: spec.env,
          });
        }
      }
      yield* setFrozen(host, null);
      return { _tag: "recovered", readded, setups } satisfies RecoverOutcome;
    });

  const sweep: CrewWorkspaceService["sweep"] = (host) =>
    Effect.gen(function* () {
      const lanes = yield* store.lanesOnHost(host);
      const out = yield* runLane(
        host,
        "sweep",
        `${git("integration", ["for-each-ref", "--format=%(refname)"])} 2>&1 >/dev/null | sed -n 's/^warning: ignoring broken ref /broken\t/p'\n` +
          lanes
            .map((row) => {
              const lg = laneGit(row.lane);
              const handle = shellQuote(row.lane);
              return (
                `if [ -d ${shellQuote(laneDirectory(row.lane))} ]; then\n` +
                relativeGitdir(row.lane) +
                `  tip=$(${lg(["rev-parse", "-q", "--verify", "HEAD"])} 2>/dev/null) || tip=\n` +
                `  merging=0; ${lg(["rev-parse", "-q", "--verify", "MERGE_HEAD"])} >/dev/null 2>&1 && merging=1\n` +
                `  dirty=0; [ -z "$(${lg(["status", "--porcelain"])} 2>/dev/null)" ] || dirty=1\n` +
                `  printf 'lane\\t%s\\t%s\\t%s\\t%s\\n' ${handle} "$tip" "$merging" "$dirty"\n` +
                `  [ "$merging" = 0 ] || ${lg(["diff", "--name-only", "--diff-filter=U"])} | sed 's/^/unmerged\t${row.lane}\t/'\n` +
                `else\n` +
                `  printf 'missing\\t%s\\n' ${handle}\n` +
                `fi\n`
              );
            })
            .join(""),
      );
      const brokenRefs = fieldsOf(out, "broken");
      const missing = new Set(fieldsOf(out, "missing"));
      const read = new Map(
        fieldsOf(out, "lane").map((value) => {
          const [handle = "", tip = "", merging = "", dirty = ""] = value.split("\t");
          return [handle, { tip, merging: merging === "1", dirty: dirty === "1" }] as const;
        }),
      );
      const unmerged = fieldsOf(out, "unmerged").map((value) => {
        const tab = value.indexOf("\t");
        return [value.slice(0, tab), value.slice(tab + 1)] as const;
      });
      const park = (row: CrewLaneRow) =>
        store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, state: "parked" }));
      const swept = yield* Effect.forEach(lanes, (row) =>
        Effect.gen(function* () {
          const handle = row.lane;
          const state = read.get(handle);
          if (missing.has(handle) || state === undefined) {
            return { handle, _tag: "missing" } satisfies SweepLane;
          }
          if (state.tip === "" || brokenRefs.includes(`refs/heads/${laneBranch(handle)}`)) {
            yield* park(row);
            return {
              handle,
              _tag: "parked",
              reason: "unreadable-ref",
              paths: [],
            } satisfies SweepLane;
          }
          if (state.tip !== row.recordedTip) {
            yield* park(row);
            return {
              handle,
              _tag: "parked",
              reason: "unknown-tip",
              paths: [state.tip],
            } satisfies SweepLane;
          }
          if (state.merging) {
            const paths = unmerged.filter(([lane]) => lane === handle).map(([, path]) => path);
            return { handle, _tag: "merging", paths } satisfies SweepLane;
          }
          if (!state.dirty) return { handle, _tag: "clean", tip: state.tip } satisfies SweepLane;
          const committed = yield* commitLane(
            row,
            "wip(sweep): lane work left uncommitted at boot",
            DEFAULT_MAX_BLOB_BYTES,
          );
          switch (committed._tag) {
            case "committed":
            case "unchanged":
              return { handle, _tag: "committed", tip: committed.tip } satisfies SweepLane;
            case "rework":
              return { handle, _tag: "merging", paths: committed.paths } satisfies SweepLane;
            case "parked":
              return {
                handle,
                _tag: "parked",
                reason: committed.reason,
                paths: committed.reason === "unknown-tip" ? [committed.tip] : committed.paths,
              } satisfies SweepLane;
            case "frozen":
            case "lane-missing":
              return {
                handle,
                _tag: committed._tag === "frozen" ? "frozen" : "missing",
              } satisfies SweepLane;
          }
        }),
      );
      return { lanes: swept, brokenRefs } satisfies SweepOutcome;
    });

  const cleanup: CrewWorkspaceService["cleanup"] = (key, options) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(key.crew, key.handle);
      const directory = shellQuote(laneDirectory(row.lane));
      const branch = `refs/heads/${laneBranch(row.lane)}`;
      const out = yield* runLane(
        row.host,
        "cleanup",
        `tip=$(${git("integration", ["rev-parse", "-q", "--verify", branch])}) || tip=\n` +
          (options?.discard === true
            ? ""
            : `dirty=0; [ ! -d ${directory} ] || [ -z "$(${git({ lane: row.lane }, ["status", "--porcelain"])})" ] || dirty=1\n` +
              `unlanded=0; [ -z "$tip" ] || unlanded=$(${git("integration", ["rev-list", "--count", "HEAD..refs/heads/" + laneBranch(row.lane)])}) || exit 1\n` +
              `if [ "$dirty" = 1 ] || [ "$unlanded" -gt 0 ]; then printf 'status\\tkept\\nunlanded\\t%s\\ndirty\\t%s\\n' "$unlanded" "$dirty"; exit 0; fi\n`) +
          `[ ! -d ${directory} ] || ${git("integration", ["worktree", "remove", "--force", laneDirectory(row.lane)])} || exit 1\n` +
          `${git("integration", ["worktree", "prune"])} || exit 1\n` +
          `[ -z "$tip" ] || ${git("integration", ["branch", "-q", "-D", laneBranch(row.lane)])} || exit 1\n` +
          `printf 'status\\tremoved\\n'\n`,
      );
      if (field(out, "status") === "kept") {
        return {
          _tag: "kept",
          unlanded: Number(field(out, "unlanded")),
          dirty: field(out, "dirty") === "1",
        } satisfies CleanupOutcome;
      }
      yield* store.deleteLane(row.crew, row.lane);
      return { _tag: "removed" } satisfies CleanupOutcome;
    });

  const orphanScan: CrewWorkspaceService["orphanScan"] = (host) =>
    Effect.gen(function* () {
      const known = new Set((yield* store.lanesOnHost(host)).map((row) => row.lane));
      const out = yield* runLane(
        host,
        "orphanScan",
        `for handle in $(${git("integration", ["for-each-ref", "--format=%(refname:strip=3)", "refs/heads/crew/"])}); do\n` +
          `  printf 'branch\\t%s\\t%s\\n' "$handle" "$(${git("integration", ["rev-list", "--count"])} "HEAD..refs/heads/crew/$handle")"\n` +
          `done\n`,
      );
      return fieldsOf(out, "branch")
        .map((value) => {
          const [handle = "", unlanded = "0"] = value.split("\t");
          return { handle, unlanded: Number(unlanded) };
        })
        .filter((branch) => !known.has(branch.handle));
    });

  const create: CrewWorkspaceService["create"] = (spec) =>
    Effect.gen(function* () {
      const directory = shellQuote(laneDirectory(spec.handle));
      const branch = laneBranch(spec.handle);
      const out = yield* runLane(
        spec.host,
        "create",
        EXCLUDE_LINE +
          `H=$(${git("integration", ["rev-parse", "-q", "--verify", "HEAD^{commit}"])}) || { printf 'status\\tno-head\\n'; exit 0; }\n` +
          `if [ -e ${directory} ]; then\n` +
          relativeGitdir(spec.handle) +
          `  printf 'status\\texists\\ntip\\t%s\\n' "$(${git({ lane: spec.handle }, ["rev-parse", "HEAD"])})"; exit 0\n` +
          `fi\n` +
          `need=$(${git("integration", ["ls-tree", "-r", "-l", H])} | awk '{ s += $4 } END { printf "%d", 2 * (int(s / 1024) + 1) }')\n` +
          `available=$(df -Pk . | awk 'NR == 2 { print $4 }')\n` +
          `if [ "$available" -lt "$need" ]; then printf 'status\\tno-space\\nneed\\t%s\\navailable\\t%s\\n' "$need" "$available"; exit 0; fi\n` +
          `if ${git("integration", ["rev-parse", "-q", "--verify", `refs/heads/${branch}`])} >/dev/null; then\n` +
          `  ${git("integration", ["worktree", "add", "-q", laneDirectory(spec.handle), branch])} || exit 1\n` +
          `else\n` +
          `  ${git("integration", ["worktree", "add", "-q", laneDirectory(spec.handle), "-b", branch, H])} || exit 1\n` +
          `fi\n` +
          relativeGitdir(spec.handle) +
          `printf 'status\\tcreated\\nhead\\t%s\\ntip\\t%s\\n' "$H" "$(${git({ lane: spec.handle }, ["rev-parse", "HEAD"])})"\n`,
      );
      const status = field(out, "status");
      if (status === "no-head") return { _tag: "no-head" } satisfies CreateOutcome;
      if (status === "no-space") {
        return {
          _tag: "no-space",
          needKiB: Number(field(out, "need")),
          availableKiB: Number(field(out, "available")),
        } satisfies CreateOutcome;
      }
      const tip = field(out, "tip") ?? "";
      if (status === "exists") return { _tag: "exists", tip } satisfies CreateOutcome;
      if (!(yield* seenThroughMount(spec.host, spec.handle))) {
        return { _tag: "mount-unseen" } satisfies CreateOutcome;
      }
      const setup =
        spec.setup === undefined
          ? undefined
          : yield* checks.run({
              host: spec.host,
              lane: spec.handle,
              kind: "setup",
              command: spec.setup,
              crewPort: spec.crewPort,
              env: spec.env,
            });
      yield* store.putLane({
        crew: spec.crew,
        lane: spec.handle,
        host: spec.host,
        branch,
        dispatchCommit: tip,
        recordedTip: tip,
        lastLanding: null,
        refSnapshot: null,
        lockfileHash: null,
        frozenSince: null,
        state: "ready",
      });
      const head = field(out, "head") ?? tip;
      return (
        setup === undefined ? { _tag: "created", head } : { _tag: "created", head, setup }
      ) satisfies CreateOutcome;
    });

  return CrewWorkspace.of({
    create,
    prepareDispatch,
    freeze,
    unfreeze,
    recover,
    sweep,
    cleanup,
    orphanScan,
    commitTurn,
    keepAndReset,
  });
});

export const layer = Layer.effect(CrewWorkspace, make);
