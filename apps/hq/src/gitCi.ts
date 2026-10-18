/**
 * The origin's CI for a commit HQ pushed to a Git environment: read with the environment's sealed
 * token after the hand-over is confirmed and kept on that push's evidence (`HqPushCi`), so the
 * person and the Mate read it where they read the push.
 */
import { type HqPushCi, type HqPushCiFailure, RELEASE_CHECK } from "@t3tools/shared/hqDeploys";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { rateEvidence } from "./githubProbes.ts";
import type { PushEvidence } from "./gitPush.ts";
import {
  GitTransport,
  type HostReply,
  type RemoteIdentity,
  remoteIdentity,
} from "./gitTransport.ts";
import { Leader } from "./leader.ts";
import { operationBackoff } from "./operationWatch.ts";
import { Remotes } from "./repoRemotes.ts";

/** GitHub lists a pushed commit's queued workflow runs within seconds; nothing after five minutes is no CI. */
export const CI_NONE_AFTER = Duration.minutes(5);
/**
 * zeropsio/mate's slowest workflow took 23 minutes over its last 100 runs (2026-10-17); an hour
 * leaves room for queued runners, and a commit still running then says HQ stopped watching.
 */
export const CI_WINDOW = Duration.minutes(60);
/** Reads slow down while CI runs; a conditional read whose answer did not change costs no rate. */
const POLL_MS = [15_000, 30_000, 60_000] as const;
const PAGES = 10;

const CheckRuns = Schema.Struct({
  total_count: Schema.Number,
  check_runs: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      status: Schema.String,
      started_at: Schema.NullOr(Schema.String),
      conclusion: Schema.NullOr(Schema.String),
      html_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
      details_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
      app: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
    }),
  ),
});
const CombinedStatus = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      state: Schema.String,
      target_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});
const BranchRules = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    parameters: Schema.optionalKey(
      Schema.Struct({
        required_status_checks: Schema.optionalKey(
          Schema.Array(Schema.Struct({ context: Schema.String })),
        ),
      }),
    ),
  }),
);
const decodeRuns = Schema.decodeUnknownOption(Schema.fromJsonString(CheckRuns));
const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(CombinedStatus));
const decodeRules = Schema.decodeUnknownOption(Schema.fromJsonString(BranchRules));
const decodeMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ message: Schema.String })),
);

export type CheckRun = (typeof CheckRuns.Type)["check_runs"][number];
export type CommitStatus = (typeof CombinedStatus.Type)["statuses"][number];

/** The checks every required-check rule of the branch names; null where none does. */
export const requiredChecks = (rules: typeof BranchRules.Type): ReadonlyArray<string> | null => {
  const names = [
    ...new Set(
      rules.flatMap((rule) =>
        rule.type === "required_status_checks"
          ? (rule.parameters?.required_status_checks ?? []).map((check) => check.context)
          : [],
      ),
    ),
  ];
  return names.length === 0 ? null : names;
};

const PASSING = new Set(["success", "neutral", "skipped"]);
interface Check {
  readonly name: string;
  readonly done: boolean;
  readonly passed: boolean;
  readonly url: string | null;
}

const newer = (a: CheckRun, b: CheckRun) =>
  a.started_at === b.started_at ? a.id > b.id : (a.started_at ?? "") > (b.started_at ?? "");

/**
 * Check runs belong to the commit, not a ref: a fast-forward of another branch to an already
 * checked commit, or a re-run, reports the same check again, and the newest run decides it.
 */
const newestRuns = (runs: ReadonlyArray<CheckRun>): ReadonlyArray<CheckRun> => {
  const byName = new Map<string, CheckRun>();
  for (const run of runs) {
    const seen = byName.get(run.name);
    if (seen === undefined || newer(run, seen)) byName.set(run.name, run);
  }
  return [...byName.values()];
};

/**
 * One read's verdict. Where the branch rules require checks only those count, and one not reported
 * yet is still running; otherwise every check run and commit status counts.
 */
