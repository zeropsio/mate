// @effect-diagnostics nodeBuiltinImport:off -- the sole external Git writer and its durable process receipts.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as PlatformNodePath from "@effect/platform-node/NodePath";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { CI_WINDOW, releaseGateWords, stageCheck } from "./gitCi.ts";
import { withGitCredential } from "./gitAskpass.ts";
import { type GitChildRequest, startGitChild } from "./gitPushChild.ts";
import { GitHost } from "./gitHost.ts";
import { GitTransport, remoteIdentity } from "./gitTransport.ts";
import { Leader, NotLeader } from "./leader.ts";
import { Remotes } from "./repoRemotes.ts";
import { operationBackoff } from "./operationWatch.ts";
import type { HqPushCi, HqPushEvidence } from "@t3tools/shared/hqDeploys";

export interface PushInput {
  readonly directory: string;
  readonly url: string;
  readonly identity: string;
  readonly ref: string;
  readonly sha: string;
  readonly keptAt: string;
  readonly token: Redacted.Redacted;
  readonly confirmed: string | null;
  readonly repositoryId?: string | null;
  readonly deadlineMs?: number;
  /** Until when GitHub holding the push for a required check still running is waited out. */
  readonly holdUntil?: number;
}

const ChildAnswer = Schema.Struct({
  code: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  timedOut: Schema.Boolean,
  drained: Schema.Boolean,
  pid: Schema.NullOr(Schema.Number),
  supervisorPid: Schema.Number,
});
export interface PushEvidence {
  readonly phase: "preflight" | "prepared" | "writing" | "recovering" | "closed";
  readonly processes: readonly [];
  readonly version: null;
  readonly nextActor: "hq" | "person" | "none";
  readonly nextAction: string;
  readonly remote: string;
  readonly identity: string;
  readonly ref: string;
  readonly sha: string;
  readonly keptAt: string;
  readonly before: string | null;
  readonly observed?: string | null;
  readonly witness?: string;
  readonly supervisorPid?: number;
  readonly writerDrained: boolean;
  readonly via?: "answer" | "found" | "resolve";
  readonly after?: string;
  readonly resetAt?: string;
  readonly at?: string;
  readonly repositoryId?: string | null;
  /** Written by `gitCi.ts` once the job is pushed. */
  readonly ci?: HqPushCi;
  /** Stage's CI of `sha` as main's rules count it, read before a release pushes there (`stageCheck`). */
  readonly gate?: HqPushCi;
}
/** One surface derivation; child handles and filesystem paths never leave HQ. */
export const pushEvidenceForWire = (evidence: PushEvidence): HqPushEvidence => {
  const remote = { url: evidence.remote, repositoryId: evidence.repositoryId ?? null };
  return {
    attempt: {
      remote,
      ref: evidence.ref,
      sha: evidence.sha,
      credentialKeptAt: evidence.keptAt.replace(" ", "T").replace(/\+00$/u, "Z"),
      before: evidence.before,
      phase: evidence.phase === "recovering" ? "recovering" : "submitting",
    },
    ...(evidence.after === undefined || evidence.via === undefined || evidence.at === undefined
      ? {}
      : {
          confirmed: {
            remote,
            ref: evidence.ref,
            before: evidence.before,
            after: evidence.after,
            via: evidence.via,
            at: evidence.at,
          },
        }),
    ...(evidence.observed === undefined ? {} : { observed: evidence.observed }),
    ...(evidence.ci === undefined ? {} : { ci: evidence.ci }),
    ...(evidence.gate === undefined ? {} : { gate: evidence.gate }),
    nextActor: evidence.nextActor,
    nextAction: evidence.nextAction,
  };
};
export interface PushResult {
  readonly state: "pushed" | "refused" | "unresolved";
  readonly reason?: string;
  readonly evidence: PushEvidence;
  readonly credentialRefused?: boolean;
}
/**
 * GitHub's refusal of a push for the branch's required status checks (GH013), check by check:
 * `expected` never ran on the commit, `failing` failed, `in progress` still runs.
 */
