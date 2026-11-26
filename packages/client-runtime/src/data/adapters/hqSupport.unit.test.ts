import { expect, it } from "@effect/vitest";
import { HqError } from "../../zerops/hq/client.ts";
import { supportEntry, supportEntryOf } from "./hqSupport.ts";

// witness: packages/client-runtime/src/data/adapters/hqSupport.ts | return { kind: "denied" }; → return { kind: "unavailable" };
it('AD+1: The support page goes to HQ\'s console only with a code HQ issued, and says in one sentence each why it does not: no support access, signed out, or HQ not answering; breaks: a person who is not listed is sent to a sign-in that fails with no words, or an HQ outage reads as "no access"', async () => {
  const rows = [
    {
      outcome: { ok: true, exchange: "one-use-code" },
      expected: { kind: "go", exchange: "one-use-code" },
    },
    {
      outcome: {
        ok: false,
        error: new HqError({
          kind: "refused",
          status: 403,
          code: "forbidden",
          reason: "support",
          message: "refused",
        }),
      },
      expected: { kind: "denied" },
    },
    {
      outcome: {
        ok: false,
        error: new HqError({
          kind: "refused",
          status: 401,
          code: "session_required",
          message: "refused",
        }),
      },
      expected: { kind: "signed-out" },
    },
    {
      outcome: {
        ok: false,
        error: new HqError({
          kind: "unavailable",
          status: 503,
          code: "unavailable",
          message: "unavailable",
        }),
      },
      expected: { kind: "unavailable" },
    },
    {
      outcome: {
        ok: false,
        error: new HqError({
          kind: "refused",
          status: 404,
          code: "http_404",
          message: "not found",
        }),
      },
      expected: { kind: "unavailable" },
    },
    { outcome: { ok: false, error: new Error("network") }, expected: { kind: "unavailable" } },
    { outcome: { ok: false, error: "unexpected" }, expected: { kind: "unavailable" } },
    { outcome: { ok: true, exchange: "" }, expected: { kind: "unavailable" } },
  ] as const;

  for (const row of rows) {
    expect(supportEntryOf(row.outcome)).toEqual(row.expected);
    let calls = 0;
    await expect(
      supportEntry({
        supportExchange: async () => {
          calls += 1;
          if (!row.outcome.ok) throw row.outcome.error;
          return { exchange: row.outcome.exchange };
        },
      }),
    ).resolves.toEqual(row.expected);
    expect(calls).toBe(1);
  }
});
