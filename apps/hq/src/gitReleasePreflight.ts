/** Git release evidence, read before tagging: one branch observation and its workflow tree diff. */
import type { HqGit } from "@t3tools/hq-git";
import type { HqGitReleasePreflight } from "@t3tools/shared/hqRelease";
import * as ByteSize from "effect/ByteSize";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { GitHost } from "./gitHost.ts";
import { type HostReply, remoteIdentity } from "./gitTransport.ts";
import { Remotes, type RemoteError } from "./repoRemotes.ts";

/** PostgreSQL offsets and fractional precision must not manufacture a credential rotation. */
export const remoteCredentialStamp = (value: string) => {
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/u, "$1:00");
  const fraction = iso.match(/\.(\d+)/u)?.[1] ?? "";
  return DateTime.formatIso(DateTime.makeUnsafe(iso)).replace(
    /\.\d{3}Z$/u,
    `.${fraction.padEnd(6, "0")}Z`,
  );
};

export interface WorkflowVerdict {
  readonly verdict: HqGitReleasePreflight["verdict"];
  readonly reason: string | null;
  readonly credentialRefused?: boolean;
  readonly rateLimited?: boolean;
}
/** Endpoint requirements are help, never a list of this token's grants. */
export const workflowProbeVerdict = (
  workflow: HostReply,
  control: HostReply,
  now = 0,
): WorkflowVerdict => {
  for (const reply of [workflow, control]) {
    if (
      reply.status === 429 ||
      (reply.status === 403 &&
        (reply.headers["x-ratelimit-remaining"] === "0" ||
          /(?:api|secondary) rate limit|abuse detection/iu.test(reply.body)))
    ) {
      const reset = reply.headers["x-ratelimit-reset"];
      const resetMs = reset && /^\d+$/u.test(reset) ? Number(reset) * 1000 : NaN;
      const retry = reply.headers["retry-after"];
      const retryAt =
        retry === undefined
          ? NaN
          : /^\d+(?:\.\d+)?$/u.test(retry)
            ? now + Number(retry) * 1000
            : (Option.getOrUndefined(Option.map(DateTime.make(retry), DateTime.toEpochMillis)) ??
              NaN);
      const reported = [resetMs, retryAt].filter(
        (value) => Number.isFinite(value) && Math.abs(value) <= 8.64e15,
      );
      return {
        verdict: "unknown",
        rateLimited: true,
        reason:
          reported.length > 0
            ? `The repository host asked Mate to wait until ${DateTime.formatIso(DateTime.makeUnsafe(Math.max(...reported)))}.`
            : "The repository host asked Mate to wait.",
      };
    }
  }
  if (workflow.status === 401 || control.status === 401)
    return {
      verdict: "credential",
      reason: "The repository host rejected this token. Replace the token.",
      credentialRefused: true,
    };
  if (workflow.status === 422 && control.status === 422) return { verdict: "ready", reason: null };
  if (workflow.status === 403 && control.status === 422)
    return {
      verdict: "declined",
      reason:
        "This release changes .github/workflows and the token can't write there: Workflows: Read and write is needed.",
    };
  return {
    verdict: "unknown",
    reason: `Mate couldn't verify Workflows: Read and write (HTTP ${workflow.status}/${control.status}).`,
  };
};

type ReleaseGit = Pick<HqGit, "previewAdoption" | "onMain" | "tree">;
interface PreflightInput {
  readonly appId: string;
  readonly repo: string;
  readonly sha: string;
  readonly branch: string;
  readonly url: string;
  readonly remote: HqGitReleasePreflight["remote"];
  readonly token: Redacted.Redacted;
  readonly checkedAt: string;
}
/** The Git adapter reads/fetches the ref once; comparing tree ids includes nested paths and deletions. */
export const inspectGitRelease = <E, R>(
  git: ReleaseGit,
  input: PreflightInput,
  probe: () => Effect.Effect<WorkflowVerdict, E, R>,
) =>
  Effect.gen(function* () {
    const repo = { appId: input.appId, id: input.repo };
    const observed = yield* git.previewAdoption(repo, {
      url: input.url,
      branch: input.branch,
      token: input.token,
    });
    const evidence = {
      repo: input.repo,
      remote: input.remote,
      ref: `refs/heads/${input.branch}`,
      before: observed.remoteTip,
      sha: input.sha,
      checkedAt: input.checkedAt,
    };
    if (observed.main !== input.sha)
      return {
        ...evidence,
        verdict: "unknown" as const,
        reason: "HQ main moved. Review the release again.",
      };
    if (observed.remoteTip !== null && !(yield* git.onMain(repo, observed.remoteTip)))
      return {
        ...evidence,
        verdict: "diverged" as const,
        reason:
          "The remote branch has commits Mate doesn't, so this release can't go out. Remove them from the branch or bring them into main, then review the release again.",
      };
    const workflows = (sha: string | null) =>
      sha === null
        ? Effect.succeed(null)
        : Effect.gen(function* () {
            const root = yield* git.tree(repo, sha, "");
            if (root.truncated) return yield* Effect.fail("incomplete" as const);
            const directory = root.items.find((entry) => entry.path === ".github");
            if (directory === undefined) return null;
            if (directory.type !== "tree") return yield* Effect.fail("incomplete" as const);
            const tree = yield* git.tree(repo, sha, ".github");
            if (tree.truncated) return yield* Effect.fail("incomplete" as const);
            return tree.items.find((entry) => entry.path === "workflows") ?? null;
          });
    const before = yield* workflows(observed.remoteTip);
    const after = yield* workflows(input.sha);
    const changed =
      before?.sha !== after?.sha || before?.mode !== after?.mode || before?.type !== after?.type;
    const verdict =
      remoteIdentity(input.url)?.kind === "github" && changed
        ? yield* probe()
        : { verdict: "ready" as const, reason: null };
    return { ...evidence, verdict: verdict.verdict, reason: verdict.reason };
  });

