import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

/** The oldest server the client works with. A Mate below it shows the existing "restart the
 * container to check for updates" path. Raise only for a documented mandatory protocol change,
 * independently of the GUI release. Optional server improvements do not raise this. */
export const MINIMUM_MATE_SERVER_VERSION = "0.11.0";

export function mateServerCompatibility(
  serverVersion: string,
): "supported" | "too-old" | "unknown" {
  // Build metadata does not affect precedence. An unrecognized development version
  // is not evidence of incompatibility; the actual protocol still has to succeed.
  const version = serverVersion.trim().split("+", 1)[0]!;
  if (!parseSemver(version)) return "unknown";
  return compareSemverVersions(version, MINIMUM_MATE_SERVER_VERSION) < 0 ? "too-old" : "supported";
}
