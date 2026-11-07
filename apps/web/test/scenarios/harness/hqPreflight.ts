// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- one real test HQ is checked before scenario fan-out.
import * as NodeAssert from "node:assert/strict";
import * as NodeURL from "node:url";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { readHqRef } from "../../../../../scripts/hq-ref.ts";
import { ZeropsFake } from "../fakes/zerops.ts";
import { definePerson } from "../fakes/zeropsWorld.ts";
import { seedCoreWorld } from "./coreSeed.ts";
import { startScenarioCore } from "./hqCore.ts";
import { serve } from "./http.ts";
import { personDoor } from "./mateAccess.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Exercise the same identity and authorization calls the scenario harness makes. */
export const verifyHqContract = () =>
  Effect.gen(function* () {
    const fake = new ZeropsFake(seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG"));
    definePerson(fake.world, "owner", { role: "OWNER" });
    definePerson(fake.world, "dev", { role: "Developer" });
    definePerson(fake.world, "reader", { role: "READ_ONLY" });
    const api = yield* Effect.acquireRelease(
      Effect.promise(() => serve(fake.handle, fake.socket)),
      (server) => Effect.promise(server.close),
    );
    const core = yield* startScenarioCore({
      baseUrl: `${api.origin}/api/rest/public`,
      world: fake.world,
    });
    const owner = yield* personDoor(core, "owner");
    const reader = yield* personDoor(core, "reader");
    const dev = yield* personDoor(core, "dev");
    // An Owner's sign-in also mints the organisation's read token HQ keeps; other roles only identify.
    NodeAssert.deepEqual(
      [...fake.requestsByCredential.get("personal")!.entries()],
      [
        ["GET /user/info", 1],
        ["POST /client/ORG/integration-token", 1],
      ],
    );
    for (const token of ["personal-reader", "personal-dev"]) {
      NodeAssert.deepEqual(
        [...fake.requestsByCredential.get(token)!.entries()],
        [["GET /user/info", 1]],
      );
    }
    const created = yield* core.call("POST", "/api/apps", {
      session: owner,
      body: { name: "Owner app" },
    });
    NodeAssert.equal(created.status, 201, encodeJson(created.body));
    const devCreated = yield* core.call("POST", "/api/apps", {
      session: dev,
      body: { name: "Dev app" },
    });
    NodeAssert.equal(devCreated.status, 201, encodeJson(devCreated.body));
    const refused = yield* core.call("POST", "/api/apps", {
      session: reader,
      body: { name: "Reader app" },
    });
    NodeAssert.equal(refused.status, 403, encodeJson(refused.body));
    NodeAssert.equal(fake.requestsByCredential.get("personal")?.get("GET /user/info"), 2);
    NodeAssert.equal(fake.requestsByCredential.get("personal-reader")?.get("GET /user/info"), 2);
    NodeAssert.equal(fake.requestsByCredential.get("personal-dev")?.get("GET /user/info"), 2);
  }).pipe(Effect.scoped);

/** Vitest runs this once before a local scenario process starts its cases. */
export default async function preflight() {
  const root = NodeURL.fileURLToPath(new URL("../../../../../", import.meta.url));
  const ref = readHqRef(root);
  // A producer's successful job is the receipt; never reuse it for another pinned revision.
  if (process.env.GITHUB_ACTIONS === "true" && process.env.MATE_HQ_PREFLIGHT_SHA === ref) return;
  try {
    await Effect.runPromise(verifyHqContract());
  } catch (error) {
    throw new Error(`mate-hq contract preflight for ${ref} failed: ${String(error)}`, {
      cause: error,
    });
  }
}

if (import.meta.main) {
  try {
    await preflight();
    console.log("mate-hq contract preflight passed");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
