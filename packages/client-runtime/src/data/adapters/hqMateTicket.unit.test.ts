import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { HqError } from "../../zerops/hq/client.ts";
import { ZEROPS_READ_ONLY_DOOR_REASON } from "../../zerops/mateAccess.ts";
import { mateTicketIssuer } from "./hqMateTicket.ts";

/** The attempt's failure when HQ answers a Mate's ticket with this error. */
const attemptRefusedWith = (refusal: HqError) =>
  Effect.flip(
    mateTicketIssuer(() => ({ mateTicket: () => Promise.reject(refusal) })).issue({
      orgId: "v1",
      projectId: "v2",
    }),
  ).pipe(Effect.map(({ _tag, reason }) => ({ _tag, reason })));

// witness: packages/client-runtime/src/data/adapters/hqMateTicket.ts | if (cause.code === "mate_not_found") { → if (cause.code === "not_found") {
it.effect(
  "AD66: HQ's definitive refusal of a Mate's ticket (read-only, no Mate for the person) ends the attempt and is never retried as an outage",
  () =>
    Effect.gen(function* () {
      const blocked = (reason: string) => ({ _tag: "ConnectionBlockedError", reason });
      expect(
        yield* attemptRefusedWith(
          new HqError({
            kind: "refused",
            code: "forbidden",
            reason: "not_mate_opener",
            message: "v3",
          }),
        ),
      ).toEqual(blocked("read-only"));
      for (const code of [ZEROPS_READ_ONLY_DOOR_REASON, "not_in_list"]) {
        expect(
          yield* attemptRefusedWith(new HqError({ kind: "refused", code, message: "v3" })),
          code,
        ).toEqual(blocked("read-only"));
      }
      expect(
        yield* attemptRefusedWith(
          new HqError({ kind: "refused", code: "mate_not_found", message: "v3" }),
        ),
      ).toEqual(blocked("not-found"));
    }),
);
