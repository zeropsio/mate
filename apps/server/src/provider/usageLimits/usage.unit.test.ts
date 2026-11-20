import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ClaudeResetCredits from "../Layers/claudeResetCredits.ts";
import {
  claudeRateLimitEventToUpdate,
  claudeUsageResponseToLimits,
} from "../Layers/claudeUsageLimits.ts";
import {
  codexRateLimitsToLimits,
  codexRateLimitsToUpdate,
  codexUsageLimitBlock,
} from "../Layers/codexUsageLimits.ts";
import * as ResetCreditCoordinator from "../Layers/resetCreditCoordinator.ts";
import { applyUsageLimitsUpdate, resolveUsageLimitsAfterProbe } from "../providerUsageLimits.ts";
import { makeCliproxyApi } from "../../usage/cliproxyApi.ts";

const session = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;
const weekly = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 20,
  windowDurationMins: 10_080,
} as const;

// witness: apps/server/src/provider/providerUsageLimits.ts | if (probed?.unavailable?.reason === "probeFailed" && published && !published.unavailable) { → if (probed?.unavailable?.reason === "unsupported" && published && !published.unavailable) {
it("US1: A usage probe that fails keeps the windows a provider last published, and one that answers unsupported replaces them", () => {
  const checkedAt = "2026-09-03T12:00:00.000Z";
  const published = { checkedAt, windows: [session, weekly] };
  const failed = { checkedAt, windows: [], unavailable: { reason: "probeFailed" as const } };
  const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
  expect(resolveUsageLimitsAfterProbe({ published, probed: failed })).toBe(published);
  expect(resolveUsageLimitsAfterProbe({ published, probed: unsupported })).toBe(unsupported);
  expect(resolveUsageLimitsAfterProbe({ published: undefined, probed: failed })).toBe(failed);
});

// witness: apps/server/src/provider/providerUsageLimits.ts | if (update.windows.length === 0 || previous?.unavailable?.reason === "unsupported") { → if (update.windows.length === 0) {
it("US2: A streamed usage update never gives windows to an account its provider answered unsupported", () => {
  const checkedAt = "2026-09-03T12:00:00.000Z";
  const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
  expect(
    applyUsageLimitsUpdate({ previous: unsupported, checkedAt, update: { windows: [session] } }),
  ).toBe(unsupported);
});

// witness: apps/server/src/provider/Layers/claudeUsageLimits.ts | if (typeof entry.utilization !== "number") continue; → if (entry.utilization === undefined) continue;
it("US3: Claude's usage read shows the session, the weekly and each model-scoped weekly window that reports a utilization, at most 100 percent, and no row for a window that reports none", () => {
  const checkedAt = "2026-07-18T10:00:00.000Z";
  expect(
    claudeUsageResponseToLimits({
      checkedAt,
      response: {
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 54, resets_at: "2026-07-18T14:39:00Z" },
          seven_day: { utilization: 18.4, resets_at: "2026-07-24T08:59:00+00:00" },
          seven_day_opus: { utilization: 3, resets_at: null },
          // The pinned SDK typings do not know `model_scoped` yet.
          ...({
            model_scoped: [
              { display_name: "Fable", utilization: 73, resets_at: "2026-07-24T08:59:00Z" },
              { display_name: "Ghost", utilization: null, resets_at: null },
            ],
          } as object),
          extra_usage: {
            is_enabled: false,
            monthly_limit: null,
            used_credits: null,
            utilization: null,
          },
        },
      },
    }),
  ).toEqual({
    names: { overageIncluded: "Fable" },
    limits: {
      checkedAt,
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 54,
          windowDurationMins: 300,
          resetsAt: "2026-07-18T14:39:00.000Z",
        },
        {
          id: "seven_day",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 18.4,
          windowDurationMins: 10080,
          resetsAt: "2026-07-24T08:59:00.000Z",
        },
        {
          id: "seven_day_fable",
          kind: "weekly",
          label: "Weekly · Fable",
          usedPercent: 73,
          windowDurationMins: 10080,
          resetsAt: "2026-07-24T08:59:00.000Z",
        },
      ],
    },
  });
  expect(
    claudeUsageResponseToLimits({
      checkedAt,
      response: {
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: null, resets_at: null },
          seven_day: { utilization: 250, resets_at: null },
        },
      },
    }).limits.windows,
  ).toEqual([
    {
      id: "seven_day",
      kind: "weekly",
      label: "Weekly",
      usedPercent: 100,
      windowDurationMins: 10080,
    },
  ]);
});

