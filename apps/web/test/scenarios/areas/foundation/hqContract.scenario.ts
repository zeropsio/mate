// @effect-diagnostics nodeBuiltinImport:off -- the scenario harness speaks to disposable loopback services.
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { seedCoreWorld } from "../../harness/coreSeed.ts";
import { startScenarioCore } from "../../harness/hqCore.ts";
import { serve } from "../../harness/http.ts";
import { personDoor } from "../../harness/mateAccess.ts";
import { ZeropsFake } from "../../fakes/zerops.ts";
import { definePerson } from "../../fakes/zeropsWorld.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.effect(
  "Decision: The harness opens the door exactly as the product client does under rev 7 (`/user/info` identity once, no org key) and every HQ verb the harness or a fixture sends carries the calling person's `accessToken` the way the client does; the fake Zerops world answers `/user/info` and the membership/role reads HQ's fresh checks make for each defined person (owner OWNER, dev, reader READ_ONLY), so a scenario that acts as `reader` is refused where the product refuses it.",
  () =>
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
      for (const token of ["personal", "personal-reader", "personal-dev"]) {
        expect([...fake.requestsByCredential.get(token)!.entries()]).toEqual([
          ["GET /user/info", 1],
        ]);
      }
      const created = yield* core.call("POST", "/api/apps", {
        session: owner,
        body: { name: "Owner app" },
      });
      expect(created.status, encodeJson(created.body)).toBe(201);
      const devCreated = yield* core.call("POST", "/api/apps", {
        session: dev,
        body: { name: "Dev app" },
      });
      expect(devCreated.status, encodeJson(devCreated.body)).toBe(201);
      const refused = yield* core.call("POST", "/api/apps", {
        session: reader,
        body: { name: "Reader app" },
      });
      expect(refused.status, encodeJson(refused.body)).toBe(403);
      expect(fake.requestsByCredential.get("personal")?.get("GET /user/info")).toBe(2);
      expect(fake.requestsByCredential.get("personal-reader")?.get("GET /user/info")).toBe(2);
      expect(fake.requestsByCredential.get("personal-dev")?.get("GET /user/info")).toBe(2);
    }).pipe(Effect.scoped),
);
