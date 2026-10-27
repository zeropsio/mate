import {
  connectionBannerCopy,
  type EnvironmentConnectionPhase,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

function noticeTitle(phase: EnvironmentConnectionPhase, environmentLabel: string): string {
  switch (phase) {
    case "offline":
      return "You are offline";
    case "connecting":
      return `Connecting to ${environmentLabel}...`;
    case "reconnecting":
      return `Reconnecting to ${environmentLabel}...`;
    case "error":
      return `${environmentLabel} is unavailable`;
    case "available":
      return `${environmentLabel} is disconnected`;
    case "connected":
      return "";
  }
}

function nextStep(phase: EnvironmentConnectionPhase, resourceName: string): string {
  switch (phase) {
    case "offline":
      return `Cached data remains available. The ${resourceName} will load when your connection returns.`;
    case "connecting":
    case "reconnecting":
      return `The ${resourceName} will load as soon as the environment is ready.`;
    case "available":
    case "error":
      return `Reconnect the environment to load the ${resourceName}.`;
    case "connected":
      return "";
  }
}

/**
 * What a screen waiting on its environment says: the cause class of a failure
 * (`connectionBannerCopy`) and what happens next. The failure's own detail
 * names hosts, URLs and error classes; only the trace ID beside this copy
 * points at it.
 */
export function environmentConnectionNoticeCopy(input: {
  readonly environmentLabel: string;
  readonly connection: EnvironmentConnectionPresentation;
  readonly resourceName: string;
}): { readonly title: string; readonly detail: string } {
  const { connection } = input;
  const cause =
    connection.error === null
      ? null
      : (connectionBannerCopy(connection, null)?.description ?? null);
  const next = nextStep(connection.phase, input.resourceName);
  return {
    title: noticeTitle(connection.phase, input.environmentLabel),
    detail: cause === null ? next : `${cause} ${next}`,
  };
}
