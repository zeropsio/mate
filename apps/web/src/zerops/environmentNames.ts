/** The names a picker reads from the route's Mate directory, never from candidate discovery. */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsMateDirectory } from "./mateIdentities";

export function zeropsEnvironmentNames(
  directory: ZeropsMateDirectory,
): ReadonlyMap<EnvironmentId, string> {
  return new Map(
    [...directory].flatMap(([environmentId, mate]) =>
      mate === null || mate.name.trim() === "" ? [] : [[environmentId, mate.name] as const],
    ),
  );
}
