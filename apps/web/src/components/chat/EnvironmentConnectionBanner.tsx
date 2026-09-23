import {
  connectionBannerCopy,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { WifiOffIcon } from "lucide-react";

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
    variant: input.connection.phase === "error" ? "error" : "warning",
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
