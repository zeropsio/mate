/**
 * *Connect <repo> to GitHub*: the picker for one code repository, from its row on the project
 * page, the overview card's ··· or the way back from GitHub's install page. Opened for a project
 * with several code repositories and none named, it asks which one first. Upkeep — Disconnect,
 * Replace token, Delete repository — is the row's, never the dialog's.
 */
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { useMemo, useState } from "react";

import { useProjectFlows } from "~/zerops/projectFlows";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Row } from "../ui/row";
import { connectLeadLine, repoState } from "./gitMirror.logic";
import { GithubConnectPicker } from "./github/GithubConnectPicker";
import { Loading } from "~/components/ui/loading";
import { EmptyState } from "~/components/ui/empty";
import { Text } from "~/components/ui/text";

export function GitMirrorDialog({
  appId,
  appName,
  repo: named,
  onClose,
}: {
  readonly appId: string;
  readonly appName: string;
  /** The code repository; absent: the project's only one, else asked first. */
  readonly repo?: string | undefined;
  readonly onClose: () => void;
}) {
  // The application's repositories, read while the dialog is open.
  const flow = useProjectFlows(useMemo(() => [appId], [appId])).flows.get(appId);
  const code = (flow?.codeRepos ?? flow?.repos)?.filter((entry) => entry.name !== RECIPE_REPO);
  const [chosen, setChosen] = useState<string | undefined>(named);
  const repo = chosen ?? (code?.length === 1 ? code[0]?.name : undefined);
  const mirror = useGitMirrorApps(true);
  const orgName = useZeropsSessionOptional()?.activeOrganization?.name;
  const now = useNowMs();
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {repo === undefined ? `Connect ${appName} to GitHub` : `Connect ${repo} to GitHub`}
          </DialogTitle>
          <DialogDescription>
            {repo === undefined
              ? "Each code repository connects on its own. Which one goes to GitHub?"
              : connectLeadLine(repo)}
          </DialogDescription>
        </DialogHeader>
        {repo === undefined || mirror.apps === null ? (
          <DialogPanel>
            <div className="grid min-h-72 content-start gap-1">
              {code === undefined || (repo !== undefined && mirror.apps === null) ? (
                <Loading count={3} label="Repositories" shape="rows" />
              ) : code.length === 0 ? (
                <EmptyState size="row">No code repository yet.</EmptyState>
              ) : (
                code.map((entry) => {
                  const state = repoState(entry, {
                    apps: mirror.apps?.kind === "ready" ? mirror.apps : null,
                    orgName,
                    now,
                  });
                  return (
                    <Row
                      key={entry.name}
                      line={
                        state.destination === null
                          ? state.line
                          : `${state.destination.label} · ${state.line}`
                      }
                      onClick={() => setChosen(entry.name)}
                      pressable
                      render={<button type="button" />}
                      size="sm"
                      title={<Text variant="code">{entry.name}</Text>}
                    />
                  );
                })
              )}
            </div>
          </DialogPanel>
        ) : (
          <GithubConnectPicker
            apps={mirror.apps}
            onConnected={onClose}
            project={appId}
            repo={repo}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
