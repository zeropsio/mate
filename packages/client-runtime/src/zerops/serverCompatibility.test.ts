import { describe, expect, it } from "vite-plus/test";
import { mateServerCompatibility, MINIMUM_MATE_SERVER_VERSION } from "./serverCompatibility.ts";

describe("Mate GUI server compatibility", () => {
  it("the shared HQ web client requires Mate 0.16.0 or newer", () => {
    expect(MINIMUM_MATE_SERVER_VERSION).toBe("0.16.0");
  });
  it.each(["0.16.0", "v0.16.0+build.7", "0.17.0-dev.abc", "1.0.0"])(
    "accepts supported protocol version %s without requiring GUI version equality",
    (version) => expect(mateServerCompatibility(version)).toBe("supported"),
  );
  // The shared HQ cutover requires Mate 0.16.0 (release contract 2).
  it.each([
    "0.2.9",
    "0.6.0",
    "0.7.0",
    "0.10.0",
    "0.11.0-rc.1",
    "0.11.0",
    "v0.11.0+build.7",
    "0.12.0-dev.abc",
    "0.15.101",
    "0.16.0-rc.1",
  ])("rejects %s below the documented minimum", (version) => {
    expect(mateServerCompatibility(version)).toBe("too-old");
  });
  it.each(["", "development", "garbage"])(
    "does not infer an upgrade requirement from %s",
    (version) => {
      expect(mateServerCompatibility(version)).toBe("unknown");
    },
  );
});
