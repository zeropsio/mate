import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import {
  CHALLENGE_ENV,
  MateCredentials,
  MateRefused,
  mateCredentialsLayer,
} from "./mateCredentials.ts";
import { ZeropsApi } from "./zerops/api.ts";

/** HQ's Read only token, a Mate's project in its org and one in another org. */
const world = (): FakeWorld => {
  const fake = emptyWorld();
  fake.tokens.set("hq", {
    id: "T-hq",
    name: "mate-hq-org:HQ1",
    orgId: "ORG",
    roleCode: "READ_ONLY",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: null,
  });
  for (const [id, orgId] of [
    ["P_MATE", "ORG"],
    ["P_ELSE", "ORG2"],
  ] as const) {
    fake.projects.push({ id, orgId, name: id, status: "ACTIVE", tags: [], userRoles: [] });
  }
  return fake;
};

const withMates = <A, E>(
  use: (fake: FakeWorld) => Effect.Effect<A, E, MateCredentials | SqlClient.SqlClient>,
  wrap: (api: ZeropsApi["Service"]) => ZeropsApi["Service"] = (api) => api,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const fake = world();
    const context = yield* Layer.build(
      mateCredentialsLayer({ credential: Option.some(Redacted.make("hq")) }).pipe(
        Layer.provide(Layer.succeed(ZeropsApi, wrap(fakeZeropsApi(fake)))),
        Layer.provideMerge(activeCoreLayer(url)),
      ),
    );
    return yield* Effect.andThen(untilActive, use(fake)).pipe(Effect.provide(context));
  });

const isMateRefused = Schema.is(MateRefused);

/** The code of `effect`'s refusal, or the tag of any other failure. */
const refusalOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.flip(effect), (error) => (isMateRefused(error) ? error.code : error._tag));

/** What zcp does with its own key: writes the nonce into its project's env, unmarked. */
const writeChallenge = (fake: FakeWorld, projectId: string, value: string, sensitive = false) =>
  fake.env.set(projectId, [{ key: CHALLENGE_ENV, value, sensitive }]);

