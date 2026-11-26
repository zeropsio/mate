import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HqError, makeHqApi } from "../../zerops/hq/client.ts";
import { hqRefusalWords } from "../../zerops/hq/refusals.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { makeHqWire } from "./hqWire.ts";

const hqAnswering = (
  status: number,
  body: unknown,
  observe: (url: string, init: RequestInit | undefined) => void = () => {},
) =>
  makeHqApi({
    address: "https://hq.invalid",
    orgId: "org",
    fetch: (url, init) => {
      observe(url, init);
      return Promise.resolve(Response.json(body, { status }));
    },
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

// witness: packages/client-runtime/src/zerops/hq/client.ts | decoded(HqSupportExchange, "a support exchange") → json<{ readonly exchange: string }>
it("AD88: The exchange is asked for with the session's bearer and no body, and its answer's code is taken as it is; breaks: the request carries something HQ does not read, or a malformed answer is posted to HQ", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const observe = (url: string, init: RequestInit | undefined) => requests.push({ url, init });
  const api = hqAnswering(
    201,
    { exchange: "one-use-code", expiresAt: "2030-01-01T00:00:00Z" },
    observe,
  );

  expect((await api.supportExchange()).exchange).toBe("one-use-code");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://hq.invalid/api/operator-support/exchanges");
  expect(requests[0]?.init?.method).toBe("POST");
  expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe("Bearer session");
  expect(requests[0]?.init?.body).toBeUndefined();

  let malformed: unknown;
  try {
    await hqAnswering(201, { expiresAt: "2030-01-01T00:00:00Z" }).supportExchange();
  } catch (error) {
    malformed = error;
  }
  expect(malformed).toMatchObject({ code: "unreadable" });

  const refused: Array<{ url: string; init: RequestInit | undefined }> = [];
  await expect(
    hqAnswering(401, { code: "session_required" }, (url, init) =>
      refused.push({ url, init }),
    ).supportExchange(),
  ).rejects.toMatchObject({ code: "session_required", status: 401 });
  expect(refused).toHaveLength(1);
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

// witness: packages/client-runtime/src/data/adapters/hqWire.ts | code: "box_unavailable" → code: cause.code
it.effect(
  "AD14: HQ's answer that a change's repository is withheld by its box reaches the review as the box being unavailable, never as a repository too large for HQ",
  () =>
    Effect.gen(function* () {
      const wire = makeHqWire({
        openScopeSocket: async () => {
          throw new Error("Unexpected socket");
        },
        changeVerdict: async () => {
          throw new HqError({
            kind: "unavailable",
            status: 503,
            code: "repo_unavailable",
            box: "unanswered",
            message: "Repository withheld",
          });
        },
      });
      const fault = yield* Effect.flip(
        wire.verdict!({ link: { appId: "app", repo: "web", number: 1 } }),
      );
      expect(fault).toMatchObject({ outcome: "transient", code: "box_unavailable" });
    }),
);

// witness: packages/client-runtime/src/zerops/hq/client.ts | { zerops: refusal.zerops } : {} → {} : {}
it.effect(
  "AD85: A call Zerops refused, as HQ answers it, reaches the person as Zerops' own sentence, as the refusal's kind where Zerops sent no sentence, and as HQ's own words where HQ carried no answer of Zerops'; breaks: a person whose organization lacks credit reads that HQ refused or is not answering, and never what Zerops said",
  () =>
    Effect.gen(function* () {
      // The spec's example of a refused request (mate-hq spec/protocol.md, Zerops' answer).
      const zerops = {
        words: "Client not found.",
        status: 404,
        error: { code: "clientNotFound", message: "Client not found." },
        request: null,
      };
      const refusal = { code: "zerops_refused", reason: "not_found" };
      // The write's rejection, or null where HQ's refusal never reached it.
      const refusedWith = (body: unknown) =>
        Effect.promise(() =>
          hqAnswering(403, body)
            .deleteApp("app")
            .then(
              () => null,
              (cause: unknown) => cause,
            ),
        );
      const errors = [
        yield* refusedWith({ ...refusal, zerops }),
        yield* refusedWith({ ...refusal, zerops: { ...zerops, words: null } }),
        yield* refusedWith(refusal),
        yield* refusedWith({ ...refusal, zerops: "garbled" }),
      ];
      for (const error of errors) {
        expect(error).toBeInstanceOf(HqError);
        expect(error).toMatchObject({
          kind: "refused",
          code: "zerops_refused",
          reason: "not_found",
        });
      }
      const [said, unsaid, carried, garbled] = errors.map((error) => (error as HqError).message);
      expect(said).toContain("Client not found.");
      expect(said).not.toEqual(carried);
      expect(unsaid).toContain("not_found");
      expect(unsaid).not.toContain("Client not found.");
      expect(carried).toEqual(hqRefusalWords(refusal));
      expect(garbled).toEqual(carried);
    }),
);