// witness: apps/server/src/provider/Layers/claudeUsageLimits.ts | if (type === OVERAGE_INCLUDED_EVENT_TYPE && names.overageIncluded) { → if (type !== OVERAGE_INCLUDED_EVENT_TYPE && names.overageIncluded) {
it("US4: A streamed Claude event for the overage-included bucket opens no row before a usage read named that bucket, and lands on the named model's row after", () => {
  const event = {
    status: "allowed",
    rateLimitType: "seven_day_overage_included" as never,
    utilization: 0.4,
  } as const;
  expect(claudeRateLimitEventToUpdate(event, { overageIncluded: undefined })).toBeUndefined();
  expect(claudeRateLimitEventToUpdate(event, { overageIncluded: "Fable" })).toEqual({
    windows: [
      {
        id: "seven_day_fable",
        kind: "weekly",
        label: "Weekly · Fable",
        usedPercent: 40,
        windowDurationMins: 10080,
      },
    ],
  });
});

// witness: apps/server/src/provider/Layers/codexUsageLimits.ts | if (snapshot.limitId && snapshot.limitId !== "codex") return []; → if (snapshot.limitId === "spark") return [];
it("US5: Codex usage shows only the main allowance: a Spark or other model-specific bucket, in a read or a notification, never fills or replaces its rows", () => {
  const checkedAt = "2026-07-18T10:00:00.000Z";
  const mainWeekly = {
    id: "secondary",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 42,
    windowDurationMins: 10080,
  };
  const spark = {
    limitId: "codex_bengalfox",
    primary: { usedPercent: 0, windowDurationMins: 300 },
    secondary: { usedPercent: 90, windowDurationMins: 10080 },
  };
  expect(
    codexRateLimitsToLimits({
      checkedAt,
      snapshot: spark,
      rateLimitsByLimitId: {
        codex_bengalfox: spark,
        codex: { secondary: { usedPercent: 42, windowDurationMins: 10080 } },
      },
    }).windows,
  ).toEqual([mainWeekly]);
  expect(
    codexRateLimitsToLimits({
      checkedAt,
      snapshot: { limitId: "codex_bengalfox", secondary: { usedPercent: 90 } },
    }).windows,
  ).toEqual([]);
  expect(codexRateLimitsToUpdate(spark)).toBeUndefined();
  expect(
    codexRateLimitsToUpdate({
      limitId: "codex",
      secondary: { usedPercent: 42, windowDurationMins: 10080 },
    })?.windows,
  ).toEqual([mainWeekly]);
});

// witness: apps/server/src/provider/Layers/codexUsageLimits.ts | const latest = exhausted.toSorted((a, b) => Date.parse(b.resetsAt!) - Date.parse(a.resetsAt!))[0]; → const latest = exhausted.toSorted((a, b) => Date.parse(a.resetsAt!) - Date.parse(b.resetsAt!))[0];
it("US6: A refused Codex turn pauses until the latest exhausted window resets, and gives no reset when no window is exhausted with a known future reset or the bucket is another model's", () => {
  const at = "2026-10-08T14:20:00Z";
  expect(
    codexUsageLimitBlock(
      {
        primary: { usedPercent: 100, resetsAt: 1800000000 },
        secondary: { usedPercent: 100, resetsAt: 1800100000 },
      },
      at,
    ),
  ).toEqual({ window: "Weekly", resetsAt: "2027-01-16T11:46:40.000Z" });
  for (const snapshot of [
    undefined,
    { primary: { usedPercent: 50, resetsAt: 1800000000 } },
    { primary: { usedPercent: 100 } },
    { limitId: "spark", primary: { usedPercent: 100, resetsAt: 1800000000 } },
  ]) {
    expect(codexUsageLimitBlock(snapshot, at)).toBeUndefined();
  }
});

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const grant = (overrides: Record<string, unknown>) => ({
  id: "grant_a",
  resets_left: 1,
  usable_now: true,
  ...overrides,
});

