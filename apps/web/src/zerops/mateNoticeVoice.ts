import {
  reachabilityPhrase,
  type MateVoice,
  type MateVoiceInput,
} from "@t3tools/client-runtime/zerops/environments";

export type WebMateVoice =
  | { readonly surface: "none" }
  | (Exclude<MateVoice, { readonly surface: "none" }> & {
      readonly face?: "idle" | "sleep" | "waking";
      readonly severity?: "info" | "attention" | "danger" | undefined;
      readonly headline?: string;
      readonly secondary?: string;
    });

/** Web copy and pose follow source evidence. Native clients keep their current presentation. */
export function mateNoticeVoice(input: Omit<MateVoiceInput, "heldMs">): WebMateVoice {
  const { reachability, conversationShown } = input;
  const name = input.mateName.trim() || "The Mate";
  const surface = conversationShown ? "banner" : "stage";
  const say = (
    headline: string,
    secondary: string,
    face: "idle" | "sleep" | "waking" = "sleep",
    actions: Exclude<MateVoice, { surface: "none" }>["actions"] = [],
    processes = false,
  ): WebMateVoice => ({
    surface,
    severity:
      reachability?.kind === "refused-configuration" ||
      reachability?.kind === "not-answering" ||
      reachability?.kind === "no-address"
        ? "danger"
        : actions.length > 0 ||
            (reachability?.kind === "connecting" && reachability.waitingOn === "visible")
          ? "attention"
          : "info",
    headline,
    secondary,
    text: `${headline} ${secondary}`,
    face,
    actions,
    processes,
  });
  const notice =
    reachability?.kind === "ready"
      ? reachability.notice
      : reachability?.kind === "container"
        ? reachability.container
        : null;
  if (notice?.level === "restarting" || notice?.level === "updating") {
    if (!("overdue" in notice && notice.overdue)) {
      return notice.level === "restarting"
        ? say(`${name} is restarting.`, "A little stretch, then back to work.", "waking")
        : say(
            `${name} is updating.`,
            "The conversation will open once the update finishes.",
            "waking",
          );
    }
  }
  if (
    reachability === null ||
    reachability.kind === "resolving" ||
    (reachability.kind === "connecting" && reachability.waitingOn !== "visible")
  ) {
    return conversationShown
      ? { surface: "none" }
      : say(
          `${name} is opening the conversation.`,
          "Waiting for the conversation to be read.",
          "idle",
          [],
          false,
        );
  }
  if (reachability.kind === "ready" && reachability.notice === null) return { surface: "none" };
  const phrase = reachabilityPhrase(reachability, { ...input, mateName: name });
  const actions = phrase.actions;
  switch (reachability.kind) {
    case "replaced":
      return say(
        `${name} was redeployed.`,
        "Earlier conversations aren't available here.",
        "sleep",
        actions,
      );
    case "refused-configuration":
      return say(
        `${name} refused the connection settings.`,
        "Check the settings before trying again.",
        "sleep",
        actions,
      );
    case "refused-credential":
      return say(
        `${name} couldn't accept your sign-in.`,
        "Try again to renew the connection.",
        "sleep",
        actions,
      );
    case "refused-role":
      return say(
        `${name} isn't available with your access.`,
        "You can see the project, but can't operate its Mate.",
        "sleep",
        actions,
      );
    case "gone":
      return say(
        `${name}'s project is no longer available.`,
        "It was deleted, or you no longer have access.",
        "sleep",
        actions,
      );
    case "update-required":
      return say(
        `${name} needs an update.`,
        `Version ${reachability.actual} is installed; ${reachability.minimum} or newer is required.`,
        "sleep",
        actions,
      );
    case "update-unavailable":
      return say(
        `${name} needs newer Zerops tooling.`,
        "The installed tooling supplies an older Mate than this app supports.",
        "sleep",
        actions,
      );
    case "no-address":
      return say(
        `${name} has no public address.`,
        "Open the project in Zerops to check its address.",
        "sleep",
        actions,
      );
    case "waiting-for-zerops":
      return say(
        `${name} can't reach Zerops.`,
        "The connection will resume when Zerops answers.",
        "sleep",
        actions,
      );
    case "not-answering":
      return say(`${name} isn't answering.`, "Try the connection again.", "sleep", actions);
    case "reconnecting":
    case "retrying": {
      if (reachability.kind === "reconnecting" && reachability.retryAtMs === undefined) {
        return say(
          `${name} is reconnecting.`,
          "The conversation will open when the connection returns.",
          "sleep",
        );
      }
      const secondary = phrase.text ?? "The conversation will open when the connection returns.";
      return say(
        `${name} is reconnecting.`,
        secondary.replaceAll("This Mate", name).replaceAll("this Mate", name),
        "sleep",
        actions,
      );
    }
    case "container": {
      if ("overdue" in reachability.container && reachability.container.overdue) {
        return say(
          `${name} is taking longer to start.`,
          "Check the connection or restart from projects.",
          "sleep",
          actions,
        );
      }
      switch (reachability.container.level) {
        case "creating":
        case "provisioning":
          return say(
            `${name} is getting ready.`,
            "Zerops is preparing the container.",
            "waking",
            actions,
          );
        case "booting":
          return say(
            `${name} is starting.`,
            "Waiting for the container to answer.",
            "waking",
            actions,
          );
        case "inactive":
          return say(
            `${name} is stopped.`,
            "Open projects to start the container.",
            "sleep",
            actions,
          );
        case "needs-update":
          return say(
            `${name} needs an update before starting.`,
            "Open projects to restart the container.",
            "sleep",
            actions,
          );
        default:
          return say(
            `${name} isn't ready to start.`,
            phrase.text ?? "Check the container in Zerops.",
            "sleep",
            actions,
          );
      }
    }
    case "connecting":
      return say(
        `${name} is paused while this tab is in the background.`,
        "Return to this tab to continue connecting.",
        "sleep",
      );
    default:
      return say(
        `${name} is taking longer to start.`,
        phrase.text ?? "Waiting for the connection to be verified.",
        "sleep",
        actions,
      );
  }
}
