import { describe, expect, it } from "vite-plus/test";
import { mateServerCompatibility, MINIMUM_MATE_SERVER_VERSION } from "./serverCompatibility.ts";

describe("Mate GUI server compatibility", () => {
  it.each(["0.11.0", "v0.11.0+build.7", "0.12.0-dev.abc", "1.0.0"])(
    "accepts supported protocol version %s without requiring GUI version equality",
    (version) => expect(mateServerCompatibility(version)).toBe("supported"),
  );
  // Every one of these has no `/api/auth/zerops-throwaway`, and this client
  // will not hand a container a person's own Zerops token to get in instead.
  it.each(["0.2.9", "0.6.0", "0.7.0", "0.10.0", "0.11.0-rc.1"])(
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
  it("requires the server that carries the throwaway door and the role re-check", () => {
    expect(MINIMUM_MATE_SERVER_VERSION).toBe("0.11.0");
  });
});
