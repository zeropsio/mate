import { repositoryStorage } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** One HQ repository's storage, shared by its heading and the Add Mate dialog. */
export function GitRepositoryStorage({ storage }: { readonly storage: GitHomeAbout["storage"] }) {
  const said = repositoryStorage(storage);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} />}>{said.line}</TooltipTrigger>
        <TooltipPopup>{said.hint}</TooltipPopup>
      </Tooltip>
      {said.large ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Large repository</Badge>
          <span>Starting a new workspace may take longer.</span>
        </div>
      ) : null}
    </div>
  );
}