// witness: apps/server/src/provider/Layers/claudeResetCredits.ts | availableCount: next ? live.reduce((sum, grant) => sum + grant.resets_left, 0) : 0, → availableCount: live.reduce((sum, grant) => sum + grant.resets_left, 0),
it("US7: Claude's banked resets count the grants usable now that are neither paused nor past or invalid in their end, and offer one to redeem only when the account is eligible and its next grant is among them", () => {
  expect(
    ClaudeResetCredits.claudeResetCreditsToContract(
      {
        eligible: true,
        next_grant_id: "grant_a",
        grants: [
          grant({ resets_left: 2, ends_at: "2026-10-01T00:00:00Z" }),
          grant({ id: "paused", paused: true }),
          grant({ id: "expired", ends_at: "2026-09-01T00:00:00Z" }),
          grant({ id: "garbled", ends_at: "not a date" }),
          grant({ id: "date_only", ends_at: "2026-10-01" }),
          grant({ id: "impossible", ends_at: "2027-02-30T00:00:00Z" }),
          grant({ id: "empty", ends_at: "" }),
          grant({ id: "Not Valid" }),
          grant({ id: "grant_b", resets_left: 3, usable_now: false }),
        ],
      },
      NOW,
    ),
  ).toEqual({
    availableCount: 2,
    nextCreditId: "grant_a",
    nextExpiresAt: "2026-10-01T00:00:00.000Z",
  });
  expect(
    ClaudeResetCredits.claudeResetCreditsToContract(
      { eligible: true, next_grant_id: "grant_a", grants: [grant({ usable_now: false })] },
      NOW,
    ),
  ).toEqual({ availableCount: 0 });
  expect(
    ClaudeResetCredits.claudeResetCreditsToContract({ eligible: true, grants: [grant({})] }, NOW),
  ).toEqual({ availableCount: 0 });
  expect(
    ClaudeResetCredits.claudeResetCreditsToContract({ eligible: false, grants: [grant({})] }, NOW),
  ).toBeUndefined();
  expect(ClaudeResetCredits.claudeResetCreditsToContract(undefined, NOW)).toBeUndefined();
});

const respond = (status: number, body: unknown) =>
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status }))),
  );

/** Claims a Claude reset credit with a login written to a temporary directory, as a result. */
const claimClaudeReset = (
  client: HttpClient.HttpClient,
  ids: { readonly grantId: string; readonly requestId: string } = {
    grantId: "grant_a",
    requestId: "r-1",
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDir = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(
      path.join(configDir, ".credentials.json"),
      '{"claudeAiOauth":{"accessToken":"oauth-token"}}',
    );
    const accountConfigPath = path.join(configDir, ".claude.json");
    yield* fs.writeFileString(accountConfigPath, '{"oauthAccount":{"organizationUuid":"org-1"}}');
    return yield* ClaudeResetCredits.consumeClaudeResetCredit({
      configDir,
      accountConfigPath,
      version: "2.1.0",
      ...ids,
    }).pipe(
      Effect.provideService(HostProcessPlatform, "linux"),
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.result,
    );
  });

