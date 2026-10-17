import * as Schema from "effect/Schema";
import { HqGitProbeRefusalReason } from "@t3tools/shared/hqGitTargets";
// @effect-diagnostics nodeBuiltinImport:off -- local HTTP/Git-discovery host.
import * as NodeHttp from "node:http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { GithubProbes, ProbeRefused, githubProbesLayer } from "./githubProbes.ts";
import {
  GitTransport,
  gitTransportLayer,
  type HostReply,
  HostUnreachable,
  remoteIdentity,
} from "./gitTransport.ts";

type Reply = { status?: number; headers?: Record<string, string>; body: unknown };
const metadata = {
  id: 42,
  full_name: "owner/repo",
  archived: false,
  private: true,
  permissions: { admin: true },
};
const planRestriction =
  "Upgrade to GitHub Pro or make this repository public to enable this feature.";
const advertisement = "001f# service=git-receive-pack\n00000000";
const host = (replies: ReadonlyArray<Reply>) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ server: NodeHttp.Server; origin: string; seen: string[] }>((resolve) => {
          const seen: string[] = [];
          const server = NodeHttp.createServer((request, response) => {
            seen.push(`${request.method} ${request.url}`);
            const git = request.url?.includes("info/refs");
            const expectedAuth = git
              ? `Basic ${Buffer.from("x-access-token:probe-test-secret").toString("base64")}`
              : "Bearer probe-test-secret";
            if (
              request.headers.authorization !== expectedAuth ||
              (git && !request.url?.endsWith("?service=git-receive-pack"))
            ) {
              response.writeHead(400);
              response.end("{}");
              return;
            }
            const reply = replies[seen.length - 1] ?? { status: 500, body: {} };
            response.writeHead(
              reply.status ?? 200,
              reply.headers ?? { "content-type": "application/json" },
            );
            response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
          }).listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address !== "string")
              resolve({ server, origin: `http://127.0.0.1:${address.port}`, seen });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
const discovery = {
  headers: { "content-type": "application/x-git-receive-pack-advertisement" },
  body: advertisement,
};
const run = <A, E>(replies: ReadonlyArray<Reply>, use: Effect.Effect<A, E, GithubProbes>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* host(replies);
      const client = Layer.effect(
        HttpClient.HttpClient,
        Effect.map(
          HttpClient.HttpClient,
          HttpClient.mapRequest((request) =>
            HttpClientRequest.setUrl(
              request,
              fake.origin + new URL(request.url).pathname + new URL(request.url).search,
            ),
          ),
        ),
      ).pipe(Layer.provide(NodeHttpClient.layerNodeHttp));
      const result = yield* use.pipe(
        Effect.provide(
          githubProbesLayer.pipe(Layer.provide(gitTransportLayer), Layer.provide(client)),
        ),
      );
      assert.strictEqual(
        fake.seen.every((entry) => entry.startsWith("GET ")),
        true,
      );
      return result;
    }),
  );
const verify = Effect.flatMap(GithubProbes, (probes) =>
  probes.verify(
    remoteIdentity("https://github.com/owner/repo")!,
    Redacted.make("probe-test-secret"),
    "main",
  ),
);

