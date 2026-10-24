import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { HqError } from "../../zerops/hq/client.ts";
import { mateTicketIssuer } from "./hqMateTicket.ts";

const refusal = (kind: HqError["kind"], code: string, reason?: string) =>
  new HqError({ kind, code, reason, message: code });

describe("mateTicketIssuer", () => {
  it.effect("A Mate's ticket is the one HQ issued for its project, with the origin HQ named", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const issuer = mateTicketIssuer((orgId) => ({
        mateTicket: async (projectId) => {
          asked.push(`${orgId}/${projectId}`);
          return { ticket: "T1", expiresIn: 60, origin: "https://zcp-ada-8080.prg1.zerops.app" };
        },
      }));

      expect(yield* issuer.issue({ orgId: "O1", projectId: "P1" })).toEqual({
        ticket: "T1",
        origin: "https://zcp-ada-8080.prg1.zerops.app",
      });
      expect(asked).toEqual(["O1/P1"]);
    }),
  );

  it.effect.each([
    {
      case: "not_mate_opener",
      error: refusal("refused", "forbidden", "not_mate_opener"),
      tag: "ConnectionBlockedError",
      reason: "read-only",
    },
    {
      case: "mate_not_connected",
      error: refusal("refused", "mate_not_connected"),
      tag: "ConnectionTransientError",
      reason: "remote-unavailable",
    },
    {
      case: "mate_not_found",
      error: refusal("refused", "mate_not_found"),
      tag: "ConnectionTransientError",
      reason: "remote-unavailable",
    },
    {
      case: "not_active",
      error: refusal("unavailable", "not_active"),
      tag: "ConnectionTransientError",
      reason: "endpoint-unavailable",
    },
    {
      case: "network",
      error: refusal("unavailable", "network"),
      tag: "ConnectionTransientError",
      reason: "network",
    },
    {
      case: "session_required",
      error: refusal("refused", "session_required"),
      tag: "ConnectionTransientError",
      reason: "remote-unavailable",
    },
    {
      case: "no HQ session yet",
      error: null,
      tag: "ConnectionTransientError",
      reason: "endpoint-unavailable",
    },
  ])(
    "Only HQ saying the person may not open the Mate ends its reconnecting: $case",
    ({ error, tag, reason }) =>
      Effect.gen(function* () {
        const issuer = mateTicketIssuer(() =>
          error === null ? null : { mateTicket: () => Promise.reject(error) },
        );

        expect(yield* Effect.flip(issuer.issue({ orgId: "O1", projectId: "P1" }))).toMatchObject({
          _tag: tag,
          reason,
        });
      }),
  );
});
