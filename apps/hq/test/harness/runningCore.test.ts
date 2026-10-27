// @effect-diagnostics nodeBuiltinImport:off -- check the fixture's real listening socket.
import * as NodeHttp from "node:http";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { startCore, untilHealth } from "./runningCore.ts";
import { tempPostgresLayer } from "./tempPostgres.ts";

it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
  it.effect("HQ fixture requests address the listener that the fixture started", () =>
    Effect.gen(function* () {
      const server = NodeHttp.createServer();
      const core = yield* startCore(true, { httpServer: server });
      const address = server.address();
      assert.isNotNull(address);
      assert.notTypeOf(address, "string");
      if (address === null || typeof address === "string") return;
      assert.strictEqual(address.address, new URL(core.origin).hostname);
      assert.strictEqual(address.port, Number(new URL(core.origin).port));
      yield* untilHealth(core.call, "active");
    }),
  );
});
