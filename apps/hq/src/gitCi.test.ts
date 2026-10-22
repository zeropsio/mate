import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, expect, it } from "@effect/vitest";
import { HqPushEvidence, type HqPushCi } from "@t3tools/shared/hqDeploys";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { TestClock } from "effect/testing";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import {
  type CheckRun,
  type CommitStatus,
  ciVerdict,
  followCi,
  GitCi,
  gitCiLayer,
  releaseGateWords,
  requiredChecks,
  stageCheck,
} from "./gitCi.ts";
import { pushEvidenceForWire, type PushEvidence } from "./gitPush.ts";
import { GitTransport, type HostReply, remoteIdentity } from "./gitTransport.ts";
import { Leader } from "./leader.ts";
import { type RemoteRecord, Remotes, RemoteRefused } from "./repoRemotes.ts";

const run = (
  name: string,
  status: string,
  conclusion: string | null = null,
  url = `https://github.com/acme/app/actions/runs/7/job/${name}`,
  started_at: string | null = "2026-10-17T10:00:00Z",
  id = 1,
): CheckRun => ({ id, name, status, conclusion, started_at, html_url: url });
const status = (context: string, state: string): CommitStatus => ({
  context,
  state,
  target_url: `https://ci.example/${context}`,
});

describe("the verdict of a pushed commit's CI", () => {
  it.each<{
    readonly title: string;
    readonly runs: ReadonlyArray<CheckRun>;
    readonly statuses?: ReadonlyArray<CommitStatus>;
    readonly required: ReadonlyArray<string> | null;
    readonly expected: ReturnType<typeof ciVerdict>;
  }>([
    {
      title: "a push whose required check failed shows failed with that check's name",
      runs: [run("check_types", "completed", "failure"), run("unit", "completed", "success")],
      required: ["check_types", "unit"],
      expected: {
        verdict: "failed",
        done: 2,
        total: 2,
        failed: [
          {
            name: "check_types",
            url: "https://github.com/acme/app/actions/runs/7/job/check_types",
          },
        ],
      },
    },
    {
      title: "a red check the branch rules do not require leaves the push passed",
      runs: [run("unit", "completed", "success"), run("signal", "completed", "failure")],
      required: ["unit"],
      expected: { verdict: "passed", done: 1, total: 1, failed: [] },
    },
    {
      title: "a required check GitHub has not reported yet keeps the push running",
      runs: [run("unit", "completed", "success")],
      required: ["unit", "check_types"],
      expected: { verdict: "running", done: 1, total: 2, failed: [] },
    },
    {
      title: "a required commit status counts like a required check run",
      runs: [],
      statuses: [status("deploy/preview", "error")],
      required: ["deploy/preview"],
      expected: {
        verdict: "failed",
        done: 1,
        total: 1,
        failed: [{ name: "deploy/preview", url: "https://ci.example/deploy/preview" }],
      },
    },
    {
      title:
        "without required checks a push passes when every check run succeeded, was neutral or skipped",
      runs: [
        run("unit", "completed", "success"),
        run("lint", "completed", "neutral"),
        run("cache", "completed", "skipped"),
      ],
      statuses: [status("deploy", "success")],
      required: null,
      expected: { verdict: "passed", done: 4, total: 4, failed: [] },
    },
    {
      title: "without required checks any failed check run fails the push",
      runs: [run("unit", "completed", "success"), run("e2e", "completed", "timed_out")],
      required: null,
      expected: {
        verdict: "failed",
        done: 2,
        total: 2,
        failed: [{ name: "e2e", url: "https://github.com/acme/app/actions/runs/7/job/e2e" }],
      },
    },
    {
      title: "without required checks a failed commit status fails the push",
      runs: [run("unit", "completed", "success")],
      statuses: [status("deploy", "failure")],
      required: null,
      expected: {
        verdict: "failed",
        done: 2,
        total: 2,
        failed: [{ name: "deploy", url: "https://ci.example/deploy" }],
      },
    },
    {
      title: "a push with checks still in progress shows running with how many of them are done",
      runs: [run("unit", "completed", "success"), run("e2e", "in_progress"), run("lint", "queued")],
      statuses: [status("deploy", "pending")],
      required: null,
      expected: { verdict: "running", done: 1, total: 4, failed: [] },
    },
    {
      title: "a failure shows failed even while other checks still run",
      runs: [run("unit", "completed", "failure"), run("e2e", "in_progress")],
      required: null,
      expected: {
        verdict: "failed",
        done: 1,
        total: 2,
        failed: [{ name: "unit", url: "https://github.com/acme/app/actions/runs/7/job/unit" }],
      },
    },
    {
      title: "after a fast-forward to main the same check runs again and the newer run decides",
      runs: [
        run(
          "check",
          "in_progress",
          null,
          "https://github.com/acme/app/actions/runs/9/job/check",
          "2026-10-17T10:20:00Z",
          20,
        ),
        run("check", "completed", "success", undefined, "2026-10-17T10:00:00Z", 10),
      ],
      required: null,
      expected: { verdict: "running", done: 0, total: 1, failed: [] },
    },
    {
      title: "a re-run that passed replaces the failed run of the same check",
      runs: [
        run("check", "completed", "failure", undefined, "2026-10-17T10:00:00Z", 10),
        run("check", "completed", "success", undefined, "2026-10-17T10:30:00Z", 30),
      ],
      required: null,
      expected: { verdict: "passed", done: 1, total: 1, failed: [] },
    },
    {
      title: "runs of one check started the same second are decided by the one GitHub created last",
      runs: [
        run("check", "completed", "success", undefined, "2026-10-17T10:00:00Z", 31),
        run("check", "completed", "failure", undefined, "2026-10-17T10:00:00Z", 30),
      ],
      required: null,
      expected: { verdict: "passed", done: 1, total: 1, failed: [] },
    },
    {
      title: "a push no CI reported on shows none",
      runs: [],
      required: null,
      expected: { verdict: "none", done: 0, total: 0, failed: [] },
    },
  ])("$title", ({ runs, statuses = [], required, expected }) => {
    expect(ciVerdict(runs, statuses, required)).toEqual(expected);
  });

  it("only required status check rules name the checks that count", () => {
    expect(
      requiredChecks([
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "unit" }, { context: "lint" }] },
        },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "unit" }] },
        },
      ]),
    ).toEqual(["unit", "lint"]);
    expect(requiredChecks([{ type: "deletion" }, { type: "non_fast_forward" }])).toBeNull();
  });
});

