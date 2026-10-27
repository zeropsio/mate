import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Queue from "effect/Queue";
import { HqEnvironmentId } from "@t3tools/contracts";
import { HqGitTargetIntent, HqGitOperationReceipt } from "@t3tools/shared/hqGitTargets";
import { gitTargetWrite, gitTargetReceipt } from "./gitTargetsApi.ts";
import { Remotes } from "./repoRemotes.ts";
import { Structure } from "./structure.ts";
import { Releases } from "./releases.ts";
import { GitHost, type PushedChange } from "./gitHost.ts";
import { Deploys } from "./deploys.ts";
const scope = { orgId: "org", appId: "app", hqProjectId: "hq" };
const repo = { ...scope, repo: "web" };
const url = "https://github.com/krls2020/tst123";
const target = { kind: "git", branch: "main", delivery: "direct" } as const;
const decodeIntent = Schema.decodeUnknownSync(HqGitTargetIntent);
const decodeReceipt = Schema.decodeUnknownSync(HqGitOperationReceipt);
const adoption = [
  {
    repo: "web",
    branch: "main",
    mainHead: "a".repeat(40),
    remoteHead: null,
    changedFiles: 0,
    seed: true,
    remote: { url, repositoryId: "123" },
  },
];
const intents: ReadonlyArray<HqGitTargetIntent> = [
  { kind: "probe-git-remote", ...repo, url, branch: "selected" },
  { kind: "connect-git-remote", ...repo, url },
  { kind: "replace-git-remote-token", ...repo },
  { kind: "update-git-remote-address", ...repo, url },
  { kind: "disconnect-git-remote", ...repo },
  { kind: "preview-git-environment", ...scope, request: { target } },
  {
    kind: "add-git-environment",
    ...scope,
    request: { target, tier: "stage", name: "stage", adoption },
  },
  {
    kind: "remove-git-environment",
    ...scope,
    environmentId: HqEnvironmentId.make("git-env"),
    loseUnresolvedHistory: true,
  },
  { kind: "preflight-git-release", ...scope },
  { kind: "run-git-again", ...repo, environmentId: HqEnvironmentId.make("git-env") },
];
describe("Git target transport", () => {
  it.effect.each(intents)(
    "$kind delegates request identity and recovery to the existing owner",
    (intent) =>
      Effect.gen(function* () {
        const accepted: HqGitOperationReceipt = {
          requestId: "original",
          operationId: "original",
          executor: "hq",
          affected: [{ family: "hqAppDetail", id: "app" }],
          handles: [],
          acceptance: { kind: "accepted" },
          outcome: { kind: "succeeded", evidence: "original" },
        };
        const seen: Array<{
          owner: string;
          user: string;
          requestId: string;
          intent: HqGitTargetIntent;
          candidate?: Redacted.Redacted | undefined;
        }> = [];
        const write =
          (owner: string) =>
          (
            user: string,
            requestId: string,
            value: HqGitTargetIntent,
            candidate?: Redacted.Redacted,
          ) =>
            Effect.sync(() => {
              seen.push({ owner, user, requestId, intent: value, candidate });
              return accepted;
            });
        const receipt =
          (owner: string) => (user: string, requestId: string, value: HqGitTargetIntent) =>
            Effect.sync(() => {
              seen.push({ owner, user, requestId, intent: value });
              return accepted;
            });
        const layer = Layer.mergeAll(
          Layer.mock(GitHost)({ pushes: yield* Queue.unbounded<PushedChange>() }),
          Layer.mock(Remotes)({ write: write("remotes"), receipt: receipt("remotes") }),
          Layer.mock(Structure)({
            gitTargetWrite: write("structure"),
            gitTargetReceipt: receipt("structure"),
          }),
          Layer.mock(Releases)({ gitReview: write("releases"), gitReceipt: receipt("releases") }),
          Layer.mock(Deploys)({ runGitAgain: write("deploys"), gitReceipt: receipt("deploys") }),
        );
        assert.deepStrictEqual(
          yield* gitTargetWrite(
            "person",
            "original",
            intent,
            Redacted.make("candidate-marker"),
          ).pipe(Effect.provide(layer)),
          accepted,
        );
        assert.deepStrictEqual(
          yield* gitTargetReceipt("person", "original", intent).pipe(Effect.provide(layer)),
          accepted,
        );
        const owner =
          intent.kind === "preflight-git-release"
            ? "releases"
            : intent.kind === "run-git-again"
              ? "deploys"
              : intent.kind.includes("environment")
                ? "structure"
                : "remotes";
        assert.deepStrictEqual(
          seen.map(({ owner: called, user, requestId, intent: value }) => ({
            called,
            user,
            requestId,
            value,
          })),
          Array.from({ length: 2 }, () => ({
            called: owner,
            user: "person",
            requestId: "original",
            value: intent,
          })),
        );
        assert.strictEqual(seen[1]!.candidate, undefined);
        if (owner !== "remotes") assert.strictEqual(seen[0]!.candidate, undefined);
      }),
  );
  it("Decoded intents and receipts exclude plaintext and sealed credential fields", () => {
    const marker = "TOKEN_MARKER_NEVER_SERIALIZED";
    const intent = decodeIntent({
      ...intents[0],
      token: marker,
      sealed: marker,
    });
    const receipt = decodeReceipt({
      requestId: "original",
      operationId: "original",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: {
        kind: "accepted",
        result: {
          ok: true,
          remote: {
            url,
            repositoryId: "123",
            expiresAt: null,
            invalidSince: null,
            sealed: marker,
            token: marker,
          },
        },
      },
      outcome: { kind: "succeeded", evidence: "original" },
      token: marker,
    });
    assert.notInclude(JSON.stringify({ intent, receipt }), marker);
  });
});
