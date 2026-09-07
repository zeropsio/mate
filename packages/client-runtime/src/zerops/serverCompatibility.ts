import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

/** v0.3.0 first reports the Zerops project ID in the public descriptor (1e5cb5948).
 * The GUI must verify that an address still belongs to the selected project before
 * sending account credentials. Raise only for a documented mandatory protocol change,
 * independently of the GUI release. Optional server improvements do not raise this. */
export const MINIMUM_MATE_SERVER_VERSION = "0.3.0";

export function mateServerCompatibility(
  serverVersion: string,
): "supported" | "too-old" | "unknown" {
  // Build metadata does not affect precedence. An unrecognized development version
  // is not evidence of incompatibility; the actual protocol still has to succeed.
  const version = serverVersion.trim().split("+", 1)[0]!;
  if (!parseSemver(version)) return "unknown";
  return compareSemverVersions(version, MINIMUM_MATE_SERVER_VERSION) < 0 ? "too-old" : "supported";
}