export const ciVerdict = (
  runs: ReadonlyArray<CheckRun>,
  statuses: ReadonlyArray<CommitStatus>,
  required: ReadonlyArray<string> | null,
): Pick<HqPushCi, "verdict" | "done" | "total" | "failed"> => {
  const checks: ReadonlyArray<Check> = [
    ...newestRuns(runs).map((run) => ({
      name: run.name,
      done: run.status === "completed",
      passed: run.conclusion !== null && PASSING.has(run.conclusion),
      url: run.html_url ?? run.details_url ?? null,
    })),
    ...statuses.map((status) => ({
      name: status.context,
      done: status.state !== "pending",
      passed: status.state === "success",
      url: status.target_url ?? null,
    })),
  ];
  const counted =
    required === null
      ? checks
      : required.map((name): Check => {
          const named = checks.filter((check) => check.name === name);
          return (
            named.find((check) => check.done && !check.passed) ?? {
              name,
              done: named.length > 0 && named.every((check) => check.done),
              passed: true,
              url: named[0]?.url ?? null,
            }
          );
        });
  const failed: ReadonlyArray<HqPushCiFailure> = counted
    .filter((check) => check.done && !check.passed)
    .map(({ name, url }) => ({ name, url }));
  const done = counted.filter((check) => check.done).length;
  const total = counted.length;
  return {
    verdict:
      total === 0 ? "none" : failed.length > 0 ? "failed" : done < total ? "running" : "passed",
    done,
    total,
    failed,
  };
};

type Read =
  | { readonly _tag: "body"; readonly body: string }
  | { readonly _tag: "wait"; readonly ms: number; readonly resetAt?: string }
  | { readonly _tag: "refused"; readonly reason: string }
  | { readonly _tag: "transient" };

const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const sameRecord = (a: HqPushCi, b: Omit<HqPushCi, "sha" | "readAt" | "until">) =>
  a.verdict === b.verdict &&
  a.done === b.done &&
  a.total === b.total &&
  a.reason === b.reason &&
  a.watch === b.watch &&
  encode(a.failed) === encode(b.failed) &&
  encode(a.required) === encode(b.required);

const stoppedAfterWindow = `Mate stopped watching CI ${Duration.toMinutes(CI_WINDOW)} minutes after the push.`;

/** GitHub Actions' app id on github.com: a check run another app reports under the same name is not it. */
export const GITHUB_ACTIONS_APP = 15368;

/**
 * The pushed commit HQ reads CI for: where it went, when the hand-over was confirmed, what was read.
 * `only` counts just the named check run of one app, never commit statuses or branch rules.
 */
export interface CiTarget {
  readonly appId: string;
  readonly repo: string;
  readonly branch: string;
  readonly remote: RemoteIdentity;
  readonly sha: string;
  readonly pushedAt: number;
  readonly previous: HqPushCi | undefined;
  readonly only?: { readonly name: string; readonly appId: number };
}
/** Where each changed record lands, and whether a newer push to the branch replaced this one. */
export interface CiStore<E> {
  readonly save: (ci: HqPushCi) => Effect.Effect<void, E>;
  readonly replaced: Effect.Effect<boolean, E>;
}

/**
 * Reads the commit's CI until every counted check completed, the window passed, a newer push
 * replaced it or GitHub refused the read, saving each change of the record.
 */
