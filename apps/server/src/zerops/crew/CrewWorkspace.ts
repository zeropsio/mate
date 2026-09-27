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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { CrewChecks, type CheckOutcome } from "./CrewChecks.ts";
import {
  CrewGitError,
  CrewShell,
  field,
  fields,
  git,
  laneBranch,
  laneDirectory,
  script,
  shellVariable,
  type CrewShellError,
} from "./CrewShell.ts";
import { CrewStore, type CrewStoreError } from "./CrewStore.ts";

/** The integration HEAD a lane script read into `$H`. */
const H = shellVariable("H");

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

export interface CrewWorkspaceService {
  /** Apply: exclude line, disk floor, `worktree add`, wait for the mount, setup, record. */
  readonly create: (spec: LaneSpec) => Effect.Effect<CreateOutcome, CrewWorkspaceError>;
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

  return CrewWorkspace.of({ create });
});

export const layer = Layer.effect(CrewWorkspace, make);
