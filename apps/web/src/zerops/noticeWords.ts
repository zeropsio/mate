import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { MateHqKey } from "@t3tools/contracts";
import { MATE_REFUSAL_REASK_MS } from "@t3tools/shared/mateLink";
import { formatShortTimestamp } from "../timestampFormat";
import { admissionRefusalWords } from "@t3tools/client-runtime/data";
import { projectLimitError } from "@t3tools/client-runtime/data";

/** A named window as a person says it: "7-day" is "weekly"; a stand-in that names none is null. */
function windowWords(window: string | null | undefined): string | null {
  if (window == null) return null;
  if (/^7-day\b/i.test(window)) return window.replace(/^7-day/i, "weekly");
  return /^\d+-(?:hour|day)\b/i.test(window) ? window : null;
}

/** Whose limit, and which: "the Claude limit", "Claude's weekly limit", "the coding agent's limit". */
function limitName(provider: string, window: string | null | undefined): string {
  const named = windowWords(window);
  if (provider === "coding agent")
    return named === null ? "the coding agent's limit" : `the coding agent's ${named} limit`;
  return named === null ? `the ${provider} limit` : `${provider}'s ${named} limit`;
}

export function usageLimitWords(
  provider: string,
  reset?: string,
  mateName = "The Mate",
  window?: string | null,
): string {
  const name = limitName(provider, window);
  return reset === undefined
    ? `${mateName} hit ${name}.`
    : `${mateName} hit ${name} — can continue at ${reset}.`;
}

/** Expected refusals have one voice across the web menu, conversation and jump box. */
export function mateFailureWords(
  error: string,
  driver?: string | null,
  mateName = "The Mate",
): string {
  const limit = projectLimitError(error);
  if (limit !== null) return usageLimitWords(limit.provider, undefined, mateName);
  return admissionRefusalWords(error, driver, mateName) ?? error;
}

/** A dated refusal is a record, never a claim about admission or work now. */
export function usageLimitHistoryWords(
  provider: string,
  at: string | null,
  resetsAt: string | null,
  mateName: string,
  timestampFormat: TimestampFormat,
  window?: string | null,
): string {
  const date = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
      new Date(iso),
    );
  const reset =
    resetsAt === null
      ? ""
      : `; reset ${formatShortTimestamp(resetsAt, timestampFormat)} ${date(resetsAt)}`;
  return `${mateName} hit ${limitName(provider, window)}${at === null ? "" : ` on ${date(at)}`}${reset}.`;
}

/** While HQ refuses the key for a safety rule nobody acts in the Mate (`actingIn`). */
const NOBODY_ACTS = "Until then, nobody can act here.";
/** Any other refusal leaves who acts as it was; only the link is down, so tickets wait. */
const SIGN_INS_WAIT = "New sign-ins wait until HQ accepts it.";
/** A refused key is not tried again on a timer of seconds: the Mate asks HQ again only then. */
const ASKS_AGAIN = `It asks HQ again as soon as its variables change in Zerops or it restarts, otherwise every ${MATE_REFUSAL_REASK_MS / 60_000} minutes.`;

/**
 * What HQ's word on the Mate's key tells the people in it: which part said no or did not answer,
 * and what its owner can do. The key is `ZCP_API_KEY` on the project's `zcp` service, read live.
 */
export function hqKeyWords(
  hqKey: MateHqKey,
  name: string,
): { readonly headline: string; readonly secondary: string } {
  if (hqKey.state === "unresolved")
    return {
      headline: `HQ couldn't check ${name}'s key.`,
      secondary:
        "Zerops or HQ didn't answer. The Mate tries again on its own; new sign-ins wait until then.",
    };
  switch (hqKey.reason) {
    case "key_refused":
      return {
        headline: `${name}'s key was refused.`,
        secondary: `Zerops or HQ no longer accepts its access token. Its owner can set a new one as ZCP_API_KEY on the Zerops Control Plane service. ${SIGN_INS_WAIT} ${ASKS_AGAIN}`,
      };
    case "key_too_wide":
      return {
        headline: `HQ doesn't accept ${name}'s key.`,
        secondary: `Its access token isn't limited to this one project. Its owner can set one that is as ZCP_API_KEY on the Zerops Control Plane service. ${NOBODY_ACTS} ${ASKS_AGAIN}`,
      };
    case "key_not_sensitive":
      return {
        headline: `HQ doesn't accept ${name}'s key.`,
        secondary: `Its access token can be read in clear among the project's variables. Its owner can mark ZCP_API_KEY as sensitive in Zerops. ${NOBODY_ACTS} ${ASKS_AGAIN}`,
      };
    case "not_a_mate":
      return {
        headline: `HQ doesn't hold this project as a Mate.`,
        secondary: `HQ holds ${name}'s project as neither a Mate nor a devstage, so it refuses the link. ${SIGN_INS_WAIT} ${ASKS_AGAIN}`,
      };
    default:
      return {
        headline: `HQ doesn't accept ${name}'s key.`,
        secondary: `HQ's reason: ${hqKey.reason}. ${SIGN_INS_WAIT} ${ASKS_AGAIN}`,
      };
  }
}
