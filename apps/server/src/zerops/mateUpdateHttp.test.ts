import { describe, expect, it } from "@effect/vitest";
import { isLocalUpdateRequest } from "./mateUpdateHttp.ts";
describe("zcp's update control door", () => {
  it.each([
    ["127.0.0.1", {}, true],
    ["::1", {}, true],
    ["::ffff:127.0.0.1", {}, true],
    ["192.168.1.1", {}, false],
    [undefined, {}, false],
    ["127.0.0.1", { "x-real-ip": "127.0.0.1" }, false],
    ["127.0.0.1", { "x-forwarded-for": "8.8.8.8" }, false],
    ["127.0.0.1", { origin: "https://mate.example" }, false],
  ] as const)("%s with %j is admitted: %s", (address, headers, expected) =>
    expect(isLocalUpdateRequest(address, headers)).toBe(expected),
  );
});
