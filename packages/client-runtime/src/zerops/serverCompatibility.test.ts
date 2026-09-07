import { describe, expect, it } from "vite-plus/test";
import { mateServerCompatibility, MINIMUM_MATE_SERVER_VERSION } from "./serverCompatibility.ts";

describe("Mate GUI server compatibility", () => {
  it.each(["0.7.0", "v0.7.0+build.7", "0.8.0-dev.abc", "0.10.0", "1.0.0"])(
    "accepts supported protocol version %s without requiring GUI version equality",
    (version) => expect(mateServerCompatibility(version)).toBe("supported"),
  );
  it.each(["0.2.9", "0.3.0", "0.4.0", "0.6.0", "0.7.0-rc.1"])(
    "rejects %s below the documented minimum",
    (version) => {
      expect(mateServerCompatibility(version)).toBe("too-old");
    },
  );
  it.each(["", "development", "garbage"])(
    "does not infer an upgrade requirement from %s",
    (version) => {
      expect(mateServerCompatibility(version)).toBe("unknown");
    },
  );
  it("requires the published account lifecycle server", () => {
    expect(MINIMUM_MATE_SERVER_VERSION).toBe("0.7.0");
  });
});
