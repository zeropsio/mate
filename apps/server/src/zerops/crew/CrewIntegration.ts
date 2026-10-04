/**
 * CrewIntegration - taking the head into a lane, landing a lane into the
 * person's tree, and policing refs (CONCEPT §3.2).
 *
 * **Merge-in.** H is `/var/www`'s HEAD. Unless H is already an ancestor of
 * `crew/<handle>`, the lane runs `git merge --no-edit H`. A conflict leaves
 * the merge open and the task goes back as rework; an empty merge-base means
 * the integration history was rewritten, and the lane waits for triage. The
 * check then runs on exactly the tree that will land.
 *
 * **Landing** runs under the host's landing lock and re-reads H:
 * - a task whose `Crew-Assignment:` trailer is already in H's first-parent
 *   history has landed - a restart mid-landing lands once;
 * - if H is no longer an ancestor of the lane, H moved: merge in again;
 * - otherwise one script: `S = commit-tree crew/<handle>^{tree} -p H` with
 *   the title and both trailers, `update-ref refs/t3/crew/landing/<task> S`,
 *   `merge --ff-only S`, drop the anchor. The anchor keeps S alive through
 *   the bare `git prune` zcli's archiver runs. The squash is correct only
 *   because merge-in made H an ancestor; without it the tree would silently
 *   revert integration work.
 *
 * A refusal is classified from git's stderr (`classifyLandingRefusal`); a
 * fast-forward never writes the person's index beyond the paths it lands, so
 * their unrelated edits - staged or not - stay as they were.
 *
 * **Ref policing.** At dispatch a lane's policed refs are snapshotted; at
 * turn end a change nobody explains parks the lane. Other lanes' branches are
 * explained by their recorded tips, the engine's own writes by the caller.
 * The integration branch is the person's: it is judged by content instead -
 * every recorded landing's trailer must stay in its first-parent history.
 *
 * @module CrewIntegration
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { classifyLandingRefusal, type LandingRefusal } from "./classifyLandingRefusal.ts";
import {
  CrewShell,
  field,
  fieldsOf,
  git,
  laneBranch,
  laneDirectory,
  runFields,
  shellVariable,
  type CrewGitError,
  type CrewShellError,
  type ShellVariable,
} from "./CrewShell.ts";
import {
  CrewStore,
  type CrewLaneNotRecorded,
  type CrewLaneRow,
  type CrewStoreError,
} from "./CrewStore.ts";
import { landingTrailers, operationMessage } from "./crewTrailers.ts";
import { EXCLUDE_LINE, type LaneKey } from "./CrewWorkspace.ts";

export type CrewIntegrationError =
  | CrewShellError
  | CrewGitError
  | CrewStoreError
  | CrewLaneNotRecorded;

/** Lockfiles whose change after a merge-in means the lane's setup runs again. */
const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock",
  "mix.lock",
] as const;

const INTEGRATION_SCRIPT_TIMEOUT = Duration.minutes(2);

const H = shellVariable("H");
const S = shellVariable("S");

export type MergeOutcome =
  | { readonly _tag: "current"; readonly head: string }
  | {
      readonly _tag: "merged";
      readonly head: string;
      readonly tip: string;
      readonly lockfileChanged: boolean;
    }
  /** The merge is left open; the task goes back as rework naming the files. */
  | { readonly _tag: "conflict"; readonly head: string; readonly paths: ReadonlyArray<string> }
  /** No merge-base: the integration history was rewritten. */
  | { readonly _tag: "unrelated"; readonly head: string }
  | LaneNotReady;

/** Shared refusals before any git write. */
export type LaneNotReady =
  | { readonly _tag: "frozen" }
  | { readonly _tag: "lane-missing" }
  | { readonly _tag: "uncommitted" }
  | { readonly _tag: "unknown-tip"; readonly tip: string };

export interface LandInput extends LaneKey {
  readonly assignment: string;
  /** The task's title; its first line is the landing's subject. */
  readonly title: string;
  /** The copy's tip its check passed on: any other tip is refused `unchecked`. */
  readonly checkedTip?: string | undefined;
}

export type LandOutcome =
  | { readonly _tag: "landed"; readonly commit: string }
  | { readonly _tag: "already-landed"; readonly commit: string }
  /** The lane holds nothing of its own: no commit ahead of your tree, or its tree is yours. */
  | { readonly _tag: "nothing" }
  | { readonly _tag: "head-moved"; readonly head: string }
  | { readonly _tag: "refused"; readonly refusal: LandingRefusal }
  /** The copy is not the tree its check passed on. */
  | { readonly _tag: "unchecked"; readonly tip: string }
  | LaneNotReady;