const SHA = "a".repeat(40);
const remote = remoteIdentity("https://github.com/acme/app")!;
const json = (body: unknown, headers: Record<string, string> = {}): HostReply => ({
  status: 200,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const runs = (...list: ReadonlyArray<CheckRun>) =>
  json(
    { total_count: list.length, check_runs: list },
    { etag: `"runs-${JSON.stringify(list).length}"` },
  );
const noStatuses = json({ state: "pending", statuses: [] }, { etag: '"status"' });
const noRules = json([{ type: "deletion" }], { etag: '"rules"' });
const refusedReply = (status: number, message: string): HostReply => ({
  status,
  headers: {},
  body: JSON.stringify({ message }),
});

const record = (url: string): RemoteRecord => ({
  appId: "app",
  repo: "code",
  url,
  urlKey: "github.com/acme/app",
  host: "github.com",
  hostRepoId: "42",
  keptAt: "2026-10-17T00:00:00Z",
  keptBy: "owner",
  invalidSince: null,
  expiresAt: null,
  expiryLabel: "Expiry not reported",
  credentialState: "kept",
});
const remotes = (refused?: RemoteRefused) =>
  Layer.succeed(
    Remotes,
    Remotes.of({
      changes: Stream.empty,
      listRepos: () => Effect.die("not read by CI"),
      mateRepos: () => Effect.die("not read by CI"),
      follow: () => Effect.die("not read by CI"),
      mateCredential: () => Effect.die("not read by CI"),
      write: () => Effect.die("not written by CI"),
      receipt: () => Effect.succeed(null),
      get: () => Effect.succeed(undefined),
      forUse: () =>
        refused === undefined
          ? Effect.succeed({ remote: record(remote.url), token: Redacted.make("ci-token") })
          : Effect.fail(refused),
      invalidate: () => Effect.void,
      ciAccess: () => Effect.die("not used by CI"),
      tokenOf: () => Effect.die("not used by CI"),
      connectViaApp: () => Effect.die("not used by CI"),
      connect: () => Effect.die("not used by CI"),
      updateAddress: () => Effect.die("not used by CI"),
      disconnect: () => Effect.die("not used by CI"),
    }),
  );

/** GitHub's answers by path, in order per path; each read is logged with its ETag. */
const github = (answers: Record<string, ReadonlyArray<HostReply>>) => {
  const reads: Array<{ readonly path: string; readonly etag: string | undefined }> = [];
  const served = new Map<string, number>();
  const layer = Layer.succeed(
    GitTransport,
    GitTransport.of({
      metadata: () => Effect.die("not read by CI"),
      receivePack: () => Effect.die("not read by CI"),
      rules: () => Effect.die("rules are a repository read"),
      read: (_remote, path, token, etag) =>
        Effect.sync(() => {
          expect(Redacted.value(token)).toBe("ci-token");
          reads.push({ path, etag });
          const key = Object.keys(answers).find((prefix) => path.startsWith(prefix));
          const list = key === undefined ? [] : answers[key]!;
          const index = served.get(key ?? "") ?? 0;
          served.set(key ?? "", index + 1);
          const answer = list[Math.min(index, list.length - 1)];
          if (answer === undefined) return { status: 500, headers: {}, body: "" };
          // A repeated read with the answer's ETag is GitHub's free 304.
          return etag !== undefined && etag === answer.headers["etag"]
            ? { status: 304, headers: {}, body: "" }
            : answer;
        }),
    }),
  );
  return { reads, layer };
};

const follow = (
  answers: Record<string, ReadonlyArray<HostReply>>,
  options: { readonly refused?: RemoteRefused; readonly replacedAfter?: number } = {},
) =>
  Effect.gen(function* () {
    const host = github(answers);
    const saved: Array<HqPushCi> = [];
    let replacedChecks = 0;
    const fiber = yield* followCi(
      {
        appId: "app",
        repo: "code",
        branch: "main",
        remote,
        sha: SHA,
        pushedAt: 0,
        previous: undefined,
      },
      {
        save: (ci) => Effect.sync(() => void saved.push(ci)),
        replaced: Effect.sync(
          () => options.replacedAfter !== undefined && replacedChecks++ >= options.replacedAfter,
        ),
      },
    ).pipe(Effect.provide(Layer.merge(remotes(options.refused), host.layer)), Effect.forkChild);
    return { fiber, saved, reads: host.reads };
  });
const RULES = "/rules/branches/main";
const RUNS = `/commits/${SHA}/check-runs`;
const STATUS = `/commits/${SHA}/status`;

describe("HQ reading the origin's CI after a push", () => {
  it.effect("HQ keeps reading a running push's CI until every check completed, conditionally", () =>
    Effect.gen(function* () {
      const { fiber, saved, reads } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [
          runs(run("unit", "completed", "success"), run("e2e", "in_progress")),
          runs(run("unit", "completed", "success"), run("e2e", "in_progress")),
          runs(run("unit", "completed", "success"), run("e2e", "completed", "success")),
        ],
        [STATUS]: [noStatuses],
      });
      yield* TestClock.adjust(Duration.seconds(1));
      expect(saved.map((ci) => [ci.verdict, ci.done, ci.total, ci.watch])).toEqual([
        ["running", 1, 2, "watching"],
      ]);
      yield* TestClock.adjust(Duration.seconds(15));
      // The same answer again changes nothing, and GitHub answered it with a 304.
      expect(saved).toHaveLength(1);
      expect(reads.filter((read) => read.path.startsWith(RUNS))[1]?.etag).toBeDefined();
      yield* TestClock.adjust(Duration.seconds(30));
      yield* Fiber.join(fiber);
      expect(saved.at(-1)).toMatchObject({
        sha: SHA,
        verdict: "passed",
        done: 2,
        total: 2,
        required: null,
        watch: "finished",
        reason: null,
        until: "1970-01-01T01:00:00.000Z",
      });
      // The branch rules are read once per watch.
      expect(reads.filter((read) => read.path === RULES)).toHaveLength(1);
    }),
  );

  it.effect("a push whose required check failed shows failed with that check's name", () =>
    Effect.gen(function* () {
      const { fiber, saved } = yield* follow({
        [RULES]: [
          json([
            {
              type: "required_status_checks",
              parameters: { required_status_checks: [{ context: "check_types" }] },
            },
          ]),
        ],
        [RUNS]: [
          runs(run("check_types", "completed", "failure"), run("signal", "completed", "failure")),
        ],
        [STATUS]: [noStatuses],
      });
      yield* Fiber.join(fiber);
      expect(saved).toEqual([
        expect.objectContaining({
          verdict: "failed",
          done: 1,
          total: 1,
          required: ["check_types"],
          failed: [
            {
              name: "check_types",
              url: "https://github.com/acme/app/actions/runs/7/job/check_types",
            },
          ],
          watch: "finished",
        }),
      ]);
    }),
  );

  it.effect("a combined status pending with no statuses counts as no commit statuses", () =>
    Effect.gen(function* () {
      const { fiber, saved } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [runs(run("check", "completed", "success"))],
        // GitHub's answer for a repository whose CI is only Actions.
        [STATUS]: [json({ state: "pending", total_count: 0, statuses: [] })],
      });
      yield* Fiber.join(fiber);
      expect(saved).toEqual([
        expect.objectContaining({ verdict: "passed", done: 1, total: 1, watch: "finished" }),
      ]);
    }),
  );

  it.effect("a token without Checks: Read leaves the push's CI unreadable, saying so", () =>
    Effect.gen(function* () {
      const { fiber, saved } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [refusedReply(403, "Resource not accessible by personal access token")],
        [STATUS]: [noStatuses],
      });
      yield* Fiber.join(fiber);
      expect(saved).toEqual([
        expect.objectContaining({
          verdict: "unreadable",
          watch: "stopped",
          reason: "The token can't read check runs. Add Checks: Read to the token to show CI.",
        }),
      ]);
    }),
  );

  it.effect("a token without Commit statuses: Read leaves the push's CI unreadable", () =>
    Effect.gen(function* () {
      const { fiber, saved } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [runs(run("unit", "completed", "success"))],
        [STATUS]: [refusedReply(403, "Resource not accessible by personal access token")],
      });
      yield* Fiber.join(fiber);
      expect(saved.map((ci) => [ci.verdict, ci.reason])).toEqual([
        [
          "unreadable",
          "The token can't read commit statuses. Add Commit statuses: Read to the token to show CI.",
        ],
      ]);
    }),
  );

  it.effect("a refused sealed token leaves the push's CI unreadable with the refusal's words", () =>
    Effect.gen(function* () {
      const refused = new RemoteRefused({ reason: "credential_invalid" });
      const { fiber, saved, reads } = yield* follow({}, { refused });
      yield* Fiber.join(fiber);
      expect(reads).toEqual([]);
      expect(saved.map((ci) => [ci.verdict, ci.watch, ci.reason])).toEqual([
        ["unreadable", "stopped", refused.message],
      ]);
    }),
  );

  it.effect("HQ says it stopped watching when checks still run an hour after the push", () =>
    Effect.gen(function* () {
      const { fiber, saved } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [runs(run("e2e", "in_progress"))],
        [STATUS]: [noStatuses],
      });
      for (let minute = 0; minute <= 61; minute++) yield* TestClock.adjust(Duration.minutes(1));
      yield* Fiber.join(fiber);
      expect(saved.map((ci) => [ci.verdict, ci.done, ci.total, ci.watch, ci.reason])).toEqual([
        ["running", 0, 1, "watching", null],
        ["running", 0, 1, "stopped", "Mate stopped watching CI 60 minutes after the push."],
      ]);
    }),
  );

  it.effect("no CI reported five minutes after the push shows none and stops reading", () =>
    Effect.gen(function* () {
      const { fiber, saved, reads } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [runs()],
        [STATUS]: [noStatuses],
      });
      for (let minute = 0; minute <= 6; minute++) yield* TestClock.adjust(Duration.minutes(1));
      yield* Fiber.join(fiber);
      expect(saved.map((ci) => [ci.verdict, ci.watch])).toEqual([
        ["none", "watching"],
        ["none", "finished"],
      ]);
      const count = reads.length;
      yield* TestClock.adjust(Duration.minutes(10));
      expect(reads).toHaveLength(count);
    }),
  );

  it.effect("HQ waits until GitHub's rate limit resets before reading again", () =>
    Effect.gen(function* () {
      const { fiber, saved, reads } = yield* follow({
        [RULES]: [noRules],
        [RUNS]: [
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "120" },
            body: JSON.stringify({ message: "API rate limit exceeded" }),
          },
          runs(run("unit", "completed", "success")),
        ],
        [STATUS]: [noStatuses],
      });
      yield* TestClock.adjust(Duration.seconds(1));
      expect(reads.filter((read) => read.path.startsWith(RUNS))).toHaveLength(1);
      yield* TestClock.adjust(Duration.seconds(60));
      expect(reads.filter((read) => read.path.startsWith(RUNS))).toHaveLength(1);
      yield* TestClock.adjust(Duration.seconds(60));
      yield* Fiber.join(fiber);
      expect(saved.map((ci) => [ci.verdict, ci.watch])).toEqual([["passed", "finished"]]);
    }),
  );

  it.effect("a newer push to the branch stops watching the older commit's CI", () =>
    Effect.gen(function* () {
      const { fiber, saved } = yield* follow(
        {
          [RULES]: [noRules],
          [RUNS]: [runs(run("e2e", "in_progress"))],
          [STATUS]: [noStatuses],
        },
        { replacedAfter: 1 },
      );
      yield* TestClock.adjust(Duration.seconds(20));
      yield* Fiber.join(fiber);
      expect(saved.map((ci) => [ci.verdict, ci.watch, ci.reason])).toEqual([
        ["running", "watching", null],
        [
          "running",
          "stopped",
          "A newer push to main replaced this commit; Mate watches that one's CI.",
        ],
      ]);
    }),
  );
});

