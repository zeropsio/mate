import { expect, it } from "vite-plus/test";

import { releaseGateOf } from "./appOffers.ts";

// witness: packages/client-runtime/src/zerops/appOffers.ts | return offer.kind === "allowed" → return offer.kind !== "refused"
it("ZV16: Releasing an application's production is offered only where HQ allows it: an application HQ has not said of is not offered it, and one HQ never named has no answer at all", () => {
  expect(releaseGateOf({ release: { allow: true } })).toEqual({ allowed: true });
  expect(releaseGateOf({})?.allowed).toBe(false);
  expect(releaseGateOf(undefined)).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/appOffers.ts | ...(offer.kind === "refused" ? { refusedBy: "hq" as const } : {}), → ...({ refusedBy: "hq" as const }),
it("ZV17: A release is told as refused by HQ only where HQ refused it; HQ not having said yet is never told as HQ's refusal", () => {
  expect(releaseGateOf({ release: { allow: false, reason: "not_releaser" } })).toMatchObject({
    allowed: false,
    refusedBy: "hq",
  });
  const gate = releaseGateOf({});
  expect(gate?.allowed).toBe(false);
  expect("refusedBy" in gate!).toBe(false);
});
