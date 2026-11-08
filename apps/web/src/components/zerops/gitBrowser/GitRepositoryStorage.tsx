import { repositoryStorage } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

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
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} />}>{said.line}</TooltipTrigger>
          <TooltipPopup>{said.hint}</TooltipPopup>
        </Tooltip>
        {control}
      </div>
      {said.large ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Large repository</Badge>
          <span>Starting a new workspace may take longer.</span>
        </div>
      ) : null}
    </div>
  );
}