export interface RefChange {
  readonly ref: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface CrewIntegrationService {
  readonly landingEvidence: (
    host: string,
    assignment: string,
  ) => Effect.Effect<string | null, CrewIntegrationError>;
  /** `operation` names the merge commit's `Crew-Operation:` trailer. */
  readonly mergeIn: (
    key: LaneKey,
    operation?: string,
  ) => Effect.Effect<MergeOutcome, CrewIntegrationError>;
  readonly land: (input: LandInput) => Effect.Effect<LandOutcome, CrewIntegrationError>;
  /** Dispatch: record the lane's policed refs. */
  readonly snapshotRefs: (
    key: LaneKey,
  ) => Effect.Effect<Readonly<Record<string, string>>, CrewIntegrationError>;
  /**
   * Turn end: policed refs that changed since the snapshot and are not
   * explained; any parks the lane. `explained` are refs the engine wrote.
   */
  readonly police: (
    key: LaneKey,
    explained?: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<RefChange>, CrewIntegrationError>;
}

export class CrewIntegration extends Context.Service<CrewIntegration, CrewIntegrationService>()(
  "t3/zerops/crew/CrewIntegration",
) {}

/** The refs a lane's turn has no business moving (CONCEPT §3.2 *Ref policing*). */
const POLICED_PREFIXES = ["refs/heads/", "refs/t3/crew/", "refs/t3/crew-state/", "refs/tags/"];

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  const landingLocks = new Map<string, Semaphore.Semaphore>();
  const landingLock = (host: string) => {
    const existing = landingLocks.get(host);
    if (existing !== undefined) return existing;
    const created = Semaphore.makeUnsafe(1);
    landingLocks.set(host, created);
    return created;
  };

  const run = (host: string, operation: string, body: string) =>
    runFields(shell, host, operation, body, INTEGRATION_SCRIPT_TIMEOUT);

  /** Refuses a frozen, missing, dirty or foreign-tipped lane before any write. */
  const laneReady = (row: CrewLaneRow): string =>
    `[ -d ${shellQuote(laneDirectory(row.lane))} ] || { printf 'status\\tlane-missing\\n'; exit 0; }\n` +
    `tip=$(${git({ lane: row.lane }, ["rev-parse", "HEAD"])}) || exit 1\n` +
    `[ "$tip" = ${shellQuote(row.recordedTip ?? "")} ] || { printf 'status\\tunknown-tip\\ntip\\t%s\\n' "$tip"; exit 0; }\n` +
    `[ -z "$(${git({ lane: row.lane }, ["status", "--porcelain"])})" ] || { printf 'status\\tuncommitted\\n'; exit 0; }\n`;

  const notReady = (
    status: string | undefined,
    out: ReadonlyArray<readonly [string, string]>,
  ): LaneNotReady | undefined =>
    status === "lane-missing"
      ? { _tag: "lane-missing" }
      : status === "uncommitted"
        ? { _tag: "uncommitted" }
        : status === "unknown-tip"
          ? { _tag: "unknown-tip", tip: field(out, "tip") ?? "" }
          : undefined;

  const mergeIn: CrewIntegrationService["mergeIn"] = (key, operation) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(key.crew, key.handle);
      if (row.frozenSince !== null) return { _tag: "frozen" } satisfies MergeOutcome;
      const lg = (args: ReadonlyArray<string | ShellVariable>) => git({ lane: row.lane }, args);
      const out = yield* run(
        row.host,
        "mergeIn",
        laneReady(row) +
          `H=$(${git("integration", ["rev-parse", "--verify", "HEAD^{commit}"])}) || exit 1\n` +
          `printf 'head\\t%s\\n' "$H"\n` +
          `${lg(["merge-base", H, "HEAD"])} >/dev/null || { printf 'status\\tunrelated\\n'; exit 0; }\n` +
          `if ${lg(["merge-base", "--is-ancestor", H, "HEAD"])}; then printf 'status\\tcurrent\\n'; exit 0; fi\n` +
          `if ${lg(["merge", "-q", "--no-verify", "-m", operationMessage("Merge your tree", operation), H])} >/dev/null 2>&1; then\n` +
          `  printf 'status\\tmerged\\ntip\\t%s\\n' "$(${lg(["rev-parse", "HEAD"])})"\n` +
          `  ${lg(["diff", "--name-only", shellVariable("tip"), "HEAD", "--", ...LOCKFILES.map((name) => `:(glob)**/${name}`)])} | sed 's/^/lockfile\t/'\n` +
          `elif ${lg(["rev-parse", "-q", "--verify", "MERGE_HEAD"])} >/dev/null; then\n` +
          `  printf 'status\\tconflict\\n'\n` +
          `  ${lg(["diff", "--name-only", "--diff-filter=U"])} | sed 's/^/path\t/'\n` +
          `else\n` +
          `  exit 1\n` +
          `fi\n`,
      );
      const status = field(out, "status");
      const refused = notReady(status, out);
      if (refused !== undefined) return refused;
      const head = field(out, "head") ?? "";
      switch (status) {
        case "unrelated":
          return { _tag: "unrelated", head } satisfies MergeOutcome;
        case "current":
          return { _tag: "current", head } satisfies MergeOutcome;
        case "conflict":
          return { _tag: "conflict", head, paths: fieldsOf(out, "path") } satisfies MergeOutcome;
        default: {
          const tip = field(out, "tip") ?? "";
          yield* store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, recordedTip: tip }));
          return {
            _tag: "merged",
            head,
            tip,
            lockfileChanged: fieldsOf(out, "lockfile").length > 0,
          } satisfies MergeOutcome;
        }
      }
    });

  /** The first-parent commit of `revision` whose trailer names `assignment`, as `landed-commit`. */
  const findLanding = (assignment: string) =>
    `${git("integration", [
      "log",
      "--first-parent",
      "--format=%H %(trailers:key=Crew-Assignment,valueonly,separator=%x20)",
      "HEAD",
    ])} | awk -v a=${shellQuote(assignment)} '{ for (i = 2; i <= NF; i++) if ($i == a) { print "landed-commit\\t" $1; exit } }'\n`;

  const land: CrewIntegrationService["land"] = (input) =>
    Effect.flatMap(store.requireLane(input.crew, input.handle), (recorded) =>
      Semaphore.withPermits(landingLock(recorded.host), 1)(landUnderLock(input)),
    );

  /** The landing proper; the host's lock is held and the lane re-read under it. */
  const landUnderLock = (input: LandInput) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(input.crew, input.handle);
      if (row.frozenSince !== null) return { _tag: "frozen" } satisfies LandOutcome;
      const branch = `refs/heads/${laneBranch(row.lane)}`;
      const anchor = `refs/t3/crew/landing/${input.assignment}`;
      const subject = input.title.split("\n")[0]?.trim() || input.assignment;
      const out = yield* run(
        row.host,
        "land",
        EXCLUDE_LINE +
          `H=$(${git("integration", ["rev-parse", "--verify", "HEAD^{commit}"])}) || exit 1\n` +
          `landed=$(${findLanding(input.assignment).trimEnd()})\n` +
          `[ -z "$landed" ] || { printf '%s\\n' "$landed"; exit 0; }\n` +
          laneReady(row) +
          (input.checkedTip === undefined
            ? ""
            : `[ "$tip" = ${shellQuote(input.checkedTip)} ] || { printf 'status\\tunchecked\\ntip\\t%s\\n' "$tip"; exit 0; }\n`) +
          `ahead=$(${git("integration", ["rev-list", "--count", `HEAD..${branch}`])}) || exit 1\n` +
          `[ "$ahead" != 0 ] && [ "$(${git("integration", ["rev-parse", `${branch}^{tree}`])})" != "$(${git("integration", ["rev-parse", "HEAD^{tree}"])})" ] || { printf 'status\\tnothing\\n'; exit 0; }\n` +
          `${git("integration", ["merge-base", "--is-ancestor", H, branch])} || { printf 'status\\thead-moved\\nhead\\t%s\\n' "$H"; exit 0; }\n` +
          `errors=$(mktemp) || exit 1\n` +
          `trap 'rm -f "$errors"' EXIT\n` +
          `if S=$(${git("integration", ["commit-tree", `${branch}^{tree}`, "-p", H, "-m", subject, "-m", landingTrailers(row.lane, input.assignment)])} 2>"$errors") &&\n` +
          `  ${git("integration", ["update-ref", anchor, S])} 2>>"$errors" &&\n` +
          `  ${git("integration", ["merge", "--ff-only", "-q", S])} >/dev/null 2>>"$errors"; then\n` +
          `  ${git("integration", ["update-ref", "-d", anchor])}\n` +
          `  ${git({ lane: row.lane }, ["reset", "-q", "--keep", S])} || exit 1\n` +
          `  printf 'status\\tlanded\\ncommit\\t%s\\n' "$S"\n` +
          `else\n` +
          `  ${git("integration", ["update-ref", "-d", anchor])} 2>/dev/null\n` +
          `  printf 'status\\trefused\\n'\n` +
          `  sed 's/^/stderr\t/' "$errors"\n` +
          `fi\n`,
      );
      const landed = field(out, "landed-commit");
      if (landed !== undefined) {
        yield* run(
          row.host,
          "land",
          `${git("integration", ["update-ref", "-d", anchor])} 2>/dev/null; true\n`,
        );
        return { _tag: "already-landed", commit: landed } satisfies LandOutcome;
      }
      const status = field(out, "status");
      const refused = notReady(status, out);
      if (refused !== undefined) return refused;
      switch (status) {
        case "nothing":
          return { _tag: "nothing" } satisfies LandOutcome;
        case "head-moved":
          return { _tag: "head-moved", head: field(out, "head") ?? "" } satisfies LandOutcome;
        case "unchecked":
          return { _tag: "unchecked", tip: field(out, "tip") ?? "" } satisfies LandOutcome;
        case "refused":
          return {
            _tag: "refused",
            refusal: classifyLandingRefusal(fieldsOf(out, "stderr").join("\n")),
          } satisfies LandOutcome;
        default: {
          const commit = field(out, "commit") ?? "";
          yield* store.updateLane(row.crew, row.lane, (lane) => ({
            ...lane,
            recordedTip: commit,
            lastLanding: commit,
          }));
          return { _tag: "landed", commit } satisfies LandOutcome;
        }
      }
    });

  const readPoliced = (row: CrewLaneRow) =>
    run(
      row.host,
      "police",
      `integration=$(${git("integration", ["symbolic-ref", "-q", "HEAD"])}) || integration=\n` +
        `${git("integration", ["for-each-ref", "--format=%(refname) %(objectname)", ...POLICED_PREFIXES])} |\n` +
        `  while read -r ref sha; do\n` +
        `    [ "$ref" = "$integration" ] || [ "$ref" = ${shellQuote(`refs/heads/${laneBranch(row.lane)}`)} ] || printf 'ref\\t%s %s\\n' "$ref" "$sha"\n` +
        `  done\n`,
    ).pipe(
      Effect.map((out) =>
        Object.fromEntries(
          fieldsOf(out, "ref").map((value) => {
            const space = value.lastIndexOf(" ");
            return [value.slice(0, space), value.slice(space + 1)] as const;
          }),
        ),
      ),
    );

  const snapshotRefs: CrewIntegrationService["snapshotRefs"] = (key) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(key.crew, key.handle);
      const refs = yield* readPoliced(row);
      yield* store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, refSnapshot: refs }));
      return refs;
    });

  const police: CrewIntegrationService["police"] = (key, explained = []) =>
    Effect.gen(function* () {
      const row = yield* store.requireLane(key.crew, key.handle);
      const before = row.refSnapshot ?? {};
      const after = yield* readPoliced(row);
      const otherLanes = new Map<string, CrewLaneRow>(
        (yield* store.lanesOnHost(row.host))
          .filter((lane) => lane.lane !== row.lane)
          .map((lane) => [`refs/heads/${lane.branch}`, lane] as const),
      );
      const explainedByRecord = (ref: string, sha: string | null) => {
        const lane = otherLanes.get(ref);
        return (
          lane !== undefined &&
          sha !== null &&
          (sha === lane.recordedTip || sha === lane.lastLanding)
        );
      };
      const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .sort()
        .map((ref): RefChange => ({ ref, before: before[ref] ?? null, after: after[ref] ?? null }))
        .filter(
          (change) =>
            change.before !== change.after &&
            !explained.includes(change.ref) &&
            !explainedByRecord(change.ref, change.after),
        );
      if (changes.length > 0) {
        yield* store.updateLane(row.crew, row.lane, (lane) => ({ ...lane, state: "parked" }));
      }
      return changes;
    });

  const landingEvidence: CrewIntegrationService["landingEvidence"] = (host, assignment) =>
    run(host, "landingEvidence", findLanding(assignment)).pipe(
      Effect.map((out) => field(out, "landed-commit") ?? null),
    );
  return CrewIntegration.of({
    landingEvidence,
    mergeIn,
    land,
    snapshotRefs,
    police,
  });
});

export const layer = Layer.effect(CrewIntegration, make);
