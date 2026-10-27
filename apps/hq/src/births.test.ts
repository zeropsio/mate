import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { environmentBirths } from "./births.ts";

const fixture = Effect.gen(function* () {
  const url = yield* (yield* TempPostgres).createMigratedDatabase;
  const context = yield* Layer.build(activeCoreLayer(url));
  yield* untilActive.pipe(Effect.provide(context));
  const sql = Context.get(context, SqlClient.SqlClient);
  const [app] = yield* sql<{
    readonly id: string;
  }>`INSERT INTO hq_app(name,created_by) VALUES ('Shop','owner') RETURNING id::text`;
  yield* sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${app!.id}::uuid,'web','owner')`;
  yield* sql`INSERT INTO hq_environment(id,app_id,target,tier,name,sources,branch,delivery,created_by)
    VALUES ('git-production',${app!.id}::uuid,'git','production','production',ARRAY['release'],'main','direct','owner')`;
  yield* sql`INSERT INTO hq_rollout(app_id,cause,environment_id,environment_created_at,by,planned_at)
    SELECT app_id,'env_added',id,created_at,'owner',now() FROM hq_environment`;
  const birth = Effect.map(environmentBirths(sql), (births) => births.get("git-production"));
  const verify = sql`INSERT INTO hq_repo_remote(app_id,repo,url,url_key,host,sealed,key_id,kept_by,kept_at)
    VALUES (${app!.id}::uuid,'web','https://fixture.invalid/web.git','fixture.invalid/web','other',decode('01','hex'),'fixture','owner',now())`;
  return { sql, birth, verify };
});
describe("environment birth", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("A Git birth ends on verified remotes without a Zerops deploy token.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        assert.deepStrictEqual(yield* f.birth, { ended: false });
        yield* f.verify;
        assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_deploy_token`).length, 0);
        assert.deepStrictEqual(yield* f.birth, { ended: true });
      }),
    );
    it.effect.each([
      { change: "missing", update: "sealed=NULL,key_id=NULL" },
      { change: "refused", update: "invalid_since=now()" },
      { change: "expired", update: "expires_at=now()-interval '1 minute'" },
    ])("A $change remote cannot finish a Git birth.", ({ update }) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.verify;
        yield* f.sql.unsafe(`UPDATE hq_repo_remote SET ${update}`);
        assert.deepStrictEqual(yield* f.birth, { ended: false });
      }),
    );
    it.effect("A verified Git birth still waits for its planning and worker receipts.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.verify;
        yield* f.sql`UPDATE hq_rollout SET planned_at=NULL`;
        assert.deepStrictEqual(yield* f.birth, { ended: false });
        yield* f.sql`UPDATE hq_rollout SET planned_at=now()`;
        yield* f.sql`INSERT INTO hq_deploy_job(rollout_id,environment_id,kind,repo,sha,state,ord)
        SELECT id,'git-production','push','web',${"a".repeat(40)},'queued',0 FROM hq_rollout`;
        assert.deepStrictEqual(yield* f.birth, { ended: false });
        yield* f.sql`UPDATE hq_deploy_job SET state='pushed',ended_at=now()`;
        assert.deepStrictEqual(yield* f.birth, { ended: true });
      }),
    );
  });
});