describe("observed GitHub capabilities", () => {
  it.effect(
    "A verified push carries repository identity and says Expiry not reported when the header is absent.",
    () =>
      run(
        [{ body: metadata }, discovery, { body: [] }],
        Effect.gen(function* () {
          const result = yield* verify;
          assert.strictEqual(result.hostRepoId, "42");
          assert.strictEqual(result.expiresAt, null);
          assert.strictEqual(result.expiryLabel, "Expiry not reported");
          assert.strictEqual(result.mergeSettings, false);
          assert.notInclude(JSON.stringify(result), "probe-test-secret");
        }),
      ),
  );
  it.effect(
    "Other hosts prove write through receive-pack and retain URL identity without a GitHub rename promise.",
    () =>
      run(
        [discovery],
        Effect.gen(function* () {
          const probes = yield* GithubProbes;
          const result = yield* probes.verify(
            remoteIdentity("https://gitlab.example/Group/Repo")!,
            Redacted.make("probe-test-secret"),
            "main",
          );
          assert.strictEqual(result.hostRepoId, null);
          assert.strictEqual(result.remote.key, "gitlab.example/Group/Repo");
          assert.strictEqual(result.expiryLabel, "Expiry not reported");
        }),
      ),
  );
  it.effect(
    "A branch that takes only pull requests steers its direct production to pull requests.",
    () =>
      run(
        [
          { body: metadata },
          discovery,
          {
            body: [
              {
                type: "pull_request",
                ruleset_id: 1,
                ruleset_source_type: "Repository",
                ruleset_source: "owner/repo",
              },
            ],
          },
        ],
        Effect.gen(function* () {
          const refusal = yield* verify.pipe(Effect.flip);
          assert.strictEqual(refusal.reason, "pull_requests_only");
          assert.strictEqual(
            refusal.message,
            "main takes changes only through pull requests. Choose Open a pull request.",
          );
          assert.strictEqual(refusal.tokenState, "valid");
        }),
      ),
  );
  it.effect(
    "Merge settings and token expiration are observed rather than inferred from admin role.",
    () =>
      run(
        [
          {
            body: { ...metadata, allow_merge_commit: true },
            headers: { "github-authentication-token-expiration": "2026-11-12 10:02:32 UTC" },
          },
          discovery,
          { body: [] },
        ],
        Effect.gen(function* () {
          const result = yield* verify;
          assert.strictEqual(result.mergeSettings, true);
          assert.strictEqual(result.expiresAt, "2026-11-12T10:02:32.000Z");
        }),
      ),
  );
  it.effect.each([
    [
      "No branch rules on a private repository's GitHub Free plan allow production.",
      { status: 403, body: { message: planRestriction } },
      "none_on_plan",
    ],
    ["A chosen branch is checked for active rules before production.", { body: [] }, undefined],
  ] as const)("%s", ([, rules, expected]) =>
    run(
      [{ body: metadata }, discovery, rules],
      Effect.gen(function* () {
        const outcome = yield* verify.pipe(Effect.option);
        assert.strictEqual(Option.isSome(outcome), true, "The branch rules check succeeds.");
        const result = Option.getOrThrow(outcome);
        assert.strictEqual(result.branchRules, expected);
      }),
    ),
  );
  it.effect.each([undefined, ""] as const)(
    "A token test without a chosen branch proves repository push access without reading branch rules: %s.",
    (branch) =>
      run(
        [{ body: metadata }, discovery],
        Effect.gen(function* () {
          const probes = yield* GithubProbes;
          const result = yield* probes.verify(
            remoteIdentity("https://github.com/owner/repo")!,
            Redacted.make("probe-test-secret"),
            branch,
          );
          assert.strictEqual(result.hostRepoId, "42");
          assert.strictEqual(result.branchRules, undefined);
        }),
      ),
  );
  it.effect.each([
    [
      "permission refusal",
      { body: { message: "Resource not accessible by personal access token" } },
      "could_not_verify",
    ],
    ["incomplete plan message", { body: { message: "Upgrade to GitHub Pro" } }, "could_not_verify"],
    [
      "rate exhaustion on a plan response",
      { headers: { "x-ratelimit-remaining": "0" }, body: { message: planRestriction } },
      "rate_limited",
    ],
    [
      "SSO on a plan response",
      { headers: { "x-github-sso": "required" }, body: { message: planRestriction } },
      "sso",
    ],
  ] as const)(
    "A branch rules refusal remains unverified or names its actual blocker: %s.",
    ([, reply, reason]) =>
      run(
        [{ body: metadata }, discovery, { status: 403, ...reply }],
        Effect.gen(function* () {
          const refusal = yield* verify.pipe(Effect.flip);
          assert.strictEqual(refusal.reason, reason);
          assert.strictEqual(refusal.tokenState, "valid");
        }),
      ),
  );
  const failures: ReadonlyArray<[string, ReadonlyArray<Reply>, string, string]> = [
    [
      "Contents read with no merge fields",
      [{ body: metadata }, { status: 403, body: "Write access to repository not granted." }],
      "push_not_granted",
      "valid",
    ],
    [
      "private 404",
      [
        { status: 404, body: { message: "Not Found" } },
        { status: 404, body: "Not Found" },
      ],
      "not_visible",
      "unknown",
    ],
    ["archived metadata", [{ body: { ...metadata, archived: true } }], "archived", "valid"],
    ["401", [{ status: 401, body: { message: "Bad credentials" } }], "token_invalid", "invalid"],
    [
      "classic scope",
      [{ body: metadata, headers: { "x-oauth-scopes": "read:user" } }],
      "classic_scope",
      "valid",
    ],
    [
      "malformed metadata",
      [{ body: { permissions: { admin: true } } }],
      "could_not_verify",
      "unknown",
    ],
    [
      "truncated advertisement",
      [{ body: metadata }, { ...discovery, body: advertisement + "garbage" }],
      "could_not_verify",
      "valid",
    ],
    [
      "HTML discovery",
      [{ body: metadata }, { body: "<html>login</html>" }],
      "could_not_verify",
      "valid",
    ],
    [
      "unknown rules",
      [{ body: metadata }, discovery, { body: { rules: [] } }],
      "could_not_verify",
      "valid",
    ],
    [
      "unknown ruleset rule",
      [{ body: metadata }, discovery, { body: [{ arbitrary: true }] }],
      "could_not_verify",
      "valid",
    ],
    [
      "discovery redirect",
      [
        { body: metadata },
        { status: 301, headers: { location: "https://evil.example" }, body: "" },
      ],
      "could_not_verify",
      "valid",
    ],
  ];
  it.effect.each(failures)(
    "Unknown or refused host evidence cannot grant a connection: %s.",
    ([, replies, reason, tokenState]) =>
      run(
        replies,
        Effect.gen(function* () {
          const refusal = yield* verify.pipe(Effect.flip);
          assert.strictEqual(refusal.reason, reason);
          assert.strictEqual(refusal.tokenState, tokenState);
          assert.notInclude(JSON.stringify(refusal), "probe-test-secret");
        }),
      ),
  );
  it.effect("SSO refusal reports only the host's safe authorization link.", () =>
    run(
      [
        {
          status: 403,
          headers: {
            "x-github-sso":
              "required; url=https://github.com/orgs/owner/sso?authorization_request=abc",
          },
          body: {},
        },
      ],
      Effect.gen(function* () {
        const refusal = yield* verify.pipe(Effect.flip);
        assert.strictEqual(refusal.reason, "sso");
        assert.strictEqual(
          refusal.ssoUrl,
          "https://github.com/orgs/owner/sso?authorization_request=abc",
        );
      }),
    ),
  );
  it.effect.each([
    [
      "primary headers",
      403,
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791806400" },
      { message: "API rate limit exceeded" },
    ],
    [
      "secondary body",
      403,
      { "retry-after": "25" },
      { message: "You have exceeded a secondary rate limit." },
    ],
    ["429", 429, { "retry-after": "25" }, {}],
  ] as const)(
    "Rate evidence preserves the token and exposes the host wait: %s.",
    ([, status, headers, body]) =>
      run(
        [{ body: metadata }, discovery, { status, headers, body }],
        Effect.gen(function* () {
          const refusal = yield* verify.pipe(Effect.flip);
          assert.strictEqual(refusal.reason, "rate_limited");
          assert.strictEqual(refusal.tokenState, "valid");
          if ("retry-after" in headers) assert.strictEqual(refusal.retryAfterMs, 25_000);
          else assert.strictEqual(refusal.resetAt, "2026-10-12T12:00:00.000Z");
        }),
      ),
  );
});

