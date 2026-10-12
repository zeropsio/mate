import { type ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { formatProviderDriverKindLabel } from "../../providerModels";

/**
 * Why the conversation's agent may not answer as it should: the dot on the composer's model
 * control, and what its menu says. It stands while the status does; there is nothing to dismiss.
 */
export interface ProviderAvailability {
  readonly instanceId: ProviderInstanceId;
  readonly tone: "warning" | "error";
  /** What the dot is named and the menu's note heads with. */
  readonly title: string;
  /** Why, when it says more than the title; null when the title is all there is. */
  readonly message: string | null;
  /** The agent's setup can fix it: the note offers "Open coding agent setup". */
  readonly setup: boolean;
}

/** Unsupported and broken versions fail mid-turn, so they warn even when ready. */
function getIncompatibleVersion(status: ServerProvider) {
  const compatibility = status.compatibilityAdvisory;
  return compatibility?.status === "broken" ||
    (status.status === "ready" && compatibility?.status === "unsupported")
    ? compatibility
    : null;
}

export function hasProviderSetup(status: ServerProvider): boolean {
  return (
    status.driver === "antigravity" ||
    status.setup?.canAuthenticate === true ||
    status.setup?.canInstall === true
  );
}

function providerNameOf(status: ServerProvider): string {
  return status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
}

/** Broken-version guidance takes precedence over startup failures it can cause. */
export function getProviderStatusMessage(status: ServerProvider): string {
  if (status.compatibilityAdvisory?.status === "broken" && status.compatibilityAdvisory.message) {
    return status.compatibilityAdvisory.message;
  }
  if (status.message) return status.message;
  const providerName = providerNameOf(status);
  if (!status.installed && hasProviderSetup(status)) {
    return `Open coding agent setup to install ${formatProviderDriverKindLabel(status.driver)} on this environment.`;
  }
  return status.status === "ready"
    ? "No models are available for this coding agent."
    : status.status === "error"
      ? `${providerName} is unavailable.`
      : `${providerName} has limited availability.`;
}

/** What the agent's status says of its availability, or null when it says nothing is wrong. */
export function providerAvailability(status: ServerProvider | null): ProviderAvailability | null {
  if (!status || status.status === "disabled") return null;
  const incompatible = getIncompatibleVersion(status);
  if (incompatible === null && status.status === "ready") return null;
  // Antigravity checks saved credentials when a session starts. Its local
  // health check leaves auth unknown after a restart, which is not a failure.
  if (
    incompatible === null &&
    status.driver === "antigravity" &&
    status.installed &&
    status.status === "warning" &&
    status.auth.status === "unknown"
  ) {
    return null;
  }
  const providerName = providerNameOf(status);
  const tone =
    incompatible?.status === "broken" || (incompatible === null && status.status === "error")
      ? "error"
      : "warning";
  const title = incompatible
    ? `${providerName}${status.version ? ` ${status.version}` : ""} is ${incompatible.status === "broken" ? "known to be broken" : "unsupported"}`
    : tone === "error"
      ? `${providerName} is unavailable`
      : `${providerName} has limited availability`;
  const message = incompatible?.message ?? getProviderStatusMessage(status);
  return {
    instanceId: status.instanceId,
    tone,
    title,
    message: message.trim() === `${title}.` ? null : message,
    setup: hasProviderSetup(status),
  };
}