export class GitReleasePreflight extends Context.Service<
  GitReleasePreflight,
  {
    readonly check: (
      appId: string,
      repo: string,
      sha: string,
      branch: string,
    ) => Effect.Effect<HqGitReleasePreflight, RemoteError>;
  }
>()("@t3tools/hq/gitReleasePreflight") {}

export const gitReleasePreflightLayer = Layer.effect(
  GitReleasePreflight,
  Effect.gen(function* () {
    const host = yield* GitHost;
    const remotes = yield* Remotes;
    const client = yield* HttpClient.HttpClient;
    return GitReleasePreflight.of({
      check: (appId, repo, sha, branch) =>
        Effect.gen(function* () {
          const use = yield* remotes.forUse({ appId, repo }, branch);
          const now = yield* Clock.currentTimeMillis;
          const evidenceRemote = {
            url: use.remote.url,
            repositoryId: use.remote.hostRepoId,
            keptAt: remoteCredentialStamp(use.remote.keptAt!),
            keptBy: use.remote.keptBy!,
            expiresAt: use.remote.expiresAt,
            invalidSince: use.remote.invalidSince,
          };
          const remote = remoteIdentity(use.remote.url);
          const request = (path: string) =>
            Effect.scoped(
              Effect.gen(function* () {
                const origin =
                  remote?.host === "github.com"
                    ? "https://api.github.com"
                    : `https://${remote?.host}/api/v3`;
                const response = yield* client.execute(
                  HttpClientRequest.put(`${origin}/repos/${remote?.path}/contents/${path}`).pipe(
                    HttpClientRequest.bearerToken(use.token),
                    HttpClientRequest.setHeader("user-agent", "Zerops-Mate"),
                    HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
                    HttpClientRequest.setHeader("x-github-api-version", "2022-11-28"),
                    HttpClientRequest.bodyText("{}", "application/json"),
                  ),
                );
                return {
                  status: response.status,
                  headers: response.headers,
                  body: yield* response.text,
                };
              }).pipe(
                Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
                Effect.timeout("10 seconds"),
              ),
            );
          const probe = () =>
            Effect.gen(function* () {
              const workflow = yield* request(".github/workflows/mate-probe.yml");
              const first = workflowProbeVerdict(
                workflow,
                { status: 422, headers: {}, body: "" },
                now,
              );
              const verdict =
                first.rateLimited || first.credentialRefused
                  ? first
                  : workflowProbeVerdict(workflow, yield* request("mate-probe.txt"), now);
              if (verdict.credentialRefused && use.remote.keptAt !== null)
                yield* remotes.invalidate({ appId, repo }, use.remote.keptAt);
              return verdict;
            });
          const git = yield* host.git;
          return yield* inspectGitRelease(
            git,
            {
              appId,
              repo,
              sha,
              branch,
              url: use.remote.url,
              remote: evidenceRemote,
              token: use.token,
              checkedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
            },
            probe,
          ).pipe(
            Effect.catch(() =>
              Effect.succeed({
                repo,
                sha,
                remote: evidenceRemote,
                ref: `refs/heads/${branch}`,
                before: null,
                checkedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
                verdict: "unknown" as const,
                reason: "Mate couldn't verify this release against the remote branch.",
              }),
            ),
          );
        }),
    });
  }),
);
