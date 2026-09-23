import {
  connectionBannerCopy,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
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
