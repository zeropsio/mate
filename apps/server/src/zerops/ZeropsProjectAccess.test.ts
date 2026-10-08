import { assert, describe, it } from "@effect/vitest";
import type { MateAccessMember } from "@t3tools/shared/mateAccess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import { make as makeProjectAccess, RELAY_HOLDS } from "./ZeropsProjectAccess.ts";

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const MATE_KEY = "the-mates-own-zerops-key";
const JAN = "jan-user-id";
const EVA = "eva-user-id";

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  apiToken: MATE_KEY,
})!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const member = (userId: string, roleCode: string, status = "ACTIVE") => ({
  id: `cu-${userId}`,
  userId,
  roleCode,
  status,
});

/** Jan builds here, Eva reads; the Mate's own read of them, as Zerops answers it. */
const ORG = { clientUserList: [member(JAN, "BASIC_USER"), member(EVA, "READ_ONLY")] };
const OWN: ReadonlyArray<MateAccessMember> = [
  { userId: JAN, role: "BASIC_USER", visibility: "open" },
  { userId: EVA, role: "READ_ONLY", visibility: "listed" },
];
/** What HQ relays: Eva only, open. */
const RELAYED: ReadonlyArray<MateAccessMember> = [
  { userId: EVA, role: "OWNER", visibility: "open" },
];

/**
 * The service over a Zerops answering `members` and the project's `userRoles` (or failing with
 * `status`), with the Mate's `key`; its calls, and whose key each carried, recorded.
 */
const accessOver = (
  zerops: {
    readonly members?: unknown;
    readonly userRoles?: unknown;
    readonly status?: number;
    readonly key?: string | undefined;
  } = {},
) =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const keys: Array<string | undefined> = [];
    const http = HttpClient.make((request) => {
      calls.push(new URL(request.url).pathname);
      keys.push(request.headers.authorization);
      const status = zerops.status ?? 200;
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          request.url.endsWith("/user/list")
            ? json(zerops.members ?? ORG, status)
            : json(
                { id: PROJECT_ID, clientId: CLIENT_ID, userRoles: zerops.userRoles ?? [] },
                status,
              ),
        ),
      );
    });
    const access = yield* makeProjectAccess.pipe(
      Effect.provide(
        Layer.mergeAll(
          ZeropsOrgReadModule.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(HttpClient.HttpClient, http),
                Layer.succeed(
                  ZeropsMateKeyModule.ZeropsMateKey,
                  ZeropsMateKeyModule.snapshotOnlyReader("key" in zerops ? zerops.key : MATE_KEY),
                ),
              ),
            ),
          ),
          ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
        ),
      ),
    );
    return { access, calls, keys };
  });

// R6: HQ relays who the project lets in; a Mate trusts the relay at most five minutes from HQ's
// read of Zerops, and reads Zerops itself past that, or with no relay.
describe("ZeropsProjectAccess", () => {
  it.effect("answers from HQ's relay while it is fresh, reading nothing of Zerops", () =>
    Effect.gen(function* () {
      const { access, calls } = yield* accessOver();
      yield* TestClock.adjust(Duration.minutes(10));
      const now = 10 * 60_000;
      yield* access.relayed({ members: RELAYED, ageMs: 60_000 });
      assert.deepStrictEqual(yield* access.read, {
        ok: true,
        members: RELAYED,
        readAtMs: now - 60_000,
        relayed: true,
      });
      yield* TestClock.adjust(Duration.minutes(4));
      assert.isTrue((yield* access.read).ok && (yield* access.relay).pipe(Option.isSome));
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect.each(
    Array.from(
      [
        ["with no relay", undefined],
        ["once the relay is past five minutes from HQ's read", { ageMs: 0, after: RELAY_HOLDS }],
      ] as const,
      ([name, relay]) => ({ title: `reads Zerops itself ${name}`, relay }),
    ),
  )("$title", ({ relay }) =>
    Effect.gen(function* () {
      const { access, calls } = yield* accessOver();
      if (relay !== undefined) {
        yield* access.relayed({ members: RELAYED, ageMs: relay.ageMs });
        yield* TestClock.adjust(Duration.sum(relay.after, Duration.millis(1)));
      }
      const read = yield* access.read;
      assert.deepStrictEqual(read.ok ? [read.members, read.relayed] : read, [OWN, false]);
      assert.deepStrictEqual(calls, [
        `/api/rest/public/project/${PROJECT_ID}`,
        `/api/rest/public/client/${CLIENT_ID}/user/list`,
      ]);
      assert.isTrue(Option.isNone(yield* access.relay));
    }),
  );

  // An empty list is an outage dressed as an answer, and a page is not the whole org (S6).
  it.effect.each(
    Array.from(
      [
        ["Zerops fails", { status: 500 }],
        ["the member list comes back empty", { members: { clientUserList: [] } }],
        ["the member list is not a list", { members: { members: [] } }],
        ["the member list is a partial page", { members: { ...ORG, totalCount: 3 } }],
      ] as const,
      ([name, zerops]) => ({
        title: `answers nothing when ${name} and HQ relays nothing fresh`,
        zerops,
      }),
    ),
  )("$title", ({ zerops }) =>
    Effect.gen(function* () {
      const { access } = yield* accessOver(zerops);
      assert.deepStrictEqual(yield* access.read, { ok: false });
    }),
  );

  it.effect("reads Zerops as the Mate, with its own key", () =>
    Effect.gen(function* () {
      const { access, keys } = yield* accessOver();
      yield* access.read;
      assert.deepStrictEqual(keys, [`Bearer ${MATE_KEY}`, `Bearer ${MATE_KEY}`]);
    }),
  );

  it.effect("lets a project override open the door for an org READ_ONLY member", () =>
    Effect.gen(function* () {
      const { access } = yield* accessOver({
        userRoles: [{ clientUserId: `cu-${EVA}`, roleCode: "OWNER" }],
      });
      const read = yield* access.read;
      assert.deepStrictEqual(read.ok ? read.members.map((entry) => entry.visibility) : [], [
        "open",
        "open",
      ]);
    }),
  );

  it.effect("makes no call at all when this Mate has no key of its own", () =>
    Effect.gen(function* () {
      const { access, calls } = yield* accessOver({ key: undefined });
      assert.deepStrictEqual(yield* access.read, { ok: false });
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("tells a relay that changed who it lets in, never one that only aged", () =>
    Effect.gen(function* () {
      const { access } = yield* accessOver();
      const told = yield* Stream.runCollect(Stream.take(access.changes, 2)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* access.relayed({ members: OWN, ageMs: 0 });
      yield* access.relayed({ members: OWN, ageMs: 30_000 });
      yield* access.relayed({ members: RELAYED, ageMs: 0 });
      assert.lengthOf(yield* Fiber.join(told), 2);
    }),
  );
});
