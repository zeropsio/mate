// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp does: over HTTP and git.
/**
 * Mates in the running Core (`runningCore.ts`) as the changes tests set them up: in an application,
 * enrolled, with a repository and a change; and Core's database read as the tests check it.
 *
 * @module test/harness/mates
 */
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

import { type Call, enrollMate } from "./runningCore.ts";
import type { FakeWorld } from "./zeropsFake.ts";

/** The owner makes an application and attaches `projectId` to it as a Mate, which enrolls. */
export const mateInApp = (
  call: Call,
  fake: FakeWorld,
  owner: string,
  projectId: string,
  appName: string,
) =>
  Effect.gen(function* () {
    const app = yield* call("POST", "/api/apps", { session: owner, body: { name: appName } });
    const appId = (app.body as { readonly id: string }).id;
    const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
      session: owner,
      body: { projectId, kind: "mate", mate: { name: "Ada", face: "face-1" } },
    });
    assert.strictEqual(attached.status, 201);
    const credential = yield* enrollMate(call, fake, projectId);
    return { appId, credential, auth: { authorization: `Mate ${credential}` } };
  });

/** Another project of the org beside the rig's own. */
export const addProject = (fake: FakeWorld, id: string) =>
  fake.projects.push({
    id,
    orgId: "ORG",
    name: id,
    status: "ACTIVE",
    tags: [],
    userRoles: [],
    publicZone: `${id}.prg1-zerops.zone`,
  });

/** git's address of a repository at Core, the Mate's credential in it. */
export const remoteOf = (origin: string, credential: string, appId: string, repo: string) =>
  `${origin.replace("http://", `http://mate:${credential}@`)}/git/${appId}/${repo}.git`;

/** The rows `query` answers on Core's database, once `matches` holds of them; fails after ten seconds. */
export const rowsWhere = (
  url: string,
  query: string,
  matches: (rows: ReadonlyArray<Record<string, unknown>>) => boolean,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* PgConnection.make({ url: Redacted.make(url) });
      return yield* db.query(query).pipe(
        Effect.map((result) => result.rows as ReadonlyArray<Record<string, unknown>>),
        Effect.filterOrFail(matches),
        Effect.retry(Schedule.spaced(Duration.millis(50))),
        Effect.timeout(Duration.seconds(10)),
      );
    }),
  ).pipe(Effect.orDie);

/** A Mate with the repository `appdev` and its open change 1 there. */
export const mateWithChange = (call: Call, fake: FakeWorld, owner: string, projectId = "P_MATE") =>
  Effect.gen(function* () {
    const mate = yield* mateInApp(call, fake, owner, projectId, "Shop");
    yield* call("POST", "/api/mate/repos", { headers: mate.auth, body: { name: "appdev" } });
    yield* call("POST", "/api/mate/changes", {
      headers: mate.auth,
      body: { repo: "appdev", title: "Mate: appdev" },
    });
    return mate;
  });
