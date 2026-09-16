import type { ZeropsCandidateGroup } from "@t3tools/client-runtime/zerops/candidates";
import {
  mateOnlyOwnerOpensIt,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";

export interface ZeropsCandidatePresentation {
  readonly label: string;
  readonly tone: "ok" | "busy" | "attention" | "off";
  readonly action: string | null;
  /** One line in place of the verb, when there is no verb to offer. */
  readonly notice?: string;
}

/**
 * What a row says and offers.
 *
 * Whose Mate it is outranks whatever its container is doing (D5): a person who
 * cannot open it is not waiting for it to start, and "Ready · Connect" would
 * be an invitation the door refuses. So a `listed` Mate keeps its place in the
 * list and says whose it is instead.
 */
export function zeropsCandidatePresentation(
  group: ZeropsCandidateGroup,
  options: {
    readonly visibility?: RoleMateVisibility | undefined;
    readonly ownerName?: string | undefined;
  } = {},
): ZeropsCandidatePresentation {
  if (options.visibility === "listed") {
    return {
      label: "Not yours",
      tone: "off",
      action: null,
      notice: mateOnlyOwnerOpensIt(options.ownerName),
    };
  }
  switch (group) {
    case "connected":
      return { label: "Connected", tone: "ok", action: "Open" };
    case "ready":
      return { label: "Ready", tone: "busy", action: "Connect" };
    case "provisioning":
      return { label: "Starting", tone: "attention", action: null };
    case "unavailable":
      return { label: "Unavailable", tone: "off", action: null };
  }
}