export const requiredCheckRefusal = (output: string) => {
  const checks = [
    ...output.matchAll(/Required status check "([^"]+)" is (expected|failing|in progress)/gu),
  ].map(([, name, state]) => ({
    name: name!,
    state:
      state === "expected"
        ? ("never-ran" as const)
        : state === "failing"
          ? ("failed" as const)
          : ("waiting" as const),
  }));
  return checks.length === 0 ? undefined : checks;
};
/** GitHub re-checks the required checks on every push: one try every half minute while they run. */
const HOLD_RETRY_MS = 30_000;

export class PushUnavailable extends Schema.TaggedError<PushUnavailable>()("PushUnavailable", {}) {}
const receipt = (witness: string) =>
  Effect.tryPromise({
    try: () => NodeFSP.readFile(witness, "utf8"),
    catch: () => new PushUnavailable(),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ChildAnswer))),
    Effect.option,
  );
const runChild = <E = never, R = never>(
  input: PushInput,
  request: Omit<GitChildRequest, "credential" | "deadlineMs">,
  spawned: (pid: number) => Effect.Effect<void, E, R> = () => Effect.void,
) =>
  withGitCredential(input.token, (credential) =>
    Effect.scoped(
      Effect.gen(function* () {
        const owned = yield* Effect.acquireRelease(
          Effect.sync(() =>
            startGitChild({ ...request, credential, deadlineMs: input.deadlineMs ?? 60_000 }),
          ),
          (owned) =>
            Effect.promise(async () => {
              if (owned.child.exitCode === null && owned.child.signalCode === null)
                owned.child.kill("SIGTERM");
              await owned.done;
            }),
        );
        if (owned.child.pid !== undefined) yield* spawned(owned.child.pid);
        yield* Effect.promise(() => owned.done);
        return yield* receipt(request.witness);
      }),
    ),
  ).pipe(
    Effect.provide(Layer.mergeAll(NodeFileSystem.layer, PlatformNodePath.layer)),
    Effect.catchIf(PlatformError.isPlatformError, () => Effect.succeed(undefined)),
    Effect.map((answer) =>
      answer === undefined ? undefined : answer._tag === "Some" ? answer.value : undefined,
    ),
  );

