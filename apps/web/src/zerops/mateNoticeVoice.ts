import {
  reachabilityPhrase,
  type MateVoice,
  type MateVoiceInput,
} from "@t3tools/client-runtime/zerops/environments";

export type WebMateVoice =
  | { readonly surface: "none" }
  | (Exclude<MateVoice, { readonly surface: "none" }> & {
      readonly face?: "idle" | "sleep" | "waking";
    });

/** Web copy and pose follow source evidence. Native clients keep their current presentation. */
export function mateNoticeVoice(input: Omit<MateVoiceInput, "heldMs">): WebMateVoice {
  const { reachability, conversationShown } = input;
  const surface = conversationShown ? "banner" : "stage";
  const notice =
    reachability?.kind === "ready"
      ? reachability.notice
      : reachability?.kind === "container"
        ? reachability.container
        : null;
  if (notice?.level === "restarting" || notice?.level === "updating") {
    // An overdue restart already has a source verdict and its own next action.
    if (!("overdue" in notice && notice.overdue)) {
      return {
        surface,
        face: "waking",
        processes: false,
        actions: [],
        text:
          notice.level === "restarting"
            ? "I'm restarting. A little stretch, then back to work."
            : "I'm updating. Back once the update finishes.",
      };
    }
  }
  if (
    reachability === null ||
    reachability.kind === "resolving" ||
    (reachability.kind === "connecting" &&
      reachability.waitingOn !== "access" &&
      reachability.waitingOn !== "visible")
  ) {
    return conversationShown
      ? { surface: "none" }
      : {
          surface,
          face: "idle",
          processes: true,
          actions: ["try-now"],
          text: "I'm opening the conversation.",
        };
  }
  if (reachability.kind === "reconnecting" && reachability.retryAtMs === undefined) {
    return {
      surface,
      face: "sleep",
      processes: false,
      actions: ["try-now"],
      text: "I'm reconnecting. Your conversation will open when I'm back.",
    };
  }
  if (reachability.kind === "ready" && reachability.notice === null) return { surface: "none" };
  const phrase = reachabilityPhrase(reachability, input);
  let text = phrase.text;
  switch (reachability.kind) {
    case "replaced":
      text = "I've been redeployed. My earlier conversations aren't available here.";
      break;
    case "refused-configuration":
      text = "I couldn't accept these connection settings.";
      break;
    case "refused-credential":
      text = "I couldn't accept your sign-in.";
      break;
    case "update-required":
      text = `I'm on ${reachability.actual}. I need ${reachability.minimum} or newer to open the conversation.`;
      break;
    case "no-address":
      text = "I don't have a public address.";
      break;
    case "waiting-for-zerops":
      text = "I can't reach Zerops. I'll reconnect when it answers.";
      break;
    case "not-answering":
      text = "I'm unreachable on this connection.";
      break;
    case "reconnecting":
    case "retrying":
      text =
        text
          ?.replace("This Mate's server", "My server")
          .replace("This Mate can't", "I can't")
          .replace("This Mate isn't answering.", "I'm having trouble connecting.")
          .replace(
            "This tab couldn't set up the connection to this Mate.",
            "This tab couldn't connect to me.",
          ) ?? null;
      break;
    case "container":
      if ("overdue" in reachability.container && reachability.container.overdue) {
        text = "I'm taking longer to start.";
      } else {
        switch (reachability.container.level) {
          case "creating":
          case "provisioning":
            text = "I'm getting ready.";
            break;
          case "booting":
            text = "I'm starting.";
            break;
          case "inactive":
            text = "I'm stopped.";
            break;
          case "needs-update":
            text = "I need an update before I can start.";
            break;
        }
      }
      break;
  }
  return { surface, face: "sleep", processes: false, text, actions: phrase.actions };
}
