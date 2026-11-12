import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { HqError, type HqMateTicket, makeHqApi } from "../../zerops/hq/client.ts";
import { mateTicketIssuer, PRIMED_TICKET_MS } from "./hqMateTicket.ts";

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
          return {
            ticket: "T1",
            expiresIn: 60,
            origin: "https://zcp-ada-8080.prg1.zerops.app",
            grantSeconds: 900,
          };
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

describe("a ticket minted ahead of its attempt", () => {
  const ORIGIN = "https://zcp-ada-8080.prg1.zerops.app";
  /** An HQ that answers every ask with the next ticket, in order, logging each ask. */
  const hq = (asked: Array<string>, name = "hq") => {
    let minted = 0;
    return {
      mateTicket: async (projectId: string) => {
        minted += 1;
        asked.push(`${name} ${projectId} T${minted}`);
        return { ticket: `${name}-T${minted}`, expiresIn: 60, origin: ORIGIN, grantSeconds: 900 };
      },
    };
  };

  it.effect("a primed definitive refusal ends the attempt without asking HQ again", () =>
    Effect.gen(function* () {
      for (const code of ["not_in_list", "zerops_read_only"]) {
        let asks = 0;
        const api = {
          mateTicket: async () => {
            asks += 1;
            throw refusal("refused", code);
          },
        };
        const issuer = mateTicketIssuer(() => api);
        issuer.prime({ orgId: "O1", projectId: "P1" });

        expect(yield* Effect.flip(issuer.issue({ orgId: "O1", projectId: "P1" }))).toMatchObject({
          _tag: "ConnectionBlockedError",
          reason: "read-only",
        });
        expect(asks).toBe(1);
      }
    }),
  );

  it.effect(
    "the ticket asked for beside the descriptor read is the one the connection's first attempt presents, once",
    () =>
      Effect.gen(function* () {
        const asked: Array<string> = [];
        const shared = hq(asked);
        const issuer = mateTicketIssuer(() => shared);

        issuer.prime({ orgId: "O1", projectId: "P1" });
        expect(asked).toEqual(["hq P1 T1"]);
        expect((yield* issuer.issue({ orgId: "O1", projectId: "P1" })).ticket).toBe("hq-T1");
        expect((yield* issuer.issue({ orgId: "O1", projectId: "P1" })).ticket).toBe("hq-T2");
        expect(asked).toEqual(["hq P1 T1", "hq P1 T2"]);
      }),
  );

  it.effect.each([
    {
      title: "another account's HQ asked for it",
      later: (asked: Array<string>) => hq(asked, "other"),
      elapsedMs: 0,
      presented: "other-T1",
    },
    {
      title: "its wait for an attempt ran out",
      later: undefined,
      elapsedMs: PRIMED_TICKET_MS,
      presented: "hq-T2",
    },
  ])("a ticket minted ahead is never presented where $title", ({ later, elapsedMs, presented }) =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const first = hq(asked);
      let current: ReturnType<typeof hq> = first;
      let clock = 0;
      const issuer = mateTicketIssuer(
        () => current,
        () => clock,
      );
      issuer.prime({ orgId: "O1", projectId: "P1" });
      if (later !== undefined) current = later(asked);
      clock = elapsedMs;

      expect((yield* issuer.issue({ orgId: "O1", projectId: "P1" })).ticket).toBe(presented);
    }),
  );

  it.effect("a ticket HQ refused ahead of its attempt is asked for again by the attempt", () =>
    Effect.gen(function* () {
      let asks = 0;
      const issuer = mateTicketIssuer(() => ({
        mateTicket: async () => {
          asks += 1;
          if (asks === 1) throw refusal("refused", "mate_not_connected", "no-ack");
          return { ticket: "T2", expiresIn: 60, origin: ORIGIN, grantSeconds: 900 };
        },
      }));

      issuer.prime({ orgId: "O1", projectId: "P1" });

      expect((yield* issuer.issue({ orgId: "O1", projectId: "P1" })).ticket).toBe("T2");
      expect(asks).toBe(2);
    }),
  );

  it.effect("nothing is asked ahead while an attempt is already asking for its ticket", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const started = yield* Deferred.make<void>();
      let answer: (ticket: HqMateTicket) => void = () => undefined;
      const issuer = mateTicketIssuer(() => ({
        mateTicket: (projectId) => {
          asked.push(projectId);
          return new Promise((resolve) => {
            if (asked.length === 1) {
              answer = resolve;
              Deferred.doneUnsafe(started, Effect.void);
            }
          });
        },
      }));
      const attempt = yield* Effect.forkChild(issuer.issue({ orgId: "O1", projectId: "P1" }));
      yield* Deferred.await(started);

      issuer.prime({ orgId: "O1", projectId: "P1" });
      answer({ ticket: "T1", expiresIn: 60, origin: ORIGIN, grantSeconds: 900 });

      expect((yield* Fiber.join(attempt)).ticket).toBe("T1");
      expect(asked).toEqual(["P1"]);
    }),
  );

  it.effect(
    "an exchange tried again within a ticket's life asks HQ for no second ticket ahead",
    () =>
      Effect.gen(function* () {
        const asked: Array<string> = [];
        const shared = hq(asked);
        let clock = 0;
        const issuer = mateTicketIssuer(
          () => shared,
          () => clock,
        );
        issuer.prime({ orgId: "O1", projectId: "P1" });
        yield* issuer.issue({ orgId: "O1", projectId: "P1" });
        clock = 30_000;
        issuer.prime({ orgId: "O1", projectId: "P1" });
        expect(asked).toEqual(["hq P1 T1"]);

        clock = 60_000;
        issuer.prime({ orgId: "O1", projectId: "P1" });
        expect(asked).toEqual(["hq P1 T1", "hq P1 T2"]);
      }),
  );
});
