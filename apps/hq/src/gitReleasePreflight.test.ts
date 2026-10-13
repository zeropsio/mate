import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { HostReply } from "./gitTransport.ts";
import {
  inspectGitRelease,
  workflowProbeVerdict,
  remoteCredentialStamp,
} from "./gitReleasePreflight.ts";

const reply = (status: number, headers: Record<string, string> = {}, body = ""): HostReply => ({
  status,
  headers,
  body,
});
const sha = "b".repeat(40);
const base = "a".repeat(40);
const input = {
  appId: "app",
  repo: "api-library",
  sha,
  branch: "main",
  url: "https://github.com/shop/api-library.git",
  remote: {
    url: "https://github.com/shop/api-library.git",
    repositoryId: "17",
    keptAt: "2026-10-14T00:00:00Z",
    keptBy: "owner",
    expiresAt: null,
    invalidSince: null,
  },
  token: Redacted.make("test-token"),
  checkedAt: "2026-10-14T00:00:00Z",
};

describe("Git release preflight", () => {
  it.each([
    [422, 422, "ready"],
    [403, 422, "declined"],
    [403, 403, "unknown"],
    [401, 422, "credential"],
    [200, 422, "unknown"],
    [201, 422, "unknown"],
    [500, 422, "unknown"],
    [422, 500, "unknown"],
  ] as const)("workflow/control HTTP %s/%s is %s", (workflow, control, verdict) => {
    expect(workflowProbeVerdict(reply(workflow), reply(control)).verdict).toBe(verdict);
  });
  it.each([
    reply(429),
    reply(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791936000" }),
    reply(
      403,
      { "x-ratelimit-remaining": "50" },
      '{"message":"You have exceeded a secondary rate limit"}',
    ),
  ])("rate limits never invalidate the token or claim missing Workflows", (limited) => {
    const verdict = workflowProbeVerdict(limited, reply(422));
    expect(verdict.verdict).toBe("unknown");
    expect(verdict.credentialRefused).toBeUndefined();
    if (limited.headers["x-ratelimit-reset"])
      expect(verdict.reason).toBe(
        "The repository host asked Mate to wait until 2026-10-14T00:00:00.000Z.",
      );
  });
  it("Decision L4a: Retry-After and reset are host wait evidence, never token invalidation", () => {
    const verdict = workflowProbeVerdict(
      reply(
        403,
        { "retry-after": "60", "x-ratelimit-reset": "1791936001" },
        '{"message":"secondary rate limit"}',
      ),
      reply(422),
      1791936000000,
    );
    expect(verdict).toEqual({
      verdict: "unknown",
      rateLimited: true,
      reason: "The repository host asked Mate to wait until 2026-10-14T00:01:00.000Z.",
    });
    expect(workflowProbeVerdict(reply(403), reply(403)).credentialRefused).toBeUndefined();
  });
  it.effect.each([
    [base, true, "old", "new", "ready", 1],
    [base, true, "same", "same", "ready", 0],
    [base, false, "old", "new", "diverged", 0],
    [null, true, null, "new", "ready", 1],
    [null, true, null, null, "ready", 0],
    [base, true, "old", null, "ready", 1],
  ] as const)(
    "one branch observation %s, ancestry %s, workflows %s→%s",
    ([before, ancestor, oldTree, newTree, verdict, expectedProbes]) =>
      Effect.gen(function* () {
        let branches = 0;
        let probes = 0;
        const entry = (path: string, treeSha: string) => ({
          path,
          sha: treeSha,
          type: "tree",
          mode: "040000",
        });
        const result = yield* inspectGitRelease(
          {
            previewAdoption: () =>
              Effect.sync(() => {
                branches++;
                return { main: sha, remoteTip: before, changedFiles: 1, seed: false };
              }),
            onMain: () => Effect.succeed(ancestor),
            tree: (_repo, rev, path) => {
              const treeSha = rev === base ? oldTree : newTree;
              return Effect.succeed({
                truncated: false,
                items:
                  treeSha === null ? [] : [entry(path === "" ? ".github" : "workflows", treeSha)],
              });
            },
          },
          input,
          () =>
            Effect.sync(() => {
              probes++;
              return { verdict: "ready" as const, reason: null };
            }),
        );
        expect(result).toMatchObject({
          repo: "api-library",
          remote: { url: input.url, repositoryId: "17" },
          ref: "refs/heads/main",
          before,
          sha,
          verdict,
        });
        expect(branches).toBe(1);
        expect(probes).toBe(expectedProbes);
      }),
  );
  it.effect("incomplete trees cannot prove that a release leaves workflows unchanged", () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        inspectGitRelease(
          {
            previewAdoption: () =>
              Effect.succeed({ main: sha, remoteTip: base, changedFiles: 0, seed: false }),
            onMain: () => Effect.succeed(true),
            tree: () => Effect.succeed({ items: [], truncated: true }),
          },
          input,
          () => Effect.succeed({ verdict: "ready", reason: null }),
        ),
      );
      expect(result).toBe("incomplete");
    }),
  );
});

it("credential timestamps preserve microseconds across PostgreSQL timezones", () => {
  expect(remoteCredentialStamp("2026-10-14 02:00:00.123456+02")).toBe(
    "2026-10-14T00:00:00.123456Z",
  );
  expect(remoteCredentialStamp("2026-10-14 00:00:00+00")).toBe("2026-10-14T00:00:00.000000Z");
});
