/** The `/usage` search params as the page's scope; blank or non-string values are absent. */
import { EnvironmentId } from "@t3tools/contracts";

import type { UsageScope } from "../components/usage/usageDimensions";

function presentString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function validateUsageSearch(raw: Record<string, unknown>): UsageScope {
  const person = presentString(raw.person);
  const project = presentString(raw.project);
  const mate = presentString(raw.mate);
  return {
    ...(person === undefined ? {} : { person }),
    ...(project === undefined ? {} : { project }),
    ...(mate === undefined ? {} : { mate: EnvironmentId.make(mate) }),
  };
}