export const followCi = <E>(target: CiTarget, store: CiStore<E>) =>
  Effect.gen(function* () {
    const remotes = yield* Remotes;
    const transport = yield* GitTransport;
    const { remote, sha, pushedAt, branch, only } = target;
    const until = pushedAt + Duration.toMillis(CI_WINDOW);
    let last = target.previous;
    let required: ReadonlyArray<string> | null =
      only === undefined ? (last?.required ?? null) : [only.name];
    let counted: Pick<HqPushCi, "verdict" | "done" | "total" | "failed"> = last ?? {
      verdict: "none",
      done: 0,
      total: 0,
      failed: [],
    };
    const keep = (watch: HqPushCi["watch"], reason: string | null = null) =>
      Effect.gen(function* () {
        const next = { ...counted, required, reason, watch };
        if (last !== undefined && sameRecord(last, next)) return;
        const ci: HqPushCi = {
          sha,
          ...next,
          readAt: iso(yield* Clock.currentTimeMillis),
          until: iso(until),
        };
        yield* store.save(ci);
        last = ci;
      });
    const refuse = (reason: string) => {
      counted = { verdict: "unreadable", done: 0, total: 0, failed: [] };
      return keep("stopped", reason);
    };
    /** Waits `ms`, or says HQ stopped watching where the wait outlasts the window. */
    const pause = (ms: number, why = stoppedAfterWindow) =>
      Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) + ms < until) {
          yield* Effect.sleep(ms);
          return true;
        }
        yield* keep("stopped", why);
        return false;
      });
    let transient = 0;
    /** An unanswered or unrecognized read is retried with backoff inside the window. */
    const recover = Effect.suspend(() => {
      const attempt = transient++;
      return Effect.flatMap(Clock.currentTimeMillis, (now) =>
        now >= until
          ? Effect.as(keep("stopped", stoppedAfterWindow), false)
          : Effect.as(operationBackoff(attempt), true),
      );
    });
    const waitFor = (read: Extract<Read, { _tag: "wait" }>) =>
      pause(
        Math.max(1_000, read.ms),
        read.resetAt === undefined
          ? stoppedAfterWindow
          : `GitHub asked Mate to wait until ${read.resetAt}, after watching ends; Mate stopped watching CI.`,
      );

    // The token is opened once per watch: every read proves it with GitHub anyway.
    let token: Redacted.Redacted | undefined;
    while (token === undefined) {
      const use = yield* remotes.forUse({ appId: target.appId, repo: target.repo }, branch).pipe(
        Effect.map((value) => ({ ok: true as const, token: value.token })),
        Effect.catchTags({
          RemoteRefused: (error) =>
            Effect.succeed({
              ok: false as const,
              reason: error.message,
              wait: false,
              retryAfterMs: undefined,
            }),
          ProbeRefused: (error) =>
            Effect.succeed({
              ok: false as const,
              reason: error.message,
              wait: error.reason === "rate_limited" || error.reason === "unreachable",
              retryAfterMs: error.retryAfterMs,
            }),
        }),
      );
      if (use.ok) token = use.token;
      else if (!use.wait) return yield* refuse(use.reason);
      else if (!(yield* pause(Math.max(1_000, use.retryAfterMs ?? POLL_MS[0])))) return;
    }
    const opened = token;

    const cache = new Map<string, { readonly etag: string; readonly body: string }>();
    const get = (path: string, refusal: (reply: HostReply) => string) =>
      Effect.gen(function* (): Effect.fn.Return<Read> {
        const cached = cache.get(path);
        const reply = yield* transport.read(remote, path, opened, cached?.etag).pipe(Effect.option);
        if (Option.isNone(reply)) return { _tag: "transient" };
        const answer = reply.value;
        if (answer.status === 304 && cached !== undefined)
          return { _tag: "body", body: cached.body };
        const rate = rateEvidence(answer, yield* Clock.currentTimeMillis);
        if (rate !== undefined)
          return {
            _tag: "wait",
            ms: rate.retryAfterMs,
            ...(rate.resetAt === undefined ? {} : { resetAt: rate.resetAt }),
          };
        if (answer.status === 200) {
          const etag = answer.headers["etag"];
          if (etag !== undefined) cache.set(path, { etag, body: answer.body });
          return { _tag: "body", body: answer.body };
        }
        if (answer.status === 401)
          return {
            _tag: "refused",
            reason:
              "GitHub rejected this token (expired, revoked or mistyped). Replace the token to show CI.",
          };
        if (answer.status === 403 || answer.status === 404)
          return { _tag: "refused", reason: refusal(answer) };
        return { _tag: "transient" };
      });

    // The branch rules decide which checks count; they are read once per watch.
    while (only === undefined) {
      const rules = yield* get(`/rules/branches/${encodeURIComponent(branch)}`, (reply) =>
        Option.getOrUndefined(decodeMessage(reply.body))?.message ===
        "Upgrade to GitHub Pro or make this repository public to enable this feature."
          ? ""
          : `Mate couldn't read the rules of ${branch} (HTTP ${reply.status}), so it can't tell which checks count.`,
      );
      const decoded =
        rules._tag === "body" ? Option.getOrUndefined(decodeRules(rules.body)) : undefined;
      if (decoded !== undefined) {
        required = requiredChecks(decoded);
        break;
      }
      // GitHub has no branch rules on this plan: every check counts.
      if (rules._tag === "refused" && rules.reason === "") break;
      if (rules._tag === "refused") return yield* refuse(rules.reason);
      if (!(yield* rules._tag === "wait" ? waitFor(rules) : recover)) return;
    }

    let poll = 0;
    for (;;) {
      if (yield* store.replaced)
        return yield* keep(
          "stopped",
          `A newer push to ${branch} replaced this commit; Mate watches that one's CI.`,
        );
      const runs: Array<CheckRun> = [];
      let failedRead: Read | undefined;
      for (let page = 1; page <= PAGES; page++) {
        const got = yield* get(
          `/commits/${sha}/check-runs?per_page=100&page=${page}`,
          () => "The token can't read check runs. Add Checks: Read to the token to show CI.",
        );
        const decoded =
          got._tag === "body" ? Option.getOrUndefined(decodeRuns(got.body)) : undefined;
        if (decoded === undefined) {
          failedRead = got._tag === "body" ? { _tag: "transient" } : got;
          break;
        }
        runs.push(...decoded.check_runs);
        if (runs.length >= decoded.total_count || decoded.check_runs.length === 0) break;
      }
      // GitHub Actions writes no commit statuses: one named check run never reads them.
      const read: Read =
        failedRead ??
        (only !== undefined
          ? { _tag: "body", body: '{"statuses":[]}' }
          : yield* get(
              `/commits/${sha}/status?per_page=100`,
              () =>
                "The token can't read commit statuses. Add Commit statuses: Read to the token to show CI.",
            ));
      const statuses =
        read._tag === "body" ? Option.getOrUndefined(decodeStatus(read.body))?.statuses : undefined;
      if (read._tag === "refused") return yield* refuse(read.reason);
      if (statuses === undefined) {
        if (!(yield* read._tag === "wait" ? waitFor(read) : recover)) return;
        continue;
      }
      transient = 0;
      counted =
        only === undefined
          ? ciVerdict(runs, statuses, required)
          : ciVerdict(
              runs.filter((run) => run.name === only.name && run.app?.id === only.appId),
              [],
              null,
            );
      const now = yield* Clock.currentTimeMillis;
      const finished =
        counted.verdict === "none"
          ? now >= pushedAt + Duration.toMillis(CI_NONE_AFTER)
          : counted.done === counted.total;
      if (finished) return yield* keep("finished");
      if (now >= until) return yield* keep("stopped", stoppedAfterWindow);
      yield* keep("watching");
      if (!(yield* pause(POLL_MS[Math.min(poll++, POLL_MS.length - 1)]!))) return;
    }
  });