/** Used by the worker and actual-process witnesses; every attempted write has one fixed before. */
export const deliverRef = <E = never, R = never>(
  input: PushInput,
  record: (evidence: PushEvidence) => Effect.Effect<void, E, R> = () => Effect.void,
  previous?: PushEvidence,
): Effect.Effect<PushResult, E, R> =>
  Effect.gen(function* () {
    let evidence: PushEvidence = previous ?? {
      phase: "preflight",
      processes: [],
      version: null,
      nextActor: "hq",
      nextAction: "Read the remote ref",
      remote: input.url,
      identity: input.identity,
      ref: input.ref,
      sha: input.sha,
      keptAt: input.keptAt,
      before: null,
      writerDrained: true,
      repositoryId: input.repositoryId ?? null,
    };
    const save = (patch: Partial<PushEvidence>) =>
      Effect.gen(function* () {
        evidence = { ...evidence, ...patch };
        yield* record(evidence);
      });
    let credentialRefused = false;
    const end = (state: PushResult["state"], reason?: string): Effect.Effect<PushResult, E, R> =>
      Effect.gen(function* () {
        yield* save({
          phase: "closed",
          at: DateTime.formatIso(yield* DateTime.now),
          nextActor: state === "pushed" ? "none" : "person",
          nextAction:
            state === "pushed" ? "Operation ended" : "Inspect the branch on the repository host",
        });
        return {
          state,
          ...(reason === undefined ? {} : { reason }),
          ...(credentialRefused ? { credentialRefused: true } : {}),
          evidence,
        };
      });
    yield* record(evidence);
    const holdUntil =
      input.holdUntil ?? (yield* Clock.currentTimeMillis) + Duration.toMillis(CI_WINDOW);
    if (
      previous !== undefined &&
      (previous.remote !== input.url ||
        previous.identity !== input.identity ||
        previous.ref !== input.ref ||
        previous.sha !== input.sha)
    )
      return yield* end(
        "unresolved",
        "The attempted destination changed; inspect the original branch",
      );
    if (!evidence.writerDrained) {
      const answer = evidence.witness === undefined ? undefined : yield* receipt(evidence.witness);
      if (answer === undefined || answer._tag === "None" || !answer.value.drained)
        return yield* end("unresolved", "The original Git writer cannot be proven stopped");
      yield* save({ writerDrained: true });
    }
    let attempt = 0;
    for (;;) {
      const readWitness = NodePath.join(input.directory, `read-${NodeCrypto.randomUUID()}.json`);
      const read = yield* runChild(input, {
        mode: "read",
        directory: input.directory,
        url: input.url,
        ref: input.ref,
        sha: input.sha,
        before: evidence.before,
        witness: readWitness,
      });
      if (read === undefined || !read.drained || read.code !== 0) {
        const auth = read?.stderr
          .split("\n")
          .find((line) => line.startsWith("fatal: Authentication failed"));
        if (auth !== undefined) {
          credentialRefused = true;
          return yield* end(
            evidence.witness === undefined ? "refused" : "unresolved",
            auth.slice(0, 240),
          );
        }
        if (
          read?.drained &&
          (read.timedOut ||
            /Could not resolve host|Failed to connect|Connection reset|timed out|(?:HTTP[^\n]*|requested URL returned error: )(?:429|5\d\d)/u.test(
              read.stderr,
            ))
        ) {
          yield* save({
            phase: "recovering",
            nextActor: "hq",
            nextAction: "The repository host could not be reached; read the original ref again",
          });
          yield* operationBackoff(attempt++);
          continue;
        }
        return yield* end(
          evidence.witness !== undefined ? "unresolved" : "refused",
          read?.stderr.trim().slice(0, 240) ||
            "The repository ref could not be read; the push outcome is unconfirmed",
        );
      }
      const line = read.stdout.split("\n").find((line) => line.split("\t")[1] === input.ref);
      const current = line?.split("\t")[0] ?? null;
      if (current !== null && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(current))
        return yield* end("unresolved", "The repository returned an unrecognized ref answer");
      yield* save({ observed: current });
      if (current === input.sha) {
        yield* save({
          before: evidence.witness === undefined ? current : evidence.before,
          after: input.sha,
          via: evidence.witness === undefined ? "found" : "resolve",
        });
        return yield* end("pushed");
      }
      const recovering = evidence.witness !== undefined;
      if (recovering && current !== evidence.before)
        return yield* end(
          "unresolved",
          "The remote ref differs from both the original tip and intended commit",
        );
      if (!recovering && input.confirmed !== null && current !== input.confirmed)
        return yield* end(
          "refused",
          `The remote ref moved from ${input.confirmed.slice(0, 7)} to ${current?.slice(0, 7) ?? "missing"}`,
        );
      if (!recovering) yield* save({ before: current });
      const witness = NodePath.join(input.directory, `push-${NodeCrypto.randomUUID()}.json`);
      yield* save({
        phase: "prepared",
        keptAt: input.keptAt,
        witness,
        writerDrained: false,
        nextActor: "hq",
        nextAction: "Push the fixed commit with its original tip guard",
      });
      const answer = yield* runChild(
        input,
        {
          mode: "push",
          directory: input.directory,
          url: input.url,
          ref: input.ref,
          sha: input.sha,
          before: evidence.before,
          witness,
        },
        (supervisorPid) => save({ phase: "writing", supervisorPid }),
      );
      if (answer === undefined || !answer.drained)
        return yield* end("unresolved", "The original Git writer cannot be proven stopped");
      yield* save({ writerDrained: true });
      if (answer.code === 0 && !answer.timedOut) {
        yield* save({ after: input.sha, via: "answer" });
        return yield* end("pushed");
      }
      const held = answer.timedOut
        ? undefined
        : requiredCheckRefusal(answer.stderr + "\n" + answer.stdout);
      if (held !== undefined) {
        const at = input.sha.slice(0, 7);
        const named = (state: (typeof held)[number]["state"]) =>
          held
            .filter((check) => check.state === state)
            .map((check) => `"${check.name}"`)
            .join(", ");
        if (named("failed") !== "")
          return yield* end(
            "refused",
            `GitHub refused ${at}: its required check ${named("failed")} failed. Fix it on main, then release again.`,
          );
        if (named("never-ran") !== "")
          return yield* end(
            "refused",
            `GitHub refused ${at}: its required check ${named("never-ran")} never ran on it. Release a commit stage tested.`,
          );
        if ((yield* Clock.currentTimeMillis) + HOLD_RETRY_MS >= holdUntil)
          return yield* end(
            "refused",
            `GitHub still held ${at} when Mate stopped waiting: its required check ${named("waiting")} hadn't passed. Release again once it does.`,
          );
        yield* save({
          phase: "recovering",
          nextActor: "hq",
          nextAction: `GitHub holds ${at} until its required check ${named("waiting")} passes; Mate pushes again then.`,
        });
        yield* Effect.sleep(HOLD_RETRY_MS);
        continue;
      }
      // A positive receive-pack rejection is authoritative. Transport loss is not.
      const lines = (answer.stderr + "\n" + answer.stdout).split("\n");
      const rejection = lines.find((line) =>
        /\[(?:remote )?rejected\]|not an ancestor|Invalid fixed/u.test(line),
      );
      const auth = lines.find((line) => line.startsWith("fatal: Authentication failed"));
      const words =
        auth ??
        (rejection === undefined
          ? undefined
          : (lines.find((line) => line.startsWith("remote:")) ?? rejection));
      if (!answer.timedOut && words !== undefined) {
        credentialRefused = auth !== undefined;
        return yield* end("refused", words.slice(0, 240));
      }
      yield* save({
        phase: "recovering",
        nextAction: "Read the original ref before retrying the same commit",
      });
      yield* operationBackoff(attempt++);
    }
  });

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export interface PushJob {
  readonly id: string;
  readonly environment_id: string;
  readonly app_id: string;
  readonly repo: string;
  readonly sha: string;
}
export class GitPush extends Context.Service<
  GitPush,
  {
    /** `next` ends at the next change of any job, for a release waiting on stage's push. */
    readonly run: (
      job: PushJob,
      changed?: Effect.Effect<void>,
      next?: Effect.Effect<void>,
    ) => Effect.Effect<
      void,
      import("effect/sql/SqlError").SqlError | import("./leader.ts").NotLeader
    >;
  }
