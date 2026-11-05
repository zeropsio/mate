import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { HqError, makeHqApi } from "../../zerops/hq/client.ts";
import { mateTicketIssuer } from "./hqMateTicket.ts";

const refusal = (kind: HqError["kind"], code: string, reason?: string) =>
  new HqError({ kind, code, reason, message: code });

describe("mateTicketIssuer", () => {
  it.effect(
    "HQ refusing a ticket not_in_list or zerops_read_only ends the attempt as read-only without retrying",
    () =>
      Effect.gen(function* () {
        const requests: string[] = [];
        const results = yield* Effect.forEach(["not_in_list", "zerops_read_only"], (code) => {
          const api = makeHqApi({
            address: "https://hq.example",
            orgId: "O1",
            now: () => 0,
            accessToken: async () => ({ token: "person-token" }),
            kept: {
              read: () => ({ token: "session", expiresAtMs: 9_000_000 }),
              keep: () => {},
              forget: () => {},
            },
            openSocket: () => {
              throw new Error("No socket is needed for a ticket.");
            },
            fetch: async (url) => {
              requests.push(new URL(url).pathname);
              return new Response(JSON.stringify({ code }), { status: 403 });
            },
          });
          return Effect.flip(mateTicketIssuer(() => api).issue({ orgId: "O1", projectId: "P1" }));
        });

        expect(results.map(({ _tag, reason }) => ({ _tag, reason }))).toEqual([
          { _tag: "ConnectionBlockedError", reason: "read-only" },
          { _tag: "ConnectionBlockedError", reason: "read-only" },
        ]);
        expect(requests).toEqual(["/api/mates/P1/ticket", "/api/mates/P1/ticket"]);
      }),
  );

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

  it.effect(
    "HQ's no-link refusal of a Mate's ticket is told as the Mate not being connected to HQ",
    () =>
      Effect.gen(function* () {
        const issuer = mateTicketIssuer(() => ({
          mateTicket: () => Promise.reject(refusal("refused", "mate_not_connected", "no-link")),
        }));

        expect(yield* Effect.flip(issuer.issue({ orgId: "O1", projectId: "P1" }))).toMatchObject({
          _tag: "ConnectionTransientError",
          reason: "mate-not-linked",
        });
      }),
  );

  it.effect(
    "HQ answering that no Mate is there for the person ends reconnecting instead of retrying",
    () =>
      Effect.gen(function* () {
        const issuer = mateTicketIssuer(() => ({
          mateTicket: () => Promise.reject(refusal("refused", "mate_not_found")),
        }));

        expect(yield* Effect.flip(issuer.issue({ orgId: "O1", projectId: "P1" }))).toMatchObject({
          _tag: "ConnectionBlockedError",
          reason: "not-found",
          detail: "HQ has no Mate here you may open.",
        });
      }),
  );

  it.effect.each([
    { case: "a zerops_read_only refusal", code: "zerops_read_only" },
    { case: "a not_in_list refusal", code: "not_in_list" },
  ])("$case shows the Mate as not openable instead of opening it again", ({ code }) =>
    Effect.gen(function* () {
      const issuer = mateTicketIssuer(() => ({
        mateTicket: () => Promise.reject(refusal("refused", code)),
      }));

      expect(yield* Effect.flip(issuer.issue({ orgId: "O1", projectId: "P1" }))).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "read-only",
      });
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
      tag: "ConnectionBlockedError",
      reason: "not-found",
    },
    {
      case: "zerops_unanswered",
      error: refusal("unavailable", "zerops_unanswered"),
      tag: "ConnectionTransientError",
      reason: "endpoint-unavailable",
    },
    {
      case: "zerops_read_only in an unavailable HQ response",
      error: refusal("unavailable", "zerops_read_only"),
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
