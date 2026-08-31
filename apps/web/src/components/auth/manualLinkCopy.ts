import type { ServerAuthBootstrapMethod } from "@t3tools/contracts";

function describeAuthGate(bootstrapMethods: ReadonlyArray<ServerAuthBootstrapMethod>): string {
  if (bootstrapMethods.length === 0) {
    return "This environment offers no sign-in from here; ask an operator for a one-time link.";
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment expects a trusted pairing credential before the app can connect.";
  }

  return "Enter a pairing token to start a session with this environment.";
}

function describeSupportedMethods(
  bootstrapMethods: ReadonlyArray<ServerAuthBootstrapMethod>,
): string {
  if (bootstrapMethods.length === 0) {
    return describeAuthGate(bootstrapMethods);
  }

  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.";
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.";
  }

  return "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.";
}

export const MANUAL_LINK_COPY = {
  pending: {
    heading: "Pairing with this environment",
    description: "Validating the pairing link and preparing your session.",
  },
  credential: {
    heading: "Pair with this environment",
    unavailableHeading: "No sign-in from here",
    tokenLabel: "Pairing token",
    tokenPlaceholder: "Paste a one-time token or pairing secret",
    submittingAction: "Pairing...",
    continueAction: "Continue",
    reloadAction: "Reload app",
  },
  hosted: {
    connecting: "Connecting to this backend.",
    missingRequest: "This pairing link is missing its backend host or token.",
    submittedToken:
      "This one-time pairing token was already submitted. Request a new pairing link.",
    pairedHeading: "Backend paired",
    errorHeading: "Pairing failed",
    pendingHeading: "Pairing backend",
    hostLabel: "Host:",
    browserRequirements:
      "Verify the backend is reachable from this browser, supports CORS for hosted clients, and is served over HTTPS when opening this page from HTTPS.",
    submittingAction: "Pairing...",
    retryAction: "Try again",
    openAction: "Open app",
  },
  unknownAuthenticationError: "Authentication failed.",
  describeAuthGate,
  describeSupportedMethods,
  describeSavedEnvironment(label: string): string {
    return `${label || "The environment"} is saved in this browser.`;
  },
  describeHostedFailure(error: string): string {
    return `${error} If the backend accepted this one-time token, request a new pairing link before retrying.`;
  },
};