// witness: apps/server/src/provider/Layers/claudeResetCredits.ts | if (!GRANT_ID.test(input.grantId) || !REQUEST_ID.test(input.requestId)) { → if (!GRANT_ID.test(input.grantId)) {
it.effect(
  "US8: A Claude reset claim with a malformed grant or request id fails before any request is sent",
  () =>
    Effect.gen(function* () {
      const sent: Array<string> = [];
      const recording = HttpClient.make((request) =>
        Effect.sync(() => {
          sent.push(request.url);
          return HttpClientResponse.fromWeb(request, Response.json({ result: "reset" }));
        }),
      );
      for (const ids of [
        { grantId: "Bad Grant", requestId: "r-1" },
        { grantId: "grant_a", requestId: "has space" },
      ]) {
        expect((yield* claimClaudeReset(recording, ids))._tag).toBe("Failure");
      }
      expect(sent).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Layers/claudeResetCredits.ts | error.reason !== "unconfirmed"; → error.reason !== "coolingDown";
it.effect(
  "US9: A Claude reset claim that Claude answered with a cooldown, a 429 or a 401 is settled, so a retry is a new claim, and one left unanswered by a 5xx or unconfirmed is not",
  () =>
    Effect.gen(function* () {
      for (const [client, settled] of [
        [respond(200, { result: "cooldown" }), true],
        [respond(429, {}), true],
        [respond(401, {}), true],
        [respond(500, {}), false],
        [respond(200, { result: "unavailable" }), false],
      ] as const) {
        const result = yield* claimClaudeReset(client);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(ClaudeResetCredits.isSettledClaudeResetCreditFailure(result.failure)).toBe(
            settled,
          );
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Layers/resetCreditCoordinator.ts | const idempotencyKey = existing ?? (yield* crypto.uuidV4()); → const idempotencyKey = yield* crypto.uuidV4();
it.effect(
  "US10: Redeeming a reset credit re-sends the same idempotency key after an unanswered attempt and takes a fresh key after an outcome or a settled failure",
  () =>
    Effect.gen(function* () {
      const { redeem } = yield* ResetCreditCoordinator.ResetCreditCoordinator;

      const keys = yield* Ref.make<ReadonlyArray<string>>([]);
      const attempts = yield* Ref.make(0);
      const consume = (key: string) =>
        Effect.gen(function* () {
          yield* Ref.update(keys, (seen) => [...seen, key]);
          const attempt = yield* Ref.updateAndGet(attempts, (n) => n + 1);
          if (attempt === 1) return yield* Effect.fail("timed out" as const);
          return "reset" as const;
        });
      expect((yield* redeem("acct", consume).pipe(Effect.result))._tag).toBe("Failure");
      expect(yield* redeem("acct", consume)).toBe("reset");
      yield* redeem("acct", consume);
      const seen = yield* Ref.get(keys);
      expect(seen).toHaveLength(3);
      expect(seen[0]).toBe(seen[1]);
      expect(seen[1]).not.toBe(seen[2]);

      const settledKeys = yield* Ref.make<ReadonlyArray<string>>([]);
      const refuse = (key: string) =>
        Ref.update(settledKeys, (seen) => [...seen, key]).pipe(
          Effect.andThen(Effect.fail("cooldown" as const)),
        );
      const isSettled = (error: "cooldown") => error === "cooldown";
      yield* redeem("settled", refuse, isSettled).pipe(Effect.result);
      yield* redeem("settled", refuse, isSettled).pipe(Effect.result);
      const settled = yield* Ref.get(settledKeys);
      expect(settled).toHaveLength(2);
      expect(settled[0]).not.toBe(settled[1]);
    }).pipe(Effect.provide(ResetCreditCoordinator.layerTest)),
);

// witness: apps/server/src/provider/Layers/resetCreditCoordinator.ts | lock: yield* Semaphore.make(1), → lock: yield* Semaphore.make(2),
it.effect(
  "US11: Two redemptions on one account run one after the other, while redemptions on different accounts run at once",
  () =>
    Effect.gen(function* () {
      const { redeem } = yield* ResetCreditCoordinator.ResetCreditCoordinator;
      for (const [first, second, expectedPeak] of [
        ["acct", "acct", 1],
        ["acct-a", "acct-b", 2],
      ] as const) {
        const release = yield* Deferred.make<void>();
        const inFlight = yield* Ref.make(0);
        const peak = yield* Ref.make(0);
        const consume = () =>
          Effect.gen(function* () {
            const now = yield* Ref.updateAndGet(inFlight, (n) => n + 1);
            yield* Ref.update(peak, (p) => Math.max(p, now));
            yield* Deferred.await(release);
            yield* Ref.update(inFlight, (n) => n - 1);
            return "reset" as const;
          });
        const a = yield* redeem(first, consume).pipe(Effect.forkChild);
        const b = yield* redeem(second, consume).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(a);
        yield* Fiber.join(b);
        expect(yield* Ref.get(peak)).toBe(expectedPeak);
      }
    }).pipe(Effect.provide(ResetCreditCoordinator.layerTest)),
);

const hubConfig = {
  kind: "cliproxy",
  url: "http://hub.test:8317",
  managementKey: "management-secret",
  enabled: true,
} as const;
const HubRequestBody = Schema.Struct({
  auth_index: Schema.String,
  method: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  header: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  data: Schema.optional(Schema.String),
});
type HubRequestBody = typeof HubRequestBody.Type;
const decodeHubRequest = Schema.decodeUnknownSync(Schema.fromJsonString(HubRequestBody));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** An in-process CLIProxyAPI hub with two Codex accounts; it records every management call. */
function hub(upstream?: (request: HubRequestBody) => { status: number; body: unknown }) {
  const requests: Array<{ path: string; body?: HubRequestBody }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname;
      const body =
        request.body._tag === "Uint8Array"
          ? decodeHubRequest(new TextDecoder().decode(request.body.body))
          : undefined;
      requests.push({ path, ...(body ? { body } : {}) });
      if (path.endsWith("/auth-files"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            files: [
              {
                id: "first.json",
                auth_index: "a",
                provider: "codex",
                email: "first@example.com",
                id_token: { chatgpt_account_id: "account-a" },
              },
              {
                id: "second.json",
                auth_index: "b",
                provider: "codex",
                email: "second@example.com",
                id_token: { chatgpt_account_id: "account-b" },
              },
            ],
          }),
        );
      if (path.endsWith("/reset-quota"))
        return HttpClientResponse.fromWeb(request, Response.json({}, { status: 200 }));
      const answer = upstream?.(body!) ?? { status: 200, body: { code: "reset" } };
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ status_code: answer.status, body: encodeJson(answer.body) }),
      );
    }),
  );
  return {
    requests,
    api: makeCliproxyApi.pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provide(NodeCrypto.layer),
    ),
  };
}

