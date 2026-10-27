import { describe, expect, it } from "@effect/vitest";
import { ConversationId, EffectId, type LeaseReleaseResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { EffectRow } from "../outbox/EffectOutbox.ts";
import { LeaseRelease } from "../ports.ts";
import { makeLeaseRelease } from "./leaseRelease.ts";

const row = (payload: unknown): EffectRow => ({
  effectId: EffectId.make("mate/lease/webpool-3/e/lease.release/2"),
  conversationId: ConversationId.make("mate"),
  ownerKind: "conversation",
  lane: "side",
  kind: "lease.release",
  class: "replay-safe",
  runId: null,
  payload,
  state: "running",
  attempt: 1,
  availableAt: 0,
  claimedBoot: null,
  lastError: null,
  outcome: null,
  settleAttempt: 0,
});

const payload = {
  alias: "webpool-3",
  branch: "feat-x",
  repo: "https://hq.example/git/app/web.git",
};

describe("lease.release", () => {
  it.effect(
    "an archived conversation's branch is released through zcp once, as its binding names it",
    () =>
      Effect.gen(function* () {
        const asked: Array<unknown> = [];
        const result: LeaseReleaseResult = {
          outcome: "released",
          leases: [{ lease: "webpool-3", outcome: "kept-warm" }],
        };
        const handler = yield* makeLeaseRelease.pipe(
          Effect.provideService(
            LeaseRelease,
            LeaseRelease.of({
              release: (input) => Effect.sync(() => asked.push(input)).pipe(Effect.as(result)),
            }),
          ),
        );
        const answer = yield* handler.run(row(payload));
        expect(asked).toEqual([{ branch: "feat-x", repo: "https://hq.example/git/app/web.git" }]);
        expect(answer).toEqual({
          _tag: "Done",
          outcome: { kind: "ok", value: { alias: "webpool-3", branch: "feat-x", result } },
        });
      }),
  );

  it.effect("outside Zerops nothing releases, and the receipt says so", () =>
    Effect.gen(function* () {
      const handler = yield* makeLeaseRelease;
      const answer = yield* handler.run(row(payload));
      expect(answer).toMatchObject({
        _tag: "Done",
        outcome: {
          kind: "ok",
          value: { alias: "webpool-3", branch: "feat-x", result: { outcome: "failed" } },
        },
      });
    }),
  );
});
