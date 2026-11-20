import { expect, it } from "vite-plus/test";

import { MINIMUM_MATE_SERVER_VERSION, mateServerCompatibility } from "./serverCompatibility.ts";

// witness: packages/client-runtime/src/zerops/serverCompatibility.ts | return compareSemverVersions(version, MINIMUM_MATE_SERVER_VERSION) < 0 ? "too-old" : "supported"; → return compareSemverVersions(version, MINIMUM_MATE_SERVER_VERSION) <= 0 ? "too-old" : "supported";
it("ZV128: A Mate at or above the protocol minimum is opened whatever its GUI version; one below is refused", () => {
  const [major = 0, minor = 0] = MINIMUM_MATE_SERVER_VERSION.split(".").map(Number);
  for (const version of [
    MINIMUM_MATE_SERVER_VERSION,
    `${MINIMUM_MATE_SERVER_VERSION}+gui.42`,
    `${major}.${minor + 1}.0-dev.abc`,
    `${major + 1}.0.0`,
  ])
    expect(mateServerCompatibility(version), version).toBe("supported");
  for (const version of [`${MINIMUM_MATE_SERVER_VERSION}-rc.1`, "0.0.0"])
    expect(mateServerCompatibility(version), version).toBe("too-old");
});
