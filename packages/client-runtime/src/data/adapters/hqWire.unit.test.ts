import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeHqApi } from "../../zerops/hq/client.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { makeHqWire } from "./hqWire.ts";

const hqAnswering = (status: number, body: unknown) =>
  makeHqApi({
    address: "https://hq.invalid",
    orgId: "org",
    fetch: () => Promise.resolve(Response.json(body, { status })),
    accessToken: () => Promise.reject(new Error("no door")),
    openSocket: () => {
      throw new Error("no socket");
    },
    now: () => 0,
    kept: {
      read: () => ({ token: "session", expiresAtMs: Number.MAX_SAFE_INTEGER }),
      keep: () => {},
      forget: () => {},
    },
  });

// witness: packages/client-runtime/src/data/adapters/hqWire.ts | cause.kind !== "refused" → cause.kind === "refused"
it.effect(
  "AD12: HQ's 401 to a stream ticket asked with an ended session, as HQ sends it, when the session the account keeps is refused again, fails the socket's opening as HQ's refusal of the session, never as an outage",
  () =>
    Effect.gen(function* () {
      const refusal = recorded(
        "POST /api/stream-ticket 401",
        "mate-hq/stream-ticket.session-required",
      );
      const failure = yield* Effect.flip(
        Effect.scoped(makeHqWire(hqAnswering(401, refusal)).open(Effect.void)),
      );
      expect(failure).toMatchObject({ outcome: "definitive-refusal", code: "session_required" });
    }),
);
