import type { EnvironmentId } from "@t3tools/contracts";

import {
  defaultOpenCodeInstance,
  OPENCODE_KEY_PROVIDERS,
  openCodeKeyIsSet,
} from "@t3tools/shared/openCodeKeyProviders";

import { OpenCodeIcon } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironment } from "~/state/environments";
import { usePlatformCapabilities } from "../../zerops/usePlatformCapabilities";
import { OpenCodeProviderKeys } from "../settings/OpenCodeProviderKeys";

/**
 * OpenCode's row among the Mate's coding agents: Mate signs nobody in to it,
 * but the model providers it runs by API key are signed in here, as in its
 * settings. Only where this Mate has OpenCode.
 */
export function OpenCodeAgentKeys({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const providers = useEnvironment(environmentId)?.serverConfig?.providers;
  const capabilities = usePlatformCapabilities(environmentId);
  // Offered until the role is known to forbid it, as every project control is; the server decides.
  const readOnly = capabilities.projectAccessKnown && !capabilities.operate;
  const installed = providers?.some(
    (provider) => provider.driver === "opencode" && provider.installed,
  );
  if (installed !== true) return null;
  return (
    <div
      className="flex items-start gap-3 border-t border-border/60 px-4 py-2.5"
      data-zerops-opencode-keys
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-accent shadow-xs"
      >
        <OpenCodeIcon className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="text-sm leading-5 font-medium text-foreground">OpenCode</span>
        <OpenCodeProviderKeys environmentId={environmentId} readOnly={readOnly} />
      </div>
    </div>
  );
}

/**
 * OpenCode as one line among the Mate's home card's agents: whether a model key is set, and the
 * press that opens its keys (`OpenCodeAgentKeys`). Only where this Mate has OpenCode.
 */
export function OpenCodeAgentLine({
  environmentId,
  onManage,
}: {
  readonly environmentId: EnvironmentId;
  readonly onManage: () => void;
}) {
  const providers = useEnvironment(environmentId)?.serverConfig?.providers;
  const settings = useEnvironmentSettings(environmentId);
  const installed = providers?.some(
    (provider) => provider.driver === "opencode" && provider.installed,
  );
  if (installed !== true) return null;
  const instance = defaultOpenCodeInstance(settings);
  const keyed =
    instance !== undefined &&
    OPENCODE_KEY_PROVIDERS.some((provider) => openCodeKeyIsSet(instance, provider));
  return (
    <li
      className="flex min-h-10 min-w-0 items-center justify-between gap-3 py-1.5"
      data-zerops-opencode-keys=""
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-5.5 shrink-0 items-center justify-center rounded-md bg-accent"
        >
          <OpenCodeIcon className="size-3.5" />
        </span>
        <span className="shrink-0 text-body font-medium text-foreground">OpenCode</span>
        <span className="min-w-0 truncate text-body text-muted-foreground">
          {keyed ? "a model key is set" : "needs a model key"}
        </span>
      </span>
      <Button onClick={onManage} size="sm" variant={keyed ? "ghost" : "link"}>
        {keyed ? "Manage" : "Add key"}
      </Button>
    </li>
  );
}