/** A check run GitHub Actions (app 15368) reported. */
const actions = (checkRun: CheckRun): CheckRun => ({ ...checkRun, app: { id: 15368 } });
const SHORT = SHA.slice(0, 7);
const requires = (
  ...checks: ReadonlyArray<{ readonly context: string; readonly integration_id?: number }>
) =>
  json([
    { type: "deletion" },
    { type: "required_status_checks", parameters: { required_status_checks: checks } },
  ]);
/** What the release said as the gate changed, each sentence once. */
const saidOf = (seen: ReadonlyArray<HqPushCi>) =>
  seen
    .map(releaseGateWords)
    .filter((said, index, all) => index === 0 || all[index - 1]!.words !== said.words);
/** Stage's gate as a release reads it, an hour of the test clock long. */
const gateOf = (answers: Record<string, ReadonlyArray<HostReply>>) =>
  Effect.gen(function* () {
    const host = github(answers);
    const seen: Array<HqPushCi> = [];
    const fiber = yield* stageCheck(
      {
        appId: "app",
        repo: "code",
        branch: "main",
        remote,
        sha: SHA,
        pushedAt: 0,
        previous: undefined,
      },
      (gate) => Effect.sync(() => void seen.push(gate)),
    ).pipe(Effect.provide(Layer.merge(remotes(), host.layer)), Effect.forkChild);
    for (let minute = 0; minute <= 61; minute++) yield* TestClock.adjust(Duration.minutes(1));
    const gate = yield* Fiber.join(fiber);
    return { gate, seen, reads: host.reads };
  });