/**
 * Stage's `RELEASE_CHECK` on the commit a release pushes to its origin's main: read from when
 * stage took it (`pushedAt`) until it completed, none reported five minutes after, or the window
 * passed; `save` is told each change. The record it ends on, as `releaseGateWords` reads it.
 */
export const stageCheck = <E>(
  target: Omit<CiTarget, "only">,
  save: (gate: HqPushCi) => Effect.Effect<void, E>,
) =>
  Effect.gen(function* () {
    let gate = target.previous;
    yield* followCi(
      { ...target, only: { name: RELEASE_CHECK, appId: GITHUB_ACTIONS_APP } },
      {
        save: (ci) =>
          Effect.flatMap(
            Effect.sync(() => void (gate = ci)),
            () => save(ci),
          ),
        replaced: Effect.succeed(false),
      },
    );
    return gate;
  });

/** What a release says of stage's check before it pushes: wait, push, or refuse in these words. */
export const releaseGateWords = (
  gate: HqPushCi | undefined,
): { readonly verdict: "wait" | "push" | "refuse"; readonly words: string } => {
  if (gate === undefined)
    return {
      verdict: "refuse",
      words: "Mate couldn't read stage CI, so this release can't go out. Release again.",
    };
  const at = gate.sha.slice(0, 7);
  if (gate.verdict === "passed" && gate.watch === "finished") return { verdict: "push", words: "" };
  if (gate.verdict === "failed")
    return {
      verdict: "refuse",
      words: `Stage CI "${RELEASE_CHECK}" failed on ${at}, so this release can't go out. Fix it on main, then release again.`,
    };
  if (gate.verdict === "unreadable")
    return {
      verdict: "refuse",
      words:
        `Mate couldn't read stage CI for ${at}, so this release can't go out. ${gate.reason ?? ""}`.trim(),
    };
  if (gate.watch === "watching")
    return {
      verdict: "wait",
      words:
        gate.verdict === "none"
          ? `Waiting for stage CI "${RELEASE_CHECK}" to start on ${at}; the release pushes once it passes.`
          : `Waiting for stage CI "${RELEASE_CHECK}" to pass on ${at}; the release pushes once it does.`,
    };
  if (gate.verdict === "none" && gate.watch === "finished")
    return {
      verdict: "refuse",
      words: `Stage CI "${RELEASE_CHECK}" never ran on ${at}, so this release can't go out. Add a CI job named "${RELEASE_CHECK}" that runs on pushes to stage, then release again.`,
    };
  return {
    verdict: "refuse",
    words:
      `Stage CI "${RELEASE_CHECK}" hadn't passed on ${at} when Mate stopped waiting, so this release can't go out. ${gate.reason ?? ""}`.trim(),
  };
};

