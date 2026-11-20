import { expect, it } from "vite-plus/test";

import { engineRouteOf } from "./engineHost.ts";

// witness: packages/client-runtime/src/data/engineHost.ts | protocol === null ? { kind: "update" } → protocol === null ? { kind: "unknown" }
it("ST56: A Mate's conversation is read on the engine when its door names this build's protocol, and on the update route when it names only a newer one", () => {
  expect(engineRouteOf({ mateEngine: 1 })).toEqual({ kind: "engine", protocol: 1 });
  expect(engineRouteOf({ mateEngine: 2 })).toEqual({ kind: "update" });
});
