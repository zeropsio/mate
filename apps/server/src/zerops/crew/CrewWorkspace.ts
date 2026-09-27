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
 * - an open merge with conflicts is never committed - the task goes back as
 *   rework naming the files; a merge concludes only when no conflict marker
 *   remains in the merged changes;
 * - three guards run on what is about to be committed: an unignored
 *   dependency directory (delivery's own guard), a staged blob over the size
 *   cap (10 MB unless the crewmate raises it), and `.env`/`.env.*` or key
 *   files whatever their ignore state (DM-7). A trip unstages, parks the lane
 *   and names the paths;
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
import * as Option from "effect/Option";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { CrewChecks, type CheckOutcome } from "./CrewChecks.ts";
import {
  CrewGitError,
  CrewShell,
  field,
  fields,
  fieldsOf,
  git,
  laneBranch,
  laneDirectory,
  script,
  shellVariable,
  type CrewShellError,
  type ShellVariable,
} from "./CrewShell.ts";
import { CrewStore, type CrewLaneRow, type CrewStoreError } from "./CrewStore.ts";

/** The integration HEAD a lane script read into `$H`. */
const H = shellVariable("H");

/** Git lines in one crewmate's lane. */
const laneGit = (lane: string) => (args: ReadonlyArray<string | ShellVariable>) =>
  git({ lane }, args);

/** A staged blob larger than this parks the lane unless the crewmate raises it. */
export const DEFAULT_MAX_BLOB_BYTES = 10 * 1024 * 1024;

/** Delivery's unignored-dependency guard (zcp `ops/gitea_branch.go`). */
const DEPENDENCY_DIRECTORIES = ["node_modules", "vendor", ".venv"] as const;

/** DM-7's `.env`/`.env.*` and key files, committed whatever their ignore state. */
const SECRET_PATH_PATTERN = String.raw`(^|/)(\.env(\..+)?|id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|key|p12|pfx))$`;

/** A conflict marker git writes at the start of a line. */
const CONFLICT_MARKER_PATTERN = "^(<<<<<<<|>>>>>>>)( |$)";

/** Attempt refs kept per lane. */
export const ATTEMPT_REFS_PER_LANE = 3;

/** How long a lane may take to appear through the mount (probe 6). */
const MOUNT_WAIT_ATTEMPTS = 60;
const MOUNT_WAIT_INTERVAL = Duration.millis(500);

/** Every lane script finishes well inside a minute; setup and checks have their own. */
const LANE_SCRIPT_TIMEOUT = Duration.minutes(2);

export type CrewWorkspaceError = CrewShellError | CrewGitError | CrewStoreError;

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
  | { readonly _tag: "rework"; readonly paths: ReadonlyArray<string> }
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

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;
  const checks = yield* CrewChecks;
  const store = yield* CrewStore;
  const fileSystem = yield* FileSystem.FileSystem;

  const runLane = (host: string, operation: string, body: string) =>
    shell.run(host, script(body), { timeout: LANE_SCRIPT_TIMEOUT }).pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.succeed(fields(result.stdout))
          : Effect.fail(
              new CrewGitError({
                host,
                operation,
                detail: result.stderr.trim() || `exit ${result.code}`,
              }),
            ),
      ),
    );

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

  const laneRow = (key: LaneKey, operation: string) =>
    store.getLane(key.crew, key.handle).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new CrewGitError({
                host: "",
                operation,
                detail: `no lane is recorded for ${key.crew}/${key.handle}`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

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
          `pending=$(mktemp) || exit 1\n` +
          `trap 'rm -f "$pending"' EXIT\n` +
          `{ ${lg(["diff", "--name-only", "--diff-filter=U"])} && ${lg(["add", "-A", "--dry-run"])} | sed -n "s/^add '\\(.*\\)'$/\\1/p"; } | sort -u > "$pending" || exit 1\n` +
          `if [ "$merging" = 1 ]; then\n` +
          `  marked=$(while IFS= read -r f; do [ -f ${lane}/"$f" ] && grep -qE '${CONFLICT_MARKER_PATTERN}' ${lane}/"$f" && printf '%s\\n' "$f"; done < "$pending")\n` +
          `  [ -z "$marked" ] || { printf 'status\\trework\\n'; printf '%s\\n' "$marked" | sed 's/^/path\t/'; exit 0; }\n` +
          `fi\n` +
          `secrets=$(grep -E '${SECRET_PATH_PATTERN}' "$pending")\n` +
          `[ -z "$secrets" ] || { printf 'status\\tparked\\nguard\\tsecrets\\n'; printf '%s\\n' "$secrets" | sed 's/^/path\t/'; exit 0; }\n` +
          `large=$(while IFS= read -r f; do if [ -f ${lane}/"$f" ] && [ "$(wc -c < ${lane}/"$f" | tr -d ' ')" -gt ${maxBlobBytes} ]; then printf '%s\\n' "$f"; fi; done < "$pending")\n` +
          `[ -z "$large" ] || { printf 'status\\tparked\\nguard\\tsize\\n'; printf '%s\\n' "$large" | sed 's/^/path\t/'; exit 0; }\n` +
          `${lg(["add", "-A"])} || exit 1\n` +
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
          return laneCommit({ _tag: "rework", paths });
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
    laneRow(key, "commitTurn").pipe(
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
      const row = yield* laneRow(key, "keepAndReset");
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
      const row = yield* laneRow(key, "prepareDispatch");
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

  const create: CrewWorkspaceService["create"] = (spec) =>
    Effect.gen(function* () {
      const directory = shellQuote(laneDirectory(spec.handle));
      const branch = laneBranch(spec.handle);
      const out = yield* runLane(
        spec.host,
        "create",
        EXCLUDE_LINE +
          `H=$(${git("integration", ["rev-parse", "-q", "--verify", "HEAD^{commit}"])}) || { printf 'status\\tno-head\\n'; exit 0; }\n` +
          `if [ -e ${directory} ]; then printf 'status\\texists\\ntip\\t%s\\n' "$(${git({ lane: spec.handle }, ["rev-parse", "HEAD"])})"; exit 0; fi\n` +
          `need=$(${git("integration", ["ls-tree", "-r", "-l", H])} | awk '{ s += $4 } END { printf "%d", 2 * (int(s / 1024) + 1) }')\n` +
          `available=$(df -Pk . | awk 'NR == 2 { print $4 }')\n` +
          `if [ "$available" -lt "$need" ]; then printf 'status\\tno-space\\nneed\\t%s\\navailable\\t%s\\n' "$need" "$available"; exit 0; fi\n` +
          `if ${git("integration", ["rev-parse", "-q", "--verify", `refs/heads/${branch}`])} >/dev/null; then\n` +
          `  ${git("integration", ["worktree", "add", "-q", laneDirectory(spec.handle), branch])} || exit 1\n` +
          `else\n` +
          `  ${git("integration", ["worktree", "add", "-q", laneDirectory(spec.handle), "-b", branch, H])} || exit 1\n` +
          `fi\n` +
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
    commitTurn,
    keepAndReset,
  });
});

export const layer = Layer.effect(CrewWorkspace, make);