describe("a release to an origin's main reads stage's check before it pushes", () => {
  it.effect.each<{
    readonly title: string;
    readonly answers: ReadonlyArray<HostReply>;
    readonly said: ReadonlyArray<ReturnType<typeof releaseGateWords>>;
    readonly failed?: ReadonlyArray<{ readonly name: string; readonly url: string }>;
  }>([
    {
      title: "running, then passed: it waits, then pushes",
      answers: [
        runs(actions(run("check", "in_progress"))),
        runs(actions(run("check", "completed", "success"))),
      ],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "check" to pass on ${SHORT}; the release pushes once it does.`,
        },
        { verdict: "push", words: "" },
      ],
    },
    {
      title: "failed: it refuses, naming the check with its link",
      answers: [runs(actions(run("check", "completed", "failure")))],
      said: [
        {
          verdict: "refuse",
          words: `Stage CI "check" failed on ${SHORT}, so this release can't go out. Fix it on main, then release again.`,
        },
      ],
      failed: [{ name: "check", url: "https://github.com/acme/app/actions/runs/7/job/check" }],
    },
    {
      title: "never ran: it waits five minutes, then refuses",
      answers: [runs(actions(run("unit", "completed", "success")))],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "check" to start on ${SHORT}; the release pushes once it passes.`,
        },
        {
          verdict: "refuse",
          words: `Stage CI "check" never ran on ${SHORT}, so this release can't go out. Add a CI job named "check" that runs on pushes to stage, then release again.`,
        },
      ],
    },
    {
      title: "a check named check from another app is not GitHub Actions' and never ran",
      answers: [runs({ ...run("check", "completed", "success"), app: { id: 99 } })],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "check" to start on ${SHORT}; the release pushes once it passes.`,
        },
        {
          verdict: "refuse",
          words: `Stage CI "check" never ran on ${SHORT}, so this release can't go out. Add a CI job named "check" that runs on pushes to stage, then release again.`,
        },
      ],
    },
    {
      title: "still running an hour after stage took it: it stops waiting and refuses",
      answers: [runs(actions(run("check", "in_progress")))],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "check" to pass on ${SHORT}; the release pushes once it does.`,
        },
        {
          verdict: "refuse",
          words: `Stage CI "check" hadn't passed on ${SHORT} when Mate stopped waiting, so this release can't go out. Mate stopped watching CI 60 minutes after the push.`,
        },
      ],
    },
  ])(
    "a release waits while the stage SHA's check runs, and refuses when it failed or never ran: $title",
    ({ answers, said, failed }) =>
      Effect.gen(function* () {
        const { gate, seen, reads } = yield* gateOf({
          [RULES]: [requires({ context: "check", integration_id: 15368 })],
          [RUNS]: answers,
        });
        expect(seen.map(releaseGateWords)).toEqual(said);
        expect(gate).toEqual(seen.at(-1));
        expect(gate?.failed).toEqual(failed ?? []);
        // Main's rules, then GitHub's check runs: never the combined status.
        expect(reads[0]?.path).toBe(RULES);
        expect(reads.slice(1).every((read) => read.path.startsWith(RUNS))).toBe(true);
      }),
  );

  it.effect.each<{
    readonly title: string;
    readonly answers: ReadonlyArray<HostReply>;
    readonly said: ReadonlyArray<ReturnType<typeof releaseGateWords>>;
    readonly failed?: ReadonlyArray<{ readonly name: string; readonly url: string }>;
  }>([
    {
      title: "a job that starts after the others finish is still waited for, then it pushes",
      answers: [
        runs(actions(run("Check", "in_progress")), actions(run("Signal", "completed", "failure"))),
        runs(actions(run("Check", "completed", "success"))),
        runs(actions(run("Check", "completed", "success"))),
        runs(actions(run("Check", "completed", "success")), actions(run("Test", "in_progress"))),
        runs(
          actions(run("Check", "completed", "success")),
          actions(run("Test", "completed", "success")),
        ),
      ],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "Check", "Test" to pass on ${SHORT}; the release pushes once they do.`,
        },
        { verdict: "push", words: "" },
      ],
    },
    {
      title: "a required check that failed refuses at once, naming it with its link",
      answers: [
        runs(actions(run("Check", "completed", "failure")), actions(run("Test", "in_progress"))),
      ],
      said: [
        {
          verdict: "refuse",
          words: `Stage CI "Check" failed on ${SHORT}, so this release can't go out. Fix it on main, then release again.`,
        },
      ],
      failed: [{ name: "Check", url: "https://github.com/acme/app/actions/runs/7/job/Check" }],
    },
    {
      title: "a required check from another app than the rule names does not count",
      answers: [
        runs(
          { ...run("Check", "completed", "success"), app: { id: 99 } },
          actions(run("Test", "completed", "success")),
        ),
      ],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "Check", "Test" to pass on ${SHORT}; the release pushes once they do.`,
        },
        {
          verdict: "refuse",
          words: `Stage CI "Check" never ran on ${SHORT}, so this release can't go out. Add a CI job named "Check" that runs on pushes to stage, then release again.`,
        },
      ],
    },
    {
      title: "none of the required checks reported five minutes after stage took it: never ran",
      answers: [runs(actions(run("lint", "completed", "success")))],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI "Check", "Test" to start on ${SHORT}; the release pushes once they pass.`,
        },
        {
          verdict: "refuse",
          words: `Stage CI "Check", "Test" never ran on ${SHORT}, so this release can't go out. Add CI jobs named "Check", "Test" that run on pushes to stage, then release again.`,
        },
      ],
    },
  ])(
    "a release waits on every check the origin's main requires, by the names the repository gives them: $title",
    ({ answers, said, failed }) =>
      Effect.gen(function* () {
        const { gate, seen } = yield* gateOf({
          [RULES]: [requires({ context: "Check", integration_id: 15368 }, { context: "Test" })],
          [RUNS]: answers,
        });
        expect(saidOf(seen)).toEqual(said);
        expect(gate?.required).toEqual(["Check", "Test"]);
        expect(gate?.failed).toEqual(failed ?? []);
      }),
  );

  it.effect.each<{
    readonly title: string;
    readonly rules: HostReply;
    readonly answers: ReadonlyArray<HostReply>;
    readonly said: ReadonlyArray<ReturnType<typeof releaseGateWords>>;
  }>([
    {
      title: "every Actions check passes, another app's red check aside: it pushes",
      rules: noRules,
      answers: [
        runs(actions(run("lint", "completed", "success")), actions(run("unit", "in_progress")), {
          ...run("deploy-preview", "completed", "failure"),
          app: { id: 99 },
        }),
        runs(
          actions(run("lint", "completed", "success")),
          actions(run("unit", "completed", "success")),
        ),
      ],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI to pass on ${SHORT}; the release pushes once it does.`,
        },
        { verdict: "push", words: "" },
      ],
    },
    {
      title: "an Actions check failed: it refuses, naming it",
      rules: noRules,
      answers: [
        runs(
          actions(run("lint", "completed", "success")),
          actions(run("unit", "completed", "failure")),
        ),
      ],
      said: [
        {
          verdict: "refuse",
          words: `Stage CI "unit" failed on ${SHORT}, so this release can't go out. Fix it on main, then release again.`,
        },
      ],
    },
    {
      title: "no CI reported within five minutes: it goes out, saying so",
      rules: noRules,
      answers: [runs()],
      said: [
        {
          verdict: "wait",
          words: `Waiting for stage CI to start on ${SHORT}; main requires no checks, so the release goes out without CI if none starts within 5 minutes.`,
        },
        {
          verdict: "push",
          words: `No stage CI reported on ${SHORT} and main requires no checks, so the release goes out without CI.`,
        },
      ],
    },
    {
      title: "rules GitHub keeps from this plan count as none",
      rules: refusedReply(
        403,
        "Upgrade to GitHub Pro or make this repository public to enable this feature.",
      ),
      answers: [runs(actions(run("lint", "completed", "success")))],
      said: [{ verdict: "push", words: "" }],
    },
  ])(
    "a release to an unprotected main waits on every Actions check of the stage commit: $title",
    ({ rules, answers, said }) =>
      Effect.gen(function* () {
        const { gate, seen } = yield* gateOf({ [RULES]: [rules], [RUNS]: answers });
        expect(saidOf(seen)).toEqual(said);
        expect(gate?.required).toBeNull();
      }),
  );
});

