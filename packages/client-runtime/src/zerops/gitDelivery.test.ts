import { HqEnvironmentId } from "@t3tools/contracts";
import type { HqPushNavigationJob, HqGitNavigationEnvironment } from "@t3tools/shared/hqStream";
import type { Release } from "@t3tools/shared/hqRelease";
import { describe, expect, it } from "vite-plus/test";
import { gitDeliveryOf } from "./gitDelivery.ts";
import { canonicalEnvironmentRowInputsOf } from "./groupDeploys.ts";
import { canonicalEnvironmentRow } from "./groupRows.ts";
import { groupFlow } from "./groupFlow.ts";
import { stopVerdict } from "./flow/stopDetail.ts";

const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const AT = "2026-10-13T10:00:00Z";
const remote = {
  url: "https://github.com/acme/api.git",
  repositoryId: "1",
  keptAt: AT,
  keptBy: "custodian",
  expiresAt: null,
  invalidSince: null,
};
const target = { kind: "git", branch: "main", delivery: "direct" } as const;
const attachment = { environmentId: HqEnvironmentId.make("git-prod"), createdAt: AT, target };
const release = (tag = "v2.0.0", sha = SHA): Release => ({
  tag,
  sha,
  entries: [
    { service: "api", sha },
    { service: "web", sha },
  ],
  target: "git",
  releaseTarget: attachment,
  by: "releaser",
  at: AT,
  state: "approved",
  reason: null,
  rollbackOf: null,
});
function job(
  state: HqPushNavigationJob["state"],
  repo = "api",
  tag = "v2.0.0",
  sha = SHA,
): HqPushNavigationJob {
  const attempt = {
    remote,
    ref: "refs/heads/main",
    sha,
    before: OLD,
    credentialKeptAt: AT,
    phase: "submitting",
  } as const;
  return {
    id: `${tag}/${repo}/${state}`,
    kind: "push",
    service: repo,
    sha,
    state,
    cause: "release",
    ref: tag,
    reason: state === "refused" ? "credential" : null,
    appVersionId: null,
    processId: null,
    requestedBy: "releaser",
    at: AT,
    endedAt: state === "queued" || state === "submitting" ? null : AT,
    supersededBy: null,
    evidence: {
      attempt,
      ...(state === "pushed"
        ? {
            confirmed: {
              remote,
              ref: attempt.ref,
              before: OLD,
              after: sha,
              at: AT,
              via: "answer" as const,
            },
          }
        : {}),
      nextActor:
        state === "unresolved" || state === "refused"
          ? "person"
          : state === "queued" || state === "submitting"
            ? "hq"
            : "none",
      nextAction: state === "refused" ? "Replace token" : "Check main on github.com",
    },
  };
}
const environment = (jobs: ReadonlyArray<HqPushNavigationJob>): HqGitNavigationEnvironment => ({
  id: attachment.environmentId,
  target,
  tier: "production",
  jobs,
  name: "Production",
  sources: ["release"],
  order: 1,
  keyHeld: false,
  keyInvalid: false,
  can: {},
  birth: null,
  release: {
    id: "rollout-2",
    target: "git",
    releaseTarget: attachment,
    tag: "v2.0.0",
    planned: true,
    ended: true,
    endedAt: AT,
    landed: false,
    leftOut: [],
  },
});
const repos = [
  { name: "api", mainHead: SHA, updatedAt: AT, remote },
  { name: "web", mainHead: SHA, updatedAt: AT, remote },
];
const facts = { releases: [release(), release("v1.0.0", OLD)], repos };