export class GitCi extends Context.Service<
  GitCi,
  {
    /** The newest push of each environment's repository whose CI HQ has not finished reading. */
    readonly resumable: Effect.Effect<ReadonlyArray<string>, SqlError>;
    /** Follows the pushed job's CI (`followCi`) onto its evidence, telling `changed` each change. */
    readonly watch: (jobId: string, changed: Effect.Effect<void>) => Effect.Effect<void>;
  }
>()("@t3tools/hq/gitCi") {}

export const gitCiLayer = Layer.effect(
  GitCi,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const context = yield* Effect.context<Remotes | GitTransport>();

    const watch = (jobId: string, changed: Effect.Effect<void>) =>
      Effect.gen(function* () {
        const [job] = yield* sql<{
          readonly state: string;
          readonly evidence: PushEvidence | null;
          readonly environment_id: string;
          readonly repo: string;
          readonly app_id: string;
          readonly branch: string;
        }>`
          SELECT j.state, j.evidence, j.environment_id, j.repo, e.app_id::text AS app_id, e.branch
          FROM hq_deploy_job j JOIN hq_environment e ON e.id = j.environment_id AND e.target = 'git'
          WHERE j.id = ${jobId}::bigint AND j.kind = 'push'`;
        const evidence = job?.evidence;
        if (
          job === undefined ||
          job.state !== "pushed" ||
          !evidence ||
          evidence.after === undefined ||
          evidence.at === undefined ||
          (evidence.ci !== undefined && evidence.ci.watch !== "watching")
        )
          return;
        const save = (ci: HqPushCi) =>
          leader
            .write(
              sql`
                UPDATE hq_deploy_job
                SET evidence = jsonb_set(evidence, '{ci}', ${encode(ci)}::jsonb), updated_at = now()
                WHERE id = ${jobId}::bigint AND state = 'pushed'`,
            )
            .pipe(Effect.andThen(changed));
        // The fast-forward to main runs CI there again; the stage run the release waited for decides.
        if (evidence.gate?.verdict === "passed" && evidence.gate.sha === evidence.after)
          return yield* save({ ...evidence.gate, watch: "finished" });
        const remote = remoteIdentity(evidence.remote);
        // Only GitHub's checks are read; elsewhere the push carries no CI record.
        if (remote?.kind !== "github") return;
        yield* followCi(
          {
            appId: job.app_id,
            repo: job.repo,
            branch: job.branch,
            remote,
            sha: evidence.after,
            pushedAt: DateTime.toEpochMillis(DateTime.makeUnsafe(evidence.at)),
            previous: evidence.ci,
          },
          {
            save,
            replaced: Effect.map(
              sql`
                SELECT id FROM hq_deploy_job
                WHERE environment_id = ${job.environment_id} AND repo = ${job.repo}
                  AND kind = 'push' AND state = 'pushed' AND id > ${jobId}::bigint
                LIMIT 1`,
              (rows) => rows.length > 0,
            ),
          },
        ).pipe(Effect.provide(context));
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("HQ stopped reading a push's CI", { job: jobId, error }),
        ),
      );

    return GitCi.of({
      resumable: Effect.map(
        sql<{ readonly id: string; readonly watch: string | null }>`
          SELECT DISTINCT ON (environment_id, repo) id::text AS id, evidence->'ci'->>'watch' AS watch
          FROM hq_deploy_job WHERE kind = 'push' AND state = 'pushed'
          ORDER BY environment_id, repo, id DESC`,
        (rows) =>
          rows.filter((row) => row.watch === null || row.watch === "watching").map((row) => row.id),
      ),
      watch,
    });
  }),
);
