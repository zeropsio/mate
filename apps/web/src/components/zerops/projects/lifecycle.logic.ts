import type { GroupFlow } from "@t3tools/client-runtime/zerops";

import type { ChangesUnknown } from "./projectsView.logic";

/** Presentation of shared code; a zero count does not prove what any environment runs. */
export function lifecycleMain(input: {
  readonly main: GroupFlow["main"];
  readonly awaiting: boolean;
  readonly unknown: ChangesUnknown | undefined;
}) {
  if (input.unknown !== undefined)
    return {
      state: "unknown" as const,
      heading: "Merged code cannot be verified",
      detail:
        input.unknown === "failed"
          ? "HQ could not read the project's changes. Environment readings are separate."
          : "The project's changes have not been verified for this account.",
    };
  if (input.awaiting || input.main.hasCode === undefined)
    return {
      state: "reading" as const,
      heading: "Reading merged code…",
      detail: "What is merged is not known yet.",
    };
  if (!input.main.hasCode)
    return {
      state: "empty" as const,
      heading: "No merged code yet",
      detail: "Review a Mate's change to add its work to main.",
    };
  return {
    state: "merged" as const,
    heading: "Merged code",
    detail: "Each repository's main is shared. A release selects its code for production.",
  };
}