>()("@t3tools/hq/gitPush") {}

export const gitPushLayer = Layer.effect(
  GitPush,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const host = yield* GitHost;
    const remotes = yield* Remotes;
    const reads = yield* Effect.context<Remotes | GitTransport>();

    return GitPush.of({
      run: (job, changed = Effect.void, next = Effect.never) =>
        Effect.gen(function* () {
          const [environment] = yield* sql<{
            readonly branch: string;
            readonly tier: "stage" | "production";
            readonly staged: boolean;
          }>`SELECT branch, tier, EXISTS (SELECT 1 FROM hq_environment s
              WHERE s.app_id=e.app_id AND s.target='git' AND s.tier='stage') AS staged
            FROM hq_environment e WHERE id=${job.environment_id} AND target='git'`;
          if (environment === undefined) return;
          const [saved] = yield* sql<{
            readonly evidence: PushEvidence | null;
          }>`SELECT evidence FROM hq_deploy_job WHERE id=${job.id}::bigint`;
          if (saved?.evidence?.writerDrained === false) {
            const prior =
              saved.evidence.witness === undefined
                ? undefined
                : yield* receipt(saved.evidence.witness);
            if (prior === undefined || prior._tag === "None" || !prior.value.drained) {
              const evidence: PushEvidence = {
                ...saved.evidence,
                phase: "closed",
                nextActor: "person",
                nextAction: "Prove the original writer stopped before removing or delivering again",
              };
              yield* leader.write(sql`UPDATE hq_deploy_job SET state='unresolved',reason='The original Git writer cannot be proven stopped',
          evidence=${encode(evidence)}::jsonb,ended_at=now(),updated_at=now() WHERE id=${job.id}::bigint AND ended_at IS NULL`);
              return;
            }
          }
          const record = (evidence: PushEvidence) =>
            leader
              .write(
                Effect.gen(function* () {
                  // Lifecycle uses this executor lock; the durable row is checked again before a spawn.
                  const exists =
                    yield* sql`SELECT id FROM hq_environment WHERE id=${job.environment_id} FOR UPDATE`;
                  if (exists.length === 0) return yield* new NotLeader({ reason: "fenced" });
                  const updated =
                    yield* sql`UPDATE hq_deploy_job SET state='submitting', submitted_at=coalesce(submitted_at,now()),
        evidence=${encode(evidence)}::jsonb, updated_at=now(), steps=CASE WHEN steps->-1 IS DISTINCT FROM ${encode(evidence)}::jsonb
          THEN steps || jsonb_build_array(${encode(evidence)}::jsonb) ELSE steps END
        WHERE id=${job.id}::bigint AND ended_at IS NULL RETURNING id`;
                  if (updated.length === 0) return yield* new NotLeader({ reason: "fenced" });
                }),
              )
              .pipe(Effect.andThen(changed));
          const remote = yield* remotes.get({ appId: job.app_id, repo: job.repo });
          let pending =
            saved?.evidence ??
            (remote?.keptAt === null || remote?.keptAt === undefined
              ? undefined
              : {
                  phase: "preflight" as const,
                  processes: [] as const,
                  version: null,
                  nextActor: "hq" as const,
                  nextAction: "Verify the saved remote before delivery",
                  remote: remote.url,
                  identity: remote.hostRepoId ?? remote.urlKey,
                  repositoryId: remote.hostRepoId,
                  ref: `refs/heads/${environment.branch}`,
                  sha: job.sha,
                  keptAt: remote.keptAt,
                  before: null,
                  writerDrained: true,
                });
          if (pending !== undefined) yield* record(pending);
          let retries = 0;
          const use = yield* Effect.gen(function* () {
            for (;;) {
              const answer = yield* remotes
                .forUse({ appId: job.app_id, repo: job.repo }, environment.branch, "git")
                .pipe(
                  Effect.map((value) => ({ ok: true as const, value })),
                  Effect.catchTags({
                    RemoteRefused: (error) =>
                      Effect.succeed({
                        ok: false as const,
                        reason: error.message,
                        wait: false as const,
                      }),
                    ProbeRefused: (error) =>
                      Effect.succeed({
                        ok: false as const,
                        reason: error.message,
                        wait: error.reason === "rate_limited" || error.reason === "unreachable",
                        retryAfterMs: error.retryAfterMs,
                        resetAt: error.resetAt,
                      }),
                  }),
                );
              if (answer.ok || !answer.wait) return answer;
              if (pending !== undefined) {
                pending = {
                  ...pending,
                  phase: "recovering",
                  nextActor: "hq",
                  nextAction: answer.reason,
                  ...("resetAt" in answer && answer.resetAt !== undefined
                    ? { resetAt: answer.resetAt }
                    : {}),
                };
                yield* record(pending);
              }
              yield* operationBackoff(
                retries++,
                "retryAfterMs" in answer ? answer.retryAfterMs : undefined,
              );
            }
          });
          const refuse = (reason: string) =>
            Effect.gen(function* () {
              if (pending !== undefined) {
                pending = { ...pending, phase: "closed", nextActor: "person", nextAction: reason };
                yield* record(pending);
              }
              yield* leader.write(
                sql`UPDATE hq_deploy_job SET state=${saved?.evidence?.witness !== undefined ? "unresolved" : "refused"}, reason=${reason.slice(0, 240)}, ended_at=now(), updated_at=now() WHERE id=${job.id}::bigint AND ended_at IS NULL`,
              );
            });
          const tell = (patch: Pick<PushEvidence, "nextAction"> & Partial<PushEvidence>) =>
            Effect.gen(function* () {
              if (pending === undefined) return;
              pending = { ...pending, nextActor: "hq", ...patch };
              yield* record(pending);
            });
          if (!use.ok) return yield* refuse(use.reason);
          // A release to an origin's main that has a stage pushes the very commit stage took, once
          // the checks main requires passed on it: GitHub's required checks on main read that
          // commit's runs.
          let holdUntil: number | undefined;
          if (environment.tier === "production" && environment.staged) {
            const at = job.sha.slice(0, 7);
            const waiting = `Waiting for stage to take ${at} first; the release pushes once stage CI passes on it.`;
            let since: number | undefined;
            let stageAt: string | undefined;
            for (;;) {
              const taken = yield* sql<{ readonly state: string; readonly at: string | null }>`
                SELECT j.state, j.evidence->>'at' AS at FROM hq_deploy_job j
                JOIN hq_environment s ON s.id=j.environment_id AND s.target='git' AND s.tier='stage'
                WHERE s.app_id::text=${job.app_id} AND j.kind='push' AND j.repo=${job.repo} AND j.sha=${job.sha}
                ORDER BY j.id`;
              stageAt =
                taken.find((row) => row.state === "pushed" && row.at !== null)?.at ?? undefined;
              if (stageAt !== undefined) break;
              const now = yield* Clock.currentTimeMillis;
              since ??= now;
              if (
                !taken.some((row) => row.state === "queued" || row.state === "submitting") ||
                now >= since + Duration.toMillis(CI_WINDOW)
              )
                return yield* refuse(
                  `Stage never took ${at}, so stage CI never ran on it and this release can't go out. Release again once stage has main's head.`,
                );
              if (pending?.nextAction !== waiting) yield* tell({ nextAction: waiting });
              yield* Effect.race(next, Effect.sleep("15 seconds"));
            }
            const remote = remoteIdentity(use.value.remote.url);
            if (remote?.kind === "github") {
              const gate = yield* stageCheck(
                {
                  appId: job.app_id,
                  repo: job.repo,
                  branch: environment.branch,
                  remote,
                  sha: job.sha,
                  pushedAt: DateTime.toEpochMillis(DateTime.makeUnsafe(stageAt)),
                  previous: pending?.gate,
                },
                (gate) => {
                  const said = releaseGateWords(gate);
                  return tell({
                    gate,
                    nextAction: said.verdict === "wait" ? said.words : (pending?.nextAction ?? ""),
                  });
                },
              ).pipe(Effect.provide(reads));
              const said = releaseGateWords(gate);
              if (said.verdict !== "push") return yield* refuse(said.words);
              if (said.words !== "") yield* tell({ nextAction: said.words });
              holdUntil = DateTime.toEpochMillis(DateTime.makeUnsafe(gate!.until));
            }
          }
          const directory = yield* Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-git-push-")),
          );
          const git = yield* host.git;
          const bundle = NodePath.join(directory, "source.bundle");
          yield* git.bundle({ appId: job.app_id, id: job.repo }, bundle).pipe(Effect.orDie);
          const input: PushInput = {
            directory,
            url: use.value.remote.url,
            identity: use.value.remote.hostRepoId ?? use.value.remote.urlKey,
            ref: `refs/heads/${environment.branch}`,
            sha: job.sha,
            keptAt: use.value.remote.keptAt!,
            repositoryId: use.value.remote.hostRepoId,
            token: use.value.token,
            confirmed: null,
          };
          const cloned = yield* runChild(input, {
            mode: "clone",
            directory,
            url: bundle,
            ref: input.ref,
            sha: input.sha,
            before: null,
            witness: NodePath.join(directory, "clone.json"),
          });
          if (cloned?.code !== 0 || !cloned.drained) {
            yield* leader.write(
              sql`UPDATE hq_deploy_job SET state=${saved?.evidence?.witness !== undefined ? "unresolved" : "refused"},reason='HQ could not prepare the fixed Git commit',ended_at=now(),updated_at=now() WHERE id=${job.id}::bigint AND ended_at IS NULL`,
            );
            yield* Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true }));
            return;
          }
          const [confirmed] = yield* sql<{
            readonly sha: string;
          }>`SELECT sha FROM hq_deploy_job WHERE environment_id=${job.environment_id} AND repo=${job.repo} AND state='pushed' ORDER BY ended_at DESC,id DESC LIMIT 1`;
          const result = yield* deliverRef(
            {
              ...input,
              directory: NodePath.join(directory, "snapshot.git"),
              confirmed: confirmed?.sha ?? null,
              ...(holdUntil === undefined ? {} : { holdUntil }),
            },
            record,
            pending,
          );
          if (result.credentialRefused)
            yield* remotes.invalidate(
              { appId: job.app_id, repo: job.repo },
              result.evidence.keptAt,
            );
          yield* leader.write(
            sql`UPDATE hq_deploy_job SET state=${result.state}, reason=${result.reason ?? null}, evidence=${encode(result.evidence)}::jsonb, ended_at=now(), updated_at=now() WHERE id=${job.id}::bigint AND ended_at IS NULL`,
          );
          yield* changed;
          if (result.evidence.writerDrained)
            yield* Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true }));
        }),
    });
  }),
);