// witness: apps/server/src/usage/cliproxyApi.ts | account.id_token?.chatgpt_account_id ?? account.id, → account.id,
it.effect(
  "US12: A redemption through a CLIProxyAPI hub carries a request id derived from the Codex account and the credit, the same on every retry, and clears only that account's cooldown",
  () =>
    Effect.gen(function* () {
      const answered = hub();
      const api = yield* answered.api;
      expect(yield* api.consume(hubConfig, "second.json", "credit-b")).toEqual({
        outcome: "reset",
      });
      expect(yield* api.consume(hubConfig, "second.json", "credit-b")).toEqual({
        outcome: "reset",
      });
      const redemptions = answered.requests.filter((request) =>
        request.body?.url?.endsWith("/consume"),
      );
      expect(redemptions).toHaveLength(2);
      expect(redemptions[0]?.body?.data).toBe(redemptions[1]?.body?.data);
      expect(redemptions[0]?.body?.data).toBe(
        encodeJson({
          // UUIDv5 of "account-b:credit-b".
          redeem_request_id: "519d5243-011a-5b7b-91f3-44d85f095705",
          credit_id: "credit-b",
        }),
      );
      expect(
        answered.requests
          .filter((request) => request.path.endsWith("/reset-quota"))
          .map((request) => request.body?.auth_index),
      ).toEqual(["b", "b"]);

      let attempts = 0;
      const uncertain = hub(() =>
        ++attempts === 1
          ? { status: 503, body: {} }
          : { status: 200, body: { code: "already_redeemed" } },
      );
      const retried = yield* uncertain.api;
      expect(
        (yield* retried.consume(hubConfig, "first.json", "credit").pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(yield* retried.consume(hubConfig, "first.json", "credit")).toEqual({
        outcome: "alreadyRedeemed",
      });
      const data = uncertain.requests
        .filter((request) => request.body?.url?.endsWith("/consume"))
        .map((request) => request.body?.data);
      expect(data).toHaveLength(2);
      expect(data[0]).toBe(data[1]);
    }),
);

// witness: apps/server/src/usage/cliproxyApi.ts | reason: "probeFailed", → reason: "unsupported",
it.effect(
  "US13: A CLIProxyAPI hub account whose read fails shows a failed probe while the other accounts still show their windows, and no upstream error body reaches what is published",
  () =>
    Effect.gen(function* () {
      const api = yield* hub((request) =>
        request.auth_index === "a"
          ? { status: 401, body: { token: "do-not-publish" } }
          : {
              status: 200,
              body: request.url?.endsWith("rate-limit-reset-credits")
                ? { credits: [] }
                : { rate_limit: { primary_window: { used_percent: 12 } } },
            },
      ).api;
      const result = yield* api.readAccounts(hubConfig);
      expect(result[0]?.usageLimits.unavailable?.reason).toBe("probeFailed");
      expect(result[1]?.usageLimits.windows[0]?.usedPercent).toBe(12);
      expect(encodeJson(result)).not.toContain("do-not-publish");
    }),
);
