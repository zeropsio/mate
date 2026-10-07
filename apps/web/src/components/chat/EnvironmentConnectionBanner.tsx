import {
  connectionBannerCopy,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { askAgainLabel } from "@t3tools/client-runtime/zerops/environments";
import type { WebMateVoice as MateVoice } from "../../zerops/mateNoticeVoice";
import type { EnvironmentId } from "@t3tools/contracts";
import { WifiOffIcon } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/**
 * The banner over a conversation whose environment is not connected: the
 * cause named after the Mate (`connectionBannerCopy`) and at most one verb,
 * which asks the supervisor to try now. The failure's own detail stays out
 * of it.
 */
export function environmentConnectionBannerItem(input: {
  readonly environmentId: EnvironmentId;
  readonly connection: EnvironmentConnectionPresentation;
  readonly mateName: string | null;
  readonly onRetry: () => void;
}): ComposerBannerStackItem | null {
  const copy = connectionBannerCopy(input.connection, input.mateName);
  if (copy === null) return null;
  return {
    id: `environment-unavailable:${input.environmentId}`,
    variant: input.connection.phase === "error" ? "error" : "default",
    icon: <WifiOffIcon />,
    title: copy.title,
    ...(copy.description === null ? {} : { description: copy.description }),
    ...(copy.action === null
      ? {}
      : {
          actions: (
            <Button size="xs" onClick={input.onRetry}>
              {copy.action}
            </Button>
          ),
        }),
  };
}

/**
 * The banner over a Mate's conversation (`mateVoice`): the link's one line, in the Mate's name,
 * and its verb once — *Try now* (or *Try again*, after a refusal) asks its Mate again; the projects screen's verbs send the
 * person there. Nothing while the voice speaks elsewhere or not at all.
 */
export function mateVoiceBannerItem(input: {
  readonly environmentId: EnvironmentId;
  readonly voice: MateVoice;
  readonly onRetry: () => void;
  readonly projects: ReactElement;
}): ComposerBannerStackItem | null {
  const { voice } = input;
  if (voice.surface !== "banner" || voice.text === null) return null;
  const askAgain = askAgainLabel(voice.actions);
  const toProjects = voice.actions.some(
    (action) =>
      action === "go-to-projects" ||
      action === "start" ||
      action === "enable" ||
      action === "restart" ||
      action === "open-in-zerops",
  );
  return {
    id: `mate-link:${input.environmentId}`,
    variant:
      voice.severity === "danger"
        ? "error"
        : voice.severity === "attention"
          ? "warning"
          : "default",
    icon: <WifiOffIcon />,
    title: voice.headline ?? voice.text,
    ...(voice.secondary === undefined ? {} : { description: voice.secondary }),
    ...(askAgain !== null || toProjects
      ? {
          actions: (
            <>
              {askAgain === null ? null : (
                <Button size="xs" onClick={input.onRetry}>
                  {askAgain}
                </Button>
              )}
              {toProjects ? (
                <Button render={input.projects} size="xs" variant="outline">
                  Go to projects
                </Button>
              ) : null}
            </>
          ),
        }
      : {}),
  };
}

/**
 * What a banner's "Try now" says when asking the supervisor failed, which
 * happens only when the connection runtime itself could not be built. The
 * failure's own words go to the console with the command's report, never
 * into the toast.
 */
export function environmentRetryFailureToast(
  result: AtomCommandResult<unknown, unknown>,
): { readonly title: string; readonly description: string } | null {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  return { title: "Couldn't reconnect", description: "Reload the page to try again." };
}
