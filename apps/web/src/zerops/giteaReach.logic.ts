/**
 * Whether the app can fetch its own Gitea session for the account, and why not where it cannot
 * (unknown is not empty, but a wait with a cause says its cause): the session's demand runs only
 * once the account's Gitea has a public web address and a broker with one. A Gitea that will never
 * get there on its own — none in the organization, no broker, a subdomain turned off — is named,
 * never shown as "Reading…" for ever. Pure.
 */
import type { ZeropsGiteaState } from "@t3tools/client-runtime/zerops";

export type GiteaReach =
  /** The Gitea project's services are not read yet. */
  | "unknown"
  | "none"
  | "setting-up"
  | "unavailable"
  | "no-address"
  | "no-broker"
  | "no-broker-address"
  /** The session's demand runs: a token is on its way, or held. */
  | "ready";

export function giteaReach(input: {
  /** The organization holds a Gitea project, its services read or not. */
  readonly holdsGitea: boolean;
  /** Its state, once its services are read. */
  readonly state:
    | Pick<ZeropsGiteaState, "phase" | "url" | "brokerUrl" | "brokerImported">
    | undefined;
}): GiteaReach {
  if (!input.holdsGitea) return "none";
  const { state } = input;
  if (state === undefined) return "unknown";
  if (state.phase === "provisioning") return "setting-up";
  if (state.phase === "unavailable") return "unavailable";
  if (state.url === undefined) return "no-address";
  if (state.brokerUrl === undefined)
    return state.brokerImported ? "no-broker-address" : "no-broker";
  return "ready";
}

/** What a page that reads through Gitea says of a Gitea it cannot reach; null while it can. */
export function giteaReachWords(
  reach: GiteaReach,
): { readonly title: string; readonly why: string } | null {
  switch (reach) {
    case "unknown":
    case "ready":
      return null;
    case "none":
      return {
        title: "This organization has no Gitea.",
        why: "A project's changes live in its organization's Gitea.",
      };
    case "setting-up":
      return { title: "Gitea is still being set up.", why: "Its changes are read once it runs." };
    case "unavailable":
      return { title: "Gitea is being removed.", why: "Nothing can be read from it." };
    case "no-address":
      return {
        title: "Gitea has no public address.",
        why: "Turn on its web service's subdomain in Zerops.",
      };
    case "no-broker":
      return {
        title: "Gitea has no broker.",
        why: "The broker service signs the app in to Gitea; the Gitea project has none.",
      };
    case "no-broker-address":
      return {
        title: "Gitea's broker has no public address.",
        why: "Turn on the broker service's subdomain in Zerops.",
      };
  }
}

/**
 * What a project's or an environment's page says in place of a flow that is not read: null while
 * it is being read (the wait line), else why it will not be — Gitea refused the app's sign-in, a
 * Gitea it cannot reach, a project the registry does not hold, or reads that failed.
 */
export function unreadFlowWords(input: {
  readonly signInTrouble: string | null;
  readonly gitea: GiteaReach;
  /** The registry of projects is read. */
  readonly groupsRead: boolean;
  /** The registry holds this project. */
  readonly groupKnown: boolean;
  /** Why this project's reads failed, where both halves failed. */
  readonly failure: string | undefined;
}): string | null {
  if (input.signInTrouble !== null) return input.signInTrouble;
  const words = giteaReachWords(input.gitea);
  if (words !== null) return words.title;
  if (input.groupsRead && !input.groupKnown) return "This project isn't here any more.";
  if (input.failure !== undefined) return input.failure;
  return null;
}
