import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

/** v0.11.0 is the first server whose only door is the throwaway one: it reads
 * who minted a rights-less token, looks their role up with its own key, and
 * re-checks it on a timer (guide 3.2–3.3). An older server has no
 * `/api/auth/zerops-throwaway` at all, and the client has nothing else to
 * present — it will not hand a container a person's own Zerops token to get in
 * (guide 3.5). So this is a mandatory protocol change, and a Mate below it
 * shows the existing "restart the container to check for updates" path.
 * Raise only for a documented mandatory protocol change, independently of the GUI
 * release. Optional server improvements do not raise this. */
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
