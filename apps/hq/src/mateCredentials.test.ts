import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import {
  CHALLENGE_ENV,
  MateCredentials,
  MateRefused,
  enrollmentVerdict,
  mateCredentialsLayer,
} from "./mateCredentials.ts";
import { rolesLayer } from "./roles.ts";
import { ZeropsApi, ZeropsUnavailable } from "./zerops/api.ts";

/**
 * HQ's Read only token, its project and its owner; a Mate's project, an environment, a devstage and
 * a project HQ holds as nothing, in its org; one project in another org.
 */
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
  fake.members.set("ORG", [
    {
      name: "owner",
      kind: "person",
      roleCode: "OWNER",
      status: "ACTIVE",
      userId: "owner",
      clientUserId: "C-owner",
      canCreateProjects: true,
    },
  ]);
  for (const [id, orgId] of [
    ["HQ1", "ORG"],
    ["P_MATE", "ORG"],
    ["P_STAGE", "ORG"],
    ["P_DEV", "ORG"],
    ["P_PLAIN", "ORG"],
    ["P_ELSE", "ORG2"],
  ] as const) {
    fake.projects.push({
      id,
      orgId,
      name: id,
      status: "ACTIVE",
      tags: [],
      userRoles: [],
      publicZone: `${id}.prg1-zerops.zone`,
    });
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
    const credential = Option.some(Redacted.make("hq"));
    const context = yield* Layer.build(
      mateCredentialsLayer({ credential }).pipe(
        Layer.provide(rolesLayer({ hqProjectId: "HQ1", credential })),
        Layer.provide(Layer.succeed(ZeropsApi, wrap(fakeZeropsApi(fake)))),
        Layer.provideMerge(activeCoreLayer(url)),
      ),
    );
    // P_MATE is a Mate in no application; P_STAGE and P_DEV are Shop's stage and devstage.
    const held = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO hq_mate (project_id, face) VALUES ('P_MATE', 'face-1')`;
      const [app] = yield* sql<{ readonly id: string }>`
        INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
      yield* sql`
        INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
        VALUES ('P_STAGE', ${app!.id}::uuid, 'stage', 'owner'),
               ('P_DEV', ${app!.id}::uuid, 'devstage', 'owner')`;
    });
    return yield* untilActive.pipe(
      Effect.andThen(held),
      Effect.andThen(use(fake)),
      Effect.provide(context),
    );
  });

const isMateRefused = Schema.is(MateRefused);

/** The nonce the presentation running reads back from its project's env. */
const Presenting = Context.Reference<string>("test/mateCredentials/presenting", {
  defaultValue: () => "",
});

/** The code of `effect`'s refusal, or the tag of any other failure. */
const refusalOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.flip(effect), (error) => (isMateRefused(error) ? error.code : error._tag));

/** A key of the org `orgId`, by its id, granting `projectIds` (no value is ever read). */
const keyIn = (fake: FakeWorld, orgId: string, id: string, ...projectIds: ReadonlyArray<string>) =>
  fake.tokens.set(`value-of-${id}`, {
    id,
    name: "zerops-zcp-zcp",
    orgId,
    roleCode: "NO_ACCESS",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: projectIds.map((projectId) => ({ projectId, roleCode: "ADMIN" })),
    createdMs: 0,
    createdByUser: "owner",
  });

/** A key of HQ's org, by its id, with exactly these grants. */
const keyWith = (
  fake: FakeWorld,
  id: string,
  grants: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>,
) =>
  fake.tokens.set(`value-of-${id}`, {
    id,
    name: "zcp-P_MATE",
    orgId: "ORG",
    roleCode: "NO_ACCESS",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: grants,
    createdMs: 0,
    createdByUser: "owner",
  });

/** A Mate's key on the platform, in HQ's org. */
const keyOn = (fake: FakeWorld, id: string, ...projectIds: ReadonlyArray<string>) =>
  keyIn(fake, "ORG", id, ...projectIds);

