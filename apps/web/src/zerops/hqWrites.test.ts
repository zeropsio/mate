import { describe, expect, it } from "vite-plus/test";
import { holdHqWrites, hqProjectIdOf, hqWritesOf } from "./hqWrites";
import { makeHqApi } from "@t3tools/client-runtime/zerops/hq";

describe("the HQ that accepts an account's lifecycle writes", () => {
  it("keeps a replacement writer when the previous navigation releases", () => {
    const writer = (address: string) =>
      makeHqApi({
        address,
        fetch: globalThis.fetch,
        throughDoor: async (use) => use("token"),
        openSocket: () => {
          throw new Error("Not opened by this test");
        },
      });
    const first = writer("https://first.invalid");
    const next = writer("https://next.invalid");
    const releaseFirst = holdHqWrites("org", first, "first-hq");
    const releaseNext = holdHqWrites("org", next, "next-hq");
    releaseFirst();
    expect(hqWritesOf("org")).toBe(next);
    expect(hqProjectIdOf("org")).toBe("next-hq");
    releaseNext();
    expect(hqWritesOf("org")).toBeNull();
    expect(hqProjectIdOf("org")).toBeNull();
  });
});
