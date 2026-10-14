/**
 * *Mirror code to GitHub or GitLab…*, from a project's ···: every repository its Mates ship code to,
 * each connected to a remote, its token replaced, its address reviewed or disconnected, as HQ
 * offers it (`GitRemoteSettings`). The page's column says only the remotes that are connected.
 */
import { useMemo } from "react";

import { useProjectFlows } from "~/zerops/projectFlows";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { GitRemoteSettings } from "./GitRemoteSettings";

export function GitMirrorDialog({
  appId,
  appName,
  onClose,
}: {
  readonly appId: string;
  readonly appName: string;
  readonly onClose: () => void;
}) {
  const git = useGitTargetOperations(appId);
  // The application's repositories and environments, read while the dialog is open.
  const flow = useProjectFlows(useMemo(() => [appId], [appId])).flows.get(appId);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Mirror code to GitHub or GitLab</DialogTitle>
          <DialogDescription>
            Each repository of {appName} can push what lands on it to a remote you own.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <GitRemoteSettings
            actions={git.actions}
            appId={appId}
            appName={appName}
            can={git.can}
            // Unread, the repositories are said to be read and no environment counts yet.
            {...(flow === undefined ? {} : { environments: flow.environments })}
            live={git.live}
            repos={flow?.codeRepos ?? flow?.repos}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