describe("mate credentials", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a Mate that writes its challenge into its project's env gets a credential that names the project",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            const mates = yield* MateCredentials;
            const challenge = yield* mates.challenge("P_MATE");
            assert.match(challenge.nonce, /^[A-Za-z0-9_-]{43}$/u);
            assert.strictEqual(challenge.expiresIn, 120);
            writeChallenge(fake, "P_MATE", challenge.nonce);

            const { credential } = yield* mates.issue("P_MATE", challenge.nonce);
            assert.match(credential, /^[A-Za-z0-9_-]{43}$/u);
            assert.deepStrictEqual(
              yield* mates.whoami(credential),
              Option.some({ projectId: "P_MATE" }),
            );
            assert.deepStrictEqual(yield* mates.whoami(`${credential}x`), Option.none());

            const sql = yield* SqlClient.SqlClient;
            const stored = yield* sql<{ readonly hash: string }>`
              SELECT nonce_hash AS hash FROM hq_mate_challenge
              UNION ALL SELECT credential_hash FROM hq_mate_credential`;
            assert.deepStrictEqual(
              stored.map((row) => row.hash.length),
              [64, 64],
            );
            assert.notInclude(stored.map((row) => row.hash).join(), challenge.nonce);
            assert.notInclude(stored.map((row) => row.hash).join(), credential);
          }),
        ),
    );

    it.effect("refuses a nonce the project's env does not hold in the clear", () =>
      withMates((fake) =>
        Effect.gen(function* () {
          const mates = yield* MateCredentials;
          const { nonce } = yield* mates.challenge("P_MATE");
          const refusal = refusalOf(mates.issue("P_MATE", nonce));
          assert.strictEqual(yield* refusal, "env_mismatch");
          writeChallenge(fake, "P_MATE", `${nonce}x`);
          assert.strictEqual(yield* refusal, "env_mismatch");
          // A sensitive value reads REDACTED to HQ's Read only credential.
          writeChallenge(fake, "P_MATE", nonce, true);
          assert.strictEqual(yield* refusal, "env_mismatch");
          // A mismatch does not spend the nonce: the write may land before the next try.
          writeChallenge(fake, "P_MATE", nonce);
          assert.match((yield* mates.issue("P_MATE", nonce)).credential, /^[A-Za-z0-9_-]{43}$/u);
        }),
      ),
    );

    it.effect("forgets a challenge ten minutes after it expired", () =>
      withMates(() =>
        Effect.gen(function* () {
          const mates = yield* MateCredentials;
          const sql = yield* SqlClient.SqlClient;
          yield* mates.challenge("P_MATE");
          yield* sql`UPDATE hq_mate_challenge SET expires_at = now() - interval '11 minutes'`;
          const { nonce } = yield* mates.challenge("P_MATE");
          yield* sql`UPDATE hq_mate_challenge SET expires_at = now() - interval '9 minutes'
                     WHERE nonce_hash = encode(sha256(convert_to(${nonce}, 'UTF8')), 'hex')`;
          yield* mates.challenge("P_MATE");
          assert.strictEqual((yield* sql`SELECT 1 FROM hq_mate_challenge`).length, 2);
        }),
      ),
    );

    it.effect("a project's next credential revokes the one before", () =>
      withMates((fake) =>
        Effect.gen(function* () {
          const mates = yield* MateCredentials;
          const enroll = Effect.gen(function* () {
            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            return (yield* mates.issue("P_MATE", nonce)).credential;
          });
          const first = yield* enroll;
          const second = yield* enroll;
          assert.deepStrictEqual(yield* mates.whoami(first), Option.none());
          assert.deepStrictEqual(yield* mates.whoami(second), Option.some({ projectId: "P_MATE" }));
        }),
      ),
    );

    it.effect(
      "a nonce enrolls once, only the project it was handed out for, and only for two minutes",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            const mates = yield* MateCredentials;
            const sql = yield* SqlClient.SqlClient;
            const refusal = (projectId: string, nonce: string) =>
              refusalOf(mates.issue(projectId, nonce));

            const once = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", once.nonce);
            yield* mates.issue("P_MATE", once.nonce);
            assert.strictEqual(yield* refusal("P_MATE", once.nonce), "unknown_nonce");

            const forMate = yield* mates.challenge("P_MATE");
            fake.projects.push({
              id: "P_OTHER",
              orgId: "ORG",
              name: "P_OTHER",
              status: "ACTIVE",
              tags: [],
              userRoles: [],
            });
            writeChallenge(fake, "P_OTHER", forMate.nonce);
            assert.strictEqual(yield* refusal("P_OTHER", forMate.nonce), "unknown_nonce");
            assert.strictEqual(yield* refusal("P_MATE", "never-handed-out"), "unknown_nonce");

            const late = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", late.nonce);
            yield* sql`UPDATE hq_mate_challenge SET expires_at = now() - interval '1 second'`;
            assert.strictEqual(yield* refusal("P_MATE", late.nonce), "expired");
          }),
        ),
    );

    it.effect("of presentations of one nonce racing past its first check, one enrolls", () => {
      // Every env read waits for all four, so all four have found the nonce unspent.
      const arrived = Deferred.makeUnsafe<void>();
      let reads = 0;
      const together = (api: ZeropsApi["Service"]): ZeropsApi["Service"] => ({
        ...api,
        projectEnv: (projectId) => (credential) =>
          Effect.andThen(
            Effect.suspend(() =>
              ++reads === 4 ? Deferred.succeed(arrived, undefined) : Effect.void,
            ),
            Effect.andThen(Deferred.await(arrived), api.projectEnv(projectId)(credential)),
          ),
      });
      return withMates(
        (fake) =>
          Effect.gen(function* () {
            const mates = yield* MateCredentials;
            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            const answers = yield* Effect.all(
              Array.from({ length: 4 }, () =>
                Effect.orElseSucceed(refusalOf(mates.issue("P_MATE", nonce)), () => "issued"),
              ),
              { concurrency: "unbounded" },
            );
            assert.deepStrictEqual(answers.toSorted(), [
              "issued",
              "unknown_nonce",
              "unknown_nonce",
              "unknown_nonce",
            ]);
          }),
        together,
      );
    });

    it.effect(
      "refuses a project outside HQ's org or gone from Zerops, at the challenge and at the credential",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            const mates = yield* MateCredentials;
            assert.strictEqual(yield* refusalOf(mates.challenge("P_ELSE")), "project_not_in_org");
            assert.strictEqual(yield* refusalOf(mates.challenge("P_NONE")), "project_gone");

            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            fake.projects.splice(
              fake.projects.findIndex((project) => project.id === "P_MATE"),
              1,
            );
            assert.strictEqual(yield* refusalOf(mates.issue("P_MATE", nonce)), "project_gone");
          }),
        ),
    );
  });
});