describe("token refusal guidance", () => {
  const cases = {
    token_invalid:
      "GitHub rejected this token (expired, revoked or mistyped). Create a replacement in GitHub token settings.",
    rate_limited: "The repository host asked Mate to wait.",
    sso: "This token needs the organization's SSO authorization. Authorize it in the organization's GitHub SSO settings.",
    archived:
      "owner/repo is archived, so nothing can be pushed to it. Unarchive it in repository settings before testing again.",
    push_not_granted:
      "This token can't push to owner/repo: under Repository access choose Only select repositories → owner/repo with Contents: Read and write. If owner approves tokens, it may still be pending.",
    not_visible:
      "owner/repo doesn't exist, or your account can't see it. Check the repository address and this token's repository access in GitHub token settings.",
    classic_scope:
      "This is a classic token without repo. Create a fine-grained token with the link above, or add repo in GitHub token settings.",
    pull_requests_only:
      "main takes changes only through pull requests. Choose Open a pull request.",
    unreachable:
      "The repository host could not be reached in time. Check the connection, then test this token again.",
    could_not_verify:
      "Mate couldn't verify access to owner/repo. Check the repository address and this token's repository access in GitHub token settings, then test again.",
  } satisfies Record<HqGitProbeRefusalReason, string>;
  const isReason = Schema.is(HqGitProbeRefusalReason);
  it.each(Object.entries(cases))(
    "A refused token test gives a concrete next action without a raw reason code: %s.",
    (reason, expected) => {
      assert.isTrue(isReason(reason));
      if (!isReason(reason)) throw new Error("Unknown probe reason");
      const refusal = new ProbeRefused({
        reason,
        hostKind: "github",
        remote: "owner/repo",
        branch: "main",
        tokenState: "unknown",
        scope: "repo",
      });
      assert.strictEqual(refusal.message, expected);
    },
  );
});

