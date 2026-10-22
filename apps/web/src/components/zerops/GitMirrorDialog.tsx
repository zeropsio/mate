/**
 * *Mirror code to GitHub or GitLab…*, from a project's ···: every repository its Mates ship code to,
 * each mirrored through the organization's GitHub app or with a token, its token replaced, its
 * address reviewed or disconnected, as HQ offers it (`GitRemoteSettings`). The page's column says
 * only the remotes that are connected.
 */
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { useProjectFlows } from "~/zerops/projectFlows";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useGitMirrorApp } from "~/zerops/useGitMirrorApp";

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
  // The organization's GitHub app, read while the dialog is open: its repositories need no token.
  const github = useGitMirrorApp().app;
  const navigate = useNavigate();
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
            Each repository of {appName} pushes what lands on its main to a repository you own.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <GitRemoteSettings
            actions={git.actions}
            appId={appId}
            appName={appName}
            can={git.can}
            github={github}
            onOpenAutomation={() => {
              onClose();
              void navigate({ to: "/settings/automation" });
            }}
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