/** What zcp does with its own key: writes the nonce into its project's env, unmarked. */
const writeChallenge = (fake: FakeWorld, projectId: string, value: string, sensitive = false) =>
  fake.env.set(projectId, [{ key: CHALLENGE_ENV, value, sensitive }]);

/** A zcp service of the project, as Zerops holds it. */
const zcpIn = (fake: FakeWorld, id: string, projectId: string) =>
  fake.services.push({
    id,
    projectId,
    name: id.toLowerCase(),
    status: "ACTIVE",
    isSystem: false,
    subdomainAccess: false,
    http: false,
    named: null,
    activeVersionId: null,
  });

// One Mate per project (audit D2): its record names its zcp service, and an enrollment from another
// never takes its credential. An enrollment that names no service is an older zcp's, decided as
// before, except where it would revoke the credential of the Mate the record names.
describe("enrollmentVerdict", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly pinned: string | null;
    readonly claim: string | undefined;
    readonly holder: string | null | undefined;
    readonly pinnedGone: boolean;
    readonly verdict: ReturnType<typeof enrollmentVerdict>;
  }> = [
    {
      name: "the first enrollment that names its service records it",
      pinned: null,
      claim: "S1",
      holder: undefined,
      pinnedGone: false,
      verdict: { kind: "issue", pin: "S1" },
    },
    {
      name: "the recorded service enrolls again",
      pinned: "S1",
      claim: "S1",
      holder: "S1",
      pinnedGone: false,
      verdict: { kind: "issue", pin: "S1" },
    },
    {
      name: "another service of the project is refused",
      pinned: "S1",
      claim: "S2",
      holder: "S1",
      pinnedGone: false,
      verdict: { kind: "refuse" },
    },
    {
      name: "another service is refused with no credential live",
      pinned: "S1",
      claim: "S2",
      holder: undefined,
      pinnedGone: false,
      verdict: { kind: "refuse" },
    },
    {
      name: "the recorded service gone, the next one takes its place",
      pinned: "S1",
      claim: "S2",
      holder: "S1",
      pinnedGone: true,
      verdict: { kind: "issue", pin: "S2" },
    },
    {
      name: "an older zcp's enrollment, nothing recorded",
      pinned: null,
      claim: undefined,
      holder: null,
      pinnedGone: false,
      verdict: { kind: "issue", pin: null },
    },
    {
      name: "an older zcp's enrollment, recorded at its attach, no credential live",
      pinned: "S1",
      claim: undefined,
      holder: undefined,
      pinnedGone: false,
      verdict: { kind: "issue", pin: "S1" },
    },
    {
      name: "an older zcp's enrollment where the live credential is an older zcp's",
      pinned: "S1",
      claim: undefined,
      holder: null,
      pinnedGone: false,
      verdict: { kind: "issue", pin: "S1" },
    },
    {
      name: "an older zcp's enrollment never revokes the recorded Mate's credential",
      pinned: "S1",
      claim: undefined,
      holder: "S1",
      pinnedGone: false,
      verdict: { kind: "refuse" },
    },
    {
      name: "an older zcp's enrollment where the recorded service is gone",
      pinned: "S1",
      claim: undefined,
      holder: "S1",
      pinnedGone: true,
      verdict: { kind: "issue", pin: null },
    },
  ];
  it.each(Array.from(cases, ({ name, verdict, ...input }) => ({ title: name, verdict, input })))(
    "$title",
    ({ verdict, input }) => {
      assert.deepStrictEqual(enrollmentVerdict(input), verdict);
    },
  );
});

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

    it.effect(
      "issues a credential only for a project HQ holds as a Mate, asked again at the issue",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            const mates = yield* MateCredentials;
            const sql = yield* SqlClient.SqlClient;
            assert.deepStrictEqual(
              yield* Effect.all([
                refusalOf(mates.challenge("P_STAGE")),
                refusalOf(mates.challenge("P_PLAIN")),
              ]),
              ["not_a_mate", "not_a_mate"],
            );
            const devstage = yield* mates.challenge("P_DEV");
            writeChallenge(fake, "P_DEV", devstage.nonce);
            assert.match((yield* mates.issue("P_DEV", devstage.nonce)).credential, /^[\w-]{43}$/u);

            // Turned into an environment between the challenge and the issue.
            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            const [app] = yield* sql<{ readonly id: string }>`SELECT id::text AS id FROM hq_app`;
            yield* sql`
              INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
              VALUES ('P_MATE', ${app!.id}::uuid, 'production', 'owner')`;
            assert.strictEqual(yield* refusalOf(mates.issue("P_MATE", nonce)), "not_a_mate");
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

    // Audit K3 and the adoption's harden: a Mate names its own key's id to HQ — at its enrollment,
    // and again with its credential — so its key is found by id, never by matching a token list.
    // A credential issued without one keeps the id the one before named; a revoked credential
    // names nothing.
    it.effect("keeps the key id a Mate names, at its enrollment and with its credential", () =>
      withMates((fake) =>
        Effect.gen(function* () {
          for (const id of ["tok-key-1", "tok-key-2", "tok-key-3"]) keyOn(fake, id, "P_MATE");
          const mates = yield* MateCredentials;
          const enroll = (keyTokenId?: string) =>
            Effect.gen(function* () {
              const { nonce } = yield* mates.challenge("P_MATE");
              writeChallenge(fake, "P_MATE", nonce);
              return (yield* mates.issue(
                "P_MATE",
                nonce,
                keyTokenId === undefined ? {} : { keyTokenId },
              )).credential;
            });
          assert.isNull(yield* mates.keyOf("P_MATE"));
          const first = yield* enroll("tok-key-1");
          assert.strictEqual(yield* mates.keyOf("P_MATE"), "tok-key-1");
          yield* mates.keepKey(first, "tok-key-2");
          assert.strictEqual(yield* mates.keyOf("P_MATE"), "tok-key-2");

          const second = yield* enroll();
          assert.strictEqual(yield* mates.keyOf("P_MATE"), "tok-key-2");
          assert.strictEqual(
            yield* refusalOf(mates.keepKey(first, "tok-key-3")),
            "mate_credential_required",
          );
          yield* mates.keepKey(second, "tok-key-3");
          assert.strictEqual(yield* mates.keyOf("P_MATE"), "tok-key-3");
        }),
      ),
    );

    // An org Read only token reads a token by its id (measured on KRLS 2026-10-03: 200, with its
    // projects, role and creator): HQ keeps an id only where that token's one grant is the Mate's
    // own project — never a deploy key, a person's token, or another Mate's key.
    it.effect("keeps a key id only where its token's one grant is the Mate's project", () =>
      withMates((fake) =>
        Effect.gen(function* () {
          keyOn(fake, "tok-own", "P_MATE");
          keyOn(fake, "tok-wide", "P_MATE", "P_STAGE");
          keyOn(fake, "tok-other", "P_STAGE");
          const mates = yield* MateCredentials;
          const { nonce } = yield* mates.challenge("P_MATE");
          writeChallenge(fake, "P_MATE", nonce);
          const { credential } = yield* mates.issue("P_MATE", nonce, { keyTokenId: "tok-wide" });
          assert.isNull(yield* mates.keyOf("P_MATE"));
          assert.deepStrictEqual(
            [
              yield* refusalOf(mates.keepKey(credential, "tok-other")),
              yield* refusalOf(mates.keepKey(credential, "tok-gone")),
            ],
            ["key_not_its_own", "key_not_its_own"],
          );
          yield* mates.keepKey(credential, "tok-own");
          assert.strictEqual(yield* mates.keyOf("P_MATE"), "tok-own");
        }),
      ),
    );

    // ADR 0003's fallout: a key an earlier client widened with READ_ONLY on siblings is never
    // taken for the Mate's key, but HQ says the Mate needs Finish setup — read at its enrollment
    // and with its credential, never on a page's read — and reads the key again, when the person
    // who finished it asks, once its harden took those grants off.
    it.effect(
      "says a Mate whose key reads other projects needs Finish setup, until it no longer does",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            keyWith(fake, "tok-wide", [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "P_STAGE", roleCode: "READ_ONLY" },
            ]);
            const mates = yield* MateCredentials;
            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            const issued = yield* mates.issue("P_MATE", nonce, { keyTokenId: "tok-wide" });
            assert.isNull(yield* mates.keyOf("P_MATE"));
            assert.isTrue(issued.keyWiderMoved);
            assert.isTrue(yield* mates.keyWider("P_MATE"));

            // Finish setup's harden is told that key by its id, the one the Mate's container
            // holds: a key found by its id is the Mate's to narrow (`planMateKey`).
            assert.strictEqual(yield* mates.keyFor("owner", "P_MATE"), "tok-wide");

            // Not yet lowered: asked again, it still reads other projects.
            assert.isFalse(yield* mates.recheckKey("owner", "P_MATE"));
            assert.isTrue(yield* mates.keyWider("P_MATE"));

            // Finish setup's harden took the siblings off: it is the Mate's own key now.
            keyWith(fake, "tok-wide", [{ projectId: "P_MATE", roleCode: "BASIC_USER" }]);
            assert.isTrue(yield* mates.recheckKey("owner", "P_MATE"));
            assert.isFalse(yield* mates.keyWider("P_MATE"));
            assert.strictEqual(yield* mates.keyOf("P_MATE"), "tok-wide");
          }),
        ),
    );

    it.effect(
      "a key that writes another project, or reads none of its own, is not said wider",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            keyWith(fake, "tok-writes", [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "P_STAGE", roleCode: "ADMIN" },
            ]);
            keyWith(fake, "tok-elsewhere", [{ projectId: "P_STAGE", roleCode: "READ_ONLY" }]);
            keyWith(fake, "tok-wide", [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "P_STAGE", roleCode: "READ_ONLY" },
            ]);
            const mates = yield* MateCredentials;
            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            const { credential } = yield* mates.issue("P_MATE", nonce, {
              keyTokenId: "tok-writes",
            });
            assert.isFalse(yield* mates.keyWider("P_MATE"));
            assert.strictEqual(
              yield* refusalOf(mates.keepKey(credential, "tok-elsewhere")),
              "key_not_its_own",
            );
            assert.isFalse(yield* mates.keyWider("P_MATE"));
            // Named with its credential, a widened key is said, and still never kept as its key.
            assert.strictEqual(
              yield* refusalOf(mates.keepKey(credential, "tok-wide")),
              "key_not_its_own",
            );
            assert.isTrue(yield* mates.keyWider("P_MATE"));
            assert.isNull(yield* mates.keyOf("P_MATE"));
          }),
        ),
    );

    // Security review 9: the word that a Mate's key reads other projects goes only on a positive
    // reading of it narrow; a key gone, refused, or now writing elsewhere keeps the word.
    it.effect(
      "keeps saying a key is wider until it reads narrow, never on a key it cannot read",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            keyWith(fake, "tok-wide", [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "P_STAGE", roleCode: "READ_ONLY" },
            ]);
            const mates = yield* MateCredentials;
            const { nonce } = yield* mates.challenge("P_MATE");
            writeChallenge(fake, "P_MATE", nonce);
            yield* mates.issue("P_MATE", nonce, { keyTokenId: "tok-wide" });

            keyWith(fake, "tok-wide", [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "P_STAGE", roleCode: "ADMIN" },
            ]);
            assert.isFalse(yield* mates.recheckKey("owner", "P_MATE"));
            assert.isTrue(yield* mates.keyWider("P_MATE"));

            fake.tokens.delete("value-of-tok-wide");
            assert.isFalse(yield* mates.recheckKey("owner", "P_MATE"));
            assert.isTrue(yield* mates.keyWider("P_MATE"));
          }),
        ),
    );

    it.effect("reads a Mate's key again only for whoever may edit its record", () =>
      withMates((fake) =>
        Effect.gen(function* () {
          keyWith(fake, "tok-wide", [
            { projectId: "P_MATE", roleCode: "BASIC_USER" },
            { projectId: "P_STAGE", roleCode: "READ_ONLY" },
          ]);
          const mates = yield* MateCredentials;
          const { nonce } = yield* mates.challenge("P_MATE");
          writeChallenge(fake, "P_MATE", nonce);
          yield* mates.issue("P_MATE", nonce, { keyTokenId: "tok-wide" });
          const refused = yield* Effect.flip(mates.recheckKey("stranger", "P_MATE"));
          assert.strictEqual(refused._tag, "StructureRefused");
          assert.isTrue(yield* mates.keyWider("P_MATE"));
        }),
      ),
    );

    it.effect("an id Zerops will not show HQ is none, and never stops its Mate's enrollment", () =>
      withMates((fake) =>
        Effect.gen(function* () {
          keyIn(fake, "OTHER", "tok-foreign", "P_MATE");
          const mates = yield* MateCredentials;
          const { nonce } = yield* mates.challenge("P_MATE");
          writeChallenge(fake, "P_MATE", nonce);
          const { credential } = yield* mates.issue("P_MATE", nonce, { keyTokenId: "tok-foreign" });
          assert.isNull(yield* mates.keyOf("P_MATE"));
          assert.strictEqual(
            yield* refusalOf(mates.keepKey(credential, "tok-foreign")),
            "key_not_its_own",
          );
        }),
      ),
    );

    it.effect(
      "refuses an enrollment from another zcp service of the project, and the Mate keeps its credential",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            zcpIn(fake, "S1", "P_MATE");
            zcpIn(fake, "S2", "P_MATE");
            const mates = yield* MateCredentials;
            const enroll = (serviceId?: string) =>
              Effect.gen(function* () {
                const { nonce } = yield* mates.challenge("P_MATE");
                writeChallenge(fake, "P_MATE", nonce);
                return (yield* mates.issue(
                  "P_MATE",
                  nonce,
                  serviceId === undefined ? {} : { serviceId },
                )).credential;
              });
            const first = yield* enroll("S1");
            assert.deepStrictEqual(
              [yield* refusalOf(enroll("S2")), yield* refusalOf(enroll())],
              ["not_this_projects_mate", "not_this_projects_mate"],
            );
            assert.deepStrictEqual(
              yield* mates.whoami(first),
              Option.some({ projectId: "P_MATE" }),
            );

            const again = yield* enroll("S1");
            assert.deepStrictEqual(yield* mates.whoami(first), Option.none());
            assert.deepStrictEqual(
              yield* mates.whoami(again),
              Option.some({ projectId: "P_MATE" }),
            );
          }),
        ),
    );

    it.effect("the zcp service a Mate's record names, gone from Zerops, gives its place", () => {
      // Zerops not answering about the service the record names refuses nothing: HQ is asked again.
      let serviceDown = false;
      return withMates(
        (fake) =>
          Effect.gen(function* () {
            zcpIn(fake, "S1", "P_MATE");
            zcpIn(fake, "S2", "P_MATE");
            const mates = yield* MateCredentials;
            const sql = yield* SqlClient.SqlClient;
            const enroll = (serviceId: string) =>
              Effect.gen(function* () {
                const { nonce } = yield* mates.challenge("P_MATE");
                writeChallenge(fake, "P_MATE", nonce);
                return (yield* mates.issue("P_MATE", nonce, { serviceId })).credential;
              });
            const first = yield* enroll("S1");
            fake.services.splice(
              fake.services.findIndex((service) => service.id === "S1"),
              1,
            );
            const next = yield* enroll("S2");
            assert.deepStrictEqual(yield* mates.whoami(first), Option.none());
            assert.deepStrictEqual(yield* mates.whoami(next), Option.some({ projectId: "P_MATE" }));
            const [mate] = yield* sql<{ readonly service_id: string | null }>`
              SELECT service_id FROM hq_mate WHERE project_id = 'P_MATE'`;
            assert.strictEqual(mate?.service_id, "S2");

            serviceDown = true;
            assert.strictEqual(yield* refusalOf(enroll("S1")), "ZeropsUnavailable");
            assert.deepStrictEqual(yield* mates.whoami(next), Option.some({ projectId: "P_MATE" }));
          }),
        (api) => ({
          ...api,
          service: (serviceId) => (credential) =>
            serviceDown
              ? Effect.fail(new ZeropsUnavailable({ operation: "service", message: "down" }))
              : api.service(serviceId)(credential),
        }),
      );
    });

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
              publicZone: "P_OTHER.prg1-zerops.zone",
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

    // Deleting a service reads its record DELETING before Zerops answers it not found (400
    // serviceStackNotFound): either way it is no Mate any more.
    it.effect.each(["DELETING", "DELETED"])(
      "the zcp service a Mate's record names, %s, gives its place",
      (status) =>
        withMates((fake) =>
          Effect.gen(function* () {
            zcpIn(fake, "S1", "P_MATE");
            zcpIn(fake, "S2", "P_MATE");
            const mates = yield* MateCredentials;
            const enroll = (serviceId: string) =>
              Effect.gen(function* () {
                const { nonce } = yield* mates.challenge("P_MATE");
                writeChallenge(fake, "P_MATE", nonce);
                return (yield* mates.issue("P_MATE", nonce, { serviceId })).credential;
              });
            yield* enroll("S1");
            fake.services.find((service) => service.id === "S1")!.status = status;
            const next = yield* enroll("S2");
            assert.deepStrictEqual(yield* mates.whoami(next), Option.some({ projectId: "P_MATE" }));
          }),
        ),
    );

    it.effect("of two zcp services enrolling a Mate its record names none of, one is its", () => {
      // Each presents its own nonce, and every key read waits for both: both have found the record
      // naming no service before either issues.
      const arrived = Deferred.makeUnsafe<void>();
      let reads = 0;
      const together = (api: ZeropsApi["Service"]): ZeropsApi["Service"] => ({
        ...api,
        projectEnv: () => () =>
          Effect.map(Effect.service(Presenting), (nonce) => new Map([[CHALLENGE_ENV, nonce]])),
        tokenProjects: (orgId, tokenId) => (credential) =>
          Effect.andThen(
            Effect.suspend(() =>
              ++reads === 2 ? Deferred.succeed(arrived, undefined) : Effect.void,
            ),
            Effect.andThen(Deferred.await(arrived), api.tokenProjects(orgId, tokenId)(credential)),
          ),
      });
      return withMates(
        (fake) =>
          Effect.gen(function* () {
            keyOn(fake, "tok-key", "P_MATE");
            const mates = yield* MateCredentials;
            const sql = yield* SqlClient.SqlClient;
            const present = (serviceId: string) =>
              Effect.gen(function* () {
                const { nonce } = yield* mates.challenge("P_MATE");
                return yield* mates
                  .issue("P_MATE", nonce, { keyTokenId: "tok-key", serviceId })
                  .pipe(
                    Effect.provideService(Presenting, nonce),
                    refusalOf,
                    Effect.orElseSucceed(() => serviceId),
                  );
              });
            const answers = yield* Effect.all([present("S1"), present("S2")], {
              concurrency: "unbounded",
            });
            const [mate] = yield* sql<{ readonly service_id: string }>`
              SELECT service_id FROM hq_mate WHERE project_id = 'P_MATE'`;
            assert.deepStrictEqual(
              answers.toSorted(),
              [mate!.service_id, "not_this_projects_mate"].toSorted(),
            );
          }),
        together,
      );
    });

    it.effect(
      "refuses a project outside HQ's org or gone from Zerops as no Mate, and a Mate gone at the credential",
      () =>
        withMates((fake) =>
          Effect.gen(function* () {
            const mates = yield* MateCredentials;
            // Neither tells anyone whether the project exists: neither is HQ's Mate.
            assert.strictEqual(yield* refusalOf(mates.challenge("P_ELSE")), "not_a_mate");
            assert.strictEqual(yield* refusalOf(mates.challenge("P_NONE")), "not_a_mate");

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
