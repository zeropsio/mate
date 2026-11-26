import { repositoryStorage } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Text } from "~/components/ui/text";
import { Meter } from "~/components/ui/meter";

/** One HQ repository's storage, under its heading, with its limit's control where one is offered. */
export function GitRepositoryStorage({
  storage,
  control,
}: {
  readonly storage: GitHomeAbout["storage"];
  readonly control?: ReactNode;
}) {
  const said = repositoryStorage(storage);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Text variant="note">
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} />}>{said.line}</TooltipTrigger>
            <TooltipPopup>{said.hint}</TooltipPopup>
          </Tooltip>
        </Text>
        {control}
      </div>
      {storage?.usedBytes == null ? null : (
        <Meter
          size="sm"
          tone="neutral"
          label="Storage used"
          value={storage.usedBytes / storage.limitBytes}
        />
      )}
      {said.large ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Large repository</Badge>
          <Text variant="note">Starting a new workspace may take longer.</Text>
        </div>
      ) : null}
    </div>
  );
}