describe("the token test's CI rows", () => {
  const replies: Record<string, HostReply | "unreachable"> = {
    "/commits/mate%2Fstage/check-runs?per_page=1": { status: 200, headers: {}, body: "{}" },
    "/commits/mate%2Fstage/status?per_page=1": {
      status: 403,
      headers: {},
      body: JSON.stringify({ message: "Resource not accessible by personal access token" }),
    },
    "/actions/runs?per_page=1&branch=mate%2Fstage": {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
      body: JSON.stringify({ message: "API rate limit exceeded" }),
    },
  };
  const transport = (answers: Record<string, HostReply | "unreachable">) =>
    Layer.succeed(
      GitTransport,
      GitTransport.of({
        metadata: () => Effect.die("not a CI read"),
        receivePack: () => Effect.die("not a CI read"),
        rules: () => Effect.die("not a CI read"),
        read: (_remote, path) => {
          const answer = answers[path] ?? { status: 409, headers: {}, body: "{}" };
          return answer === "unreachable"
            ? Effect.fail(new HostUnreachable({}))
            : Effect.succeed(answer);
        },
      }),
    );
  const ciAccess = (answers: Record<string, HostReply | "unreachable">) =>
    Effect.flatMap(GithubProbes, (probes) =>
      probes.ciAccess(
        remoteIdentity("https://github.com/owner/repo")!,
        Redacted.make("probe-test-secret"),
        "mate/stage",
      ),
    ).pipe(Effect.provide(githubProbesLayer.pipe(Layer.provide(transport(answers)))));

  it.effect(
    "The token test says which CI reads the token has on the chosen branch; a refused one is missing, anything else unknown.",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* ciAccess(replies), {
          checks: "granted",
          statuses: "missing",
          actions: "unknown",
        });
        // A branch not pushed yet is found missing only after GitHub checked the permission.
        assert.deepStrictEqual(
          yield* ciAccess({
            "/commits/mate%2Fstage/check-runs?per_page=1": {
              status: 422,
              headers: {},
              body: JSON.stringify({ message: "No commit found for SHA: mate/stage" }),
            },
            "/commits/mate%2Fstage/status?per_page=1": {
              status: 404,
              headers: {},
              body: JSON.stringify({ message: "Ref not found" }),
            },
            "/actions/runs?per_page=1&branch=mate%2Fstage": {
              status: 200,
              headers: {},
              body: JSON.stringify({ total_count: 0, workflow_runs: [] }),
            },
          }),
          { checks: "granted", statuses: "granted", actions: "granted" },
        );
        // A host that did not answer, or a repository it does not show, proves nothing.
        assert.deepStrictEqual(
          yield* ciAccess({
            "/commits/mate%2Fstage/check-runs?per_page=1": "unreachable",
            "/commits/mate%2Fstage/status?per_page=1": { status: 404, headers: {}, body: "{}" },
          }),
          { checks: "unknown", statuses: "unknown", actions: "unknown" },
        );
      }),
  );
});