describe("Git standing from the accepted release", () => {
  it("A pushed release is never called live until every receiving service runs that commit.", () => {
    const answer = gitDeliveryOf(environment([job("pushed"), job("pushed", "web")]), facts);
    expect(answer).toMatchObject({
      standing: "pushed",
      line: "Pushed v2.0.0",
      pushed: 2,
      total: 2,
      version: "v2.0.0",
      nextActor: "none",
    });
    expect(answer).not.toHaveProperty("runs");
    expect(answer).not.toHaveProperty("live");
    const inputs = canonicalEnvironmentRowInputsOf({
      environments: [
        {
          ...environment([job("pushed"), job("pushed", "web")]),
          name: "Production",
          sources: ["release"],
          order: 1,
          keyHeld: false,
          keyInvalid: false,
          can: {},
          birth: null,
        },
      ],
      projectNames: new Map(),
      services: [],
      versions: new Map(),
      git: facts,
    });
    const row = canonicalEnvironmentRow(inputs[0]!);
    expect(row).toMatchObject({ line: "Pushed v2.0.0", tone: "neutral", deploys: [], git: answer });
    const flow = groupFlow({
      groupId: "app",
      mates: [],
      pullRequests: [],
      merged: [],
      pending: [],
      mainHasCode: true,
      mainHead: SHA,
      stops: [
        {
          projectId: "",
          name: "Production",
          tier: "production",
          row,
          deployment: undefined,
          addresses: [],
        },
      ],
      release: {
        gate: { allowed: false, reason: "Nothing waiting" },
        suggestion: "v2.0.1",
        waiting: 0,
        waitingAtLeast: false,
        untold: [],
      },
    });
    expect(flow.production).toMatchObject({
      kind: "pushed",
      line: "Pushed v2.0.0",
      stop: { state: "checking", git: answer },
    });
    expect(flow.production).not.toHaveProperty("live");
  });

  it("Changes wait for a git production until HQ pushed them.", () => {
    const pending = environment([
      job("queued"),
      job("queued", "web"),
      job("pushed", "api", "v1.0.0", OLD),
      job("pushed", "web", "v1.0.0", OLD),
    ]);
    const before = gitDeliveryOf(pending, facts);
    expect([...before!.lastPushed]).toEqual([
      ["api", OLD],
      ["web", OLD],
    ]);
    expect(before).toMatchObject({
      previousVersion: "v1.0.0",
      pushed: 0,
      queuedVersion: "v2.0.0",
      nextActor: "hq",
    });
    const after = gitDeliveryOf(
      environment([job("pushed"), job("pushed", "web"), ...pending.jobs.slice(2)]),
      facts,
    );
    expect([...after!.lastPushed]).toEqual([
      ["api", SHA],
      ["web", SHA],
    ]);
  });

  it("L1d: a release keeps its accepted repository roster and shas, including named omissions", () => {
    const env = environment([job("pushed"), job("refused", "web"), job("pushed", "new")]);
    const answer = gitDeliveryOf(env, {
      ...facts,
      repos: [...repos, { name: "new", mainHead: SHA, updatedAt: AT, remote }],
    });
    expect(answer).toMatchObject({
      standing: "partly",
      pushed: 1,
      total: 2,
      line: "Pushed 1 of 2: web: credential",
    });
    expect(answer!.repositories.map((repo) => [repo.repo, repo.sha, repo.state])).toEqual([
      ["api", SHA, "pushed"],
      ["web", SHA, "refused"],
    ]);
    const omitted = gitDeliveryOf(
      {
        ...env,
        release: {
          ...env.release!,
          leftOut: [{ service: "docs", sha: SHA, job: null, reason: "No remote connected" }],
        },
      },
      facts,
    );
    expect(omitted).toMatchObject({ pushed: 1, total: 3 });
    expect(omitted!.repositories[2]).toMatchObject({
      repo: "docs",
      state: "left-out",
      reason: "No remote connected",
    });
  });

  it("another release's receipt cannot complete this release", () => {
    const answer = gitDeliveryOf(
      environment([job("pushed"), job("pushed", "web", "v1.0.0")]),
      facts,
    );
    expect(answer).toMatchObject({ standing: "checking", pushed: 1, total: 2 });
  });

  it("L3c/d/e: an ended unresolved writer blocks advancement and keeps active and queued versions distinct", () => {
    const answer = gitDeliveryOf(
      environment([job("queued"), job("unresolved", "api", "v1.0.0", OLD)]),
      facts,
    );
    expect(answer).toMatchObject({
      standing: "unresolved",
      activeVersion: "v1.0.0",
      queuedVersion: "v2.0.0",
      blocked: true,
      nextActor: "person",
      release: { allowed: false, actions: ["cancel"] },
    });
    expect(answer!.line).toContain("v1.0.0");
  });

  it.each(["diverged", "credential"] as const)(
    "a %s preflight blocks Release and names only its supported recovery",
    (verdict) => {
      const answer = gitDeliveryOf(environment([job("pushed"), job("pushed", "web")]), {
        ...facts,
        preflight: {
          api: {
            repo: "api",
            remote,
            ref: "refs/heads/main",
            before: OLD,
            sha: SHA,
            verdict,
            reason: "Remote refused this release",
            checkedAt: AT,
          },
        },
      });
      expect(answer!.release).toEqual({
        allowed: false,
        reason:
          verdict === "credential"
            ? "The remote refused Mate's token, so this release can't go out. Replace the token in this production's settings, then release again."
            : "Remote refused this release",
        actions: verdict === "credential" ? ["replace-token", "cancel"] : ["cancel"],
      });
      const detail = stopVerdict({
        git: answer,
        tier: "production",
        view: {
          tone: "good",
          word: "Live",
          line: "Live",
          version: undefined,
          activatedAt: null,
          afterMs: 0,
        },
        releasing: undefined,
        failed: [],
        waiting: 3,
        waitingAtLeast: false,
        untold: [],
        release: { offered: true, tag: "v2.0.1", reason: undefined },
        releasedAge: undefined,
        since: undefined,
        atMainHead: false,
        keyGap: undefined,
      });
      expect(detail).toMatchObject({
        text: answer!.line,
        detail: answer!.release.reason,
        verb: null,
      });
    },
  );

  it.each([
    ["diverged", true],
    ["unknown", true],
    ["credential", false],
  ] as const)(
    "A Git production refused by an earlier preflight can be checked again from its review, unless the remote refused its token (%s)",
    (verdict, recheck) => {
      const refused = gitDeliveryOf(environment([job("pushed"), job("pushed", "web")]), {
        ...facts,
        preflight: {
          api: {
            repo: "api",
            remote,
            ref: "refs/heads/main",
            before: OLD,
            sha: SHA,
            verdict,
            reason: "The remote branch has commits Mate doesn't, so this release can't go out.",
            checkedAt: AT,
          },
        },
      });
      expect(refused).toMatchObject({ release: { allowed: false }, recheck });
      expect(
        gitDeliveryOf(environment([job("queued"), job("unresolved", "api", "v1.0.0", OLD)]), facts),
      ).toMatchObject({ release: { allowed: false }, recheck: false });
    },
  );

  it("A Git production whose push HQ refused as diverged can be checked again from its review, and a ready preflight after the refusal releases it", () => {
    const refused = environment([{ ...job("refused"), reason: "diverged" }, job("pushed", "web")]);
    const ready = (checkedAt: string) => ({
      api: {
        repo: "api",
        remote,
        ref: "refs/heads/main",
        before: OLD,
        sha: SHA,
        verdict: "ready" as const,
        reason: null,
        checkedAt,
      },
    });
    const blocked = {
      release: {
        allowed: false,
        reason: "The remote branch has commits Mate doesn't, so this release can't go out.",
      },
      recheck: true,
    };
    expect(gitDeliveryOf(refused, facts)).toMatchObject(blocked);
    expect(gitDeliveryOf(refused, { ...facts, preflight: ready(AT) })).toMatchObject(blocked);
    expect(
      gitDeliveryOf(refused, { ...facts, preflight: ready("2026-10-13T11:00:00.123456Z") }),
    ).toMatchObject({ release: { allowed: true, reason: undefined }, recheck: false });
  });

  it("L1e/L2c: an old token refusal cannot invalidate a verified replacement or infer its GitHub owner", () => {
    const rotated = { ...remote, keptAt: "2026-10-13T11:00:00Z", keptBy: "another-custodian" };
    const answer = gitDeliveryOf(environment([job("pushed"), job("pushed", "web")]), {
      ...facts,
      repos: repos.map((repo) => ({ ...repo, remote: rotated })),
      preflight: {
        api: {
          repo: "api",
          remote,
          ref: "refs/heads/main",
          before: OLD,
          sha: SHA,
          verdict: "credential",
          reason: "Old token refused",
          checkedAt: AT,
        },
      },
    });
    expect(answer!.release).toMatchObject({ allowed: true });
    expect(answer).not.toHaveProperty("tokenOwner");
    const oldFailure = gitDeliveryOf(environment([job("refused"), job("pushed", "web")]), {
      ...facts,
      repos: repos.map((repo) => ({ ...repo, remote: rotated })),
    });
    expect(oldFailure!.release).toMatchObject({ allowed: true, actions: ["release", "cancel"] });
  });

  it("L4a: recovery follows HQ's evidence and does not declare a credential failure", () => {
    const active = job("submitting");
    const answer = gitDeliveryOf(
      environment([
        {
          ...active,
          reason: "Rate limit; retry after 11:00",
          evidence: {
            ...active.evidence!,
            attempt: { ...active.evidence!.attempt!, phase: "recovering" },
            nextActor: "hq",
            nextAction: "Wait until 11:00",
          },
        },
      ]),
      facts,
    );
    expect(answer).toMatchObject({
      standing: "pushing",
      nextActor: "hq",
      nextAction: "Wait until 11:00",
      release: { allowed: false, actions: ["cancel"] },
    });
  });

  it("a replaced environment inherits no release standing, and an HQ outage preserves only last known hand-over", () => {
    expect(
      gitDeliveryOf(
        { ...environment([]), id: HqEnvironmentId.make("new-prod"), release: null },
        facts,
      ),
    ).toMatchObject({ standing: "not-released", pushed: 0 });
    expect(
      gitDeliveryOf(environment([job("pushed"), job("pushed", "web")]), { ...facts, live: false }),
    ).toMatchObject({
      standing: "last-known",
      line: "Last known · Pushed v2.0.0",
      release: { allowed: false },
    });
  });
});