const leader = Layer.succeed(
  Leader,
  Leader.of({
    status: Effect.succeed({ state: "active", epoch: 1 }),
    write: (effect) => effect,
    nextAttempt: Effect.void,
    finished: Effect.void,
    changes: Stream.make({ state: "active" as const, epoch: 1 }),
    release: Effect.void,
    hold: () => Effect.void,
    held: Effect.succeed(null),
  }),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const pushed = (sha: string, ci?: Partial<HqPushCi>) => ({
  phase: "closed",
  processes: [],
  version: null,
  nextActor: "none",
  nextAction: "Operation ended",
  remote: remote.url,
  identity: "42",
  repositoryId: "42",
  ref: "refs/heads/main",
  sha,
  keptAt: "2026-10-17T00:00:00Z",
  before: null,
  writerDrained: true,
  after: sha,
  via: "answer",
  at: "2026-10-17T10:00:00.000Z",
  ...(ci === undefined
    ? {}
    : {
        ci: {
          sha,
          verdict: "running",
          done: 0,
          total: 1,
          failed: [],
          required: null,
          reason: null,
          watch: "watching",
          readAt: "2026-10-17T10:00:10.000Z",
          until: "2026-10-17T11:00:00.000Z",
          ...ci,
        },
      }),
});

describe("the CI record on a push's evidence", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    const withPushes = <A, E>(
      use: (
        insert: (
          environment: string,
          sha: string,
          ci?: Partial<HqPushCi>,
        ) => Effect.Effect<string, SqlError>,
      ) => Effect.Effect<A, E, SqlClient.SqlClient | GitCi>,
      answers: Record<string, ReadonlyArray<HostReply>> = {},
    ) =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createMigratedDatabase;
        const database = PgClient.layer({ url: Redacted.make(url) });
        const ci = gitCiLayer.pipe(
          Layer.provide(Layer.mergeAll(leader, remotes(), github(answers).layer)),
        );
        return yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [app] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
          const environments = new Set<string>();
          const insert = (environment: string, sha: string, ci?: Partial<HqPushCi>) =>
            Effect.gen(function* () {
              if (!environments.has(environment)) {
                environments.add(environment);
                yield* sql`INSERT INTO hq_environment (id,app_id,target,tier,name,sources,branch,delivery,created_by,release_floor)
                  VALUES (${environment},${app!.id}::uuid,'git','stage',${environment},'{main}'::text[],${environment},'direct','owner',now())`;
              }
              const [rollout] = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_rollout(app_id,cause,environment_id,planned_at)
                VALUES (${app!.id}::uuid,'import',${environment},now()) RETURNING id::text AS id`;
              const [job] = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_deploy_job(rollout_id,kind,environment_id,repo,sha,label,state,submitted_at,ended_at,evidence)
                VALUES (${rollout!.id}::bigint,'push',${environment},'code',${sha},'main','pushed',now(),now(),
                  ${encodeJson(pushed(sha, ci))}::jsonb)
                RETURNING id::text AS id`;
              return job!.id;
            });
          return yield* use(insert);
        }).pipe(Effect.provide(Layer.provideMerge(ci, database)));
      });

    it.effect(
      "HQ resumes watching after a restart for the newest push whose CI it had not finished",
      () =>
        withPushes((insert) =>
          Effect.gen(function* () {
            const older = yield* insert("git-stage", "b".repeat(40), {});
            const newest = yield* insert("git-stage", "c".repeat(40), {});
            const unread = yield* insert("git-prod", "d".repeat(40));
            yield* insert("git-other", "e".repeat(40), { watch: "finished", verdict: "passed" });
            const resumable = yield* (yield* GitCi).resumable;
            expect(resumable.toSorted()).toEqual([newest, unread].toSorted());
            assert.notInclude(resumable, older);
          }),
        ),
    );

    it.effect(
      "a release's push to main reads as the stage run it waited for, never waiting for main's own run",
      () =>
        withPushes((insert) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const id = yield* insert("git-prod", SHA);
            const gate: HqPushCi = {
              sha: SHA,
              verdict: "passed",
              done: 1,
              total: 1,
              failed: [],
              required: ["check"],
              reason: null,
              watch: "finished",
              readAt: "2026-10-17T09:58:00.000Z",
              until: "2026-10-17T10:50:00.000Z",
            };
            yield* sql`UPDATE hq_deploy_job SET evidence = jsonb_set(evidence, '{gate}', ${encodeJson(gate)}::jsonb)
              WHERE id=${id}::bigint`;
            // GitHub answers nothing here: any read of main's run would never finish.
            yield* (yield* GitCi).watch(id, Effect.void);
            const [row] = yield* sql<{ readonly evidence: PushEvidence }>`
              SELECT evidence FROM hq_deploy_job WHERE id=${id}::bigint`;
            expect(row?.evidence.ci).toEqual(gate);
            expect(pushEvidenceForWire(row!.evidence).ci).toEqual(gate);
          }),
        ),
    );

    it.effect(
      "a release to an unprotected main whose stage commit reported no CI keeps saying so after the push",
      () =>
        withPushes((insert) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const id = yield* insert("git-prod", SHA);
            const gate: HqPushCi = {
              sha: SHA,
              verdict: "none",
              done: 0,
              total: 0,
              failed: [],
              required: null,
              reason: null,
              watch: "finished",
              readAt: "2026-10-17T09:58:00.000Z",
              until: "2026-10-17T10:50:00.000Z",
            };
            yield* sql`UPDATE hq_deploy_job SET evidence = jsonb_set(evidence, '{gate}', ${encodeJson(gate)}::jsonb)
              WHERE id=${id}::bigint`;
            yield* (yield* GitCi).watch(id, Effect.void);
            const [row] = yield* sql<{ readonly evidence: PushEvidence }>`
              SELECT evidence FROM hq_deploy_job WHERE id=${id}::bigint`;
            expect(pushEvidenceForWire(row!.evidence).ci).toEqual(gate);
          }),
        ),
    );

    it.effect("the CI verdict lands on the push's evidence and reaches the wire with it", () =>
      withPushes(
        (insert) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const id = yield* insert("git-stage", SHA);
            let changes = 0;
            yield* (yield* GitCi).watch(
              id,
              Effect.sync(() => void changes++),
            );
            const [row] = yield* sql<{ readonly evidence: PushEvidence }>`
              SELECT evidence FROM hq_deploy_job WHERE id=${id}::bigint`;
            // The push's own facts stay; the record is one more of them.
            expect(row?.evidence.phase).toBe("closed");
            expect(row?.evidence.after).toBe(SHA);
            const wire = yield* Schema.decodeUnknownEffect(HqPushEvidence)(
              pushEvidenceForWire(row!.evidence),
            );
            expect(wire.ci).toEqual(row?.evidence.ci);
            expect(wire.ci).toMatchObject({
              sha: SHA,
              verdict: "failed",
              failed: [
                { name: "unit", url: "https://github.com/acme/app/actions/runs/7/job/unit" },
              ],
              watch: "finished",
              until: "2026-10-17T11:00:00.000Z",
            });
            expect(changes).toBe(1);
          }),
        {
          "/rules/branches/": [noRules],
          [RUNS]: [runs(run("unit", "completed", "failure"))],
          [STATUS]: [noStatuses],
        },
      ),
    );
  });
});
