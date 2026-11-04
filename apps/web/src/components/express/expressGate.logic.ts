/**
 * Whether a person sees Adobe Express: a Labs switch in Settings, off by default, in a build that
 * carries Adobe's key. While it is not on, no way into Express shows and the conversation is not
 * read for it.
 */
export type ExpressGate = "off" | "on" | "missing-key";

export function expressGate(switchOn: boolean, clientId: string | null): ExpressGate {
  if (!switchOn) return "off";
  return clientId === null ? "missing-key" : "on";
}

/** The Labs row's line: what Express needs, or why this build cannot offer it. */
export function expressLabNote(gate: ExpressGate): string {
  return gate === "missing-key"
    ? "Adobe Express isn't available in this build."
    : "Design pictures with Adobe Express in the side panel. Needs an Adobe account; Adobe hasn't approved the integration yet, so its editor shows a notice.";
}
