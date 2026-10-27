import { describe, expect, it } from "vite-plus/test";

import { engineRouteOf } from "./engineHost.ts";

describe("where a Mate's conversation is read", () => {
  it.each([
    {
      name: "the Mate's update when its door names no engine",
      mateEngine: undefined,
      route: { kind: "older" },
    },
    {
      name: "the engine when its door names this build's protocol",
      mateEngine: 1,
      route: { kind: "engine", protocol: 1 },
    },
    {
      name: "the update route when its door names only a newer protocol",
      mateEngine: 2,
      route: { kind: "update" },
    },
  ])("$name", ({ mateEngine, route }) => {
    expect(engineRouteOf(mateEngine === undefined ? {} : { mateEngine })).toEqual(route);
  });
});
