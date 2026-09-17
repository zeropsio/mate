/**
 * The Git tab, connected: two sources joined where the person already is.
 *
 * The checkout half is one live `subscribeVcsStatus` **per mount** — a child
 * per repository, because a hook cannot be called in a loop and because each
 * mount's subscription then lives and dies with its own row. The forge half is
 * `useZeropsGitForge`, re-read on open, after each action and every sixty
 * seconds. What the two mean together is `gitTab.ts`, which this file does not
 * second-guess.
 *
 * Which repositories there are comes from the project's own topology: a runtime
 * service is a codebase, its hostname is its repository's name in the group's
 * org (`docs/group-repo.md`), and its checkout is `/var/www/{hostname}` — the
 * path zcp mounts every sibling service at.
 *
 * Checkout-side verbs (`vcs.*`) run in the container as the agent's user, so
 * they are the Mate's owner's alone (D11); Gitea-side verbs are Gitea's to
 * police and are offered to whoever can open this Mate.
 *
 * Whether each remote answers is the third read here, and the only one that is
 * neither live nor on a clock: `zerops.git.probeRemote` on open and after each
 * verb (`useZeropsGitRemoteProbe`).
 */
import {
  gitActionAllowed,
  gitBlock,
  type GitBlock,
  type GitCheckoutState,
  type GroupEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { useProjectTopology } from "../../zerops/useProjectTopology";
import { checkoutPathFor, useZeropsGitRemoteProbes } from "../../zerops/useZeropsGitRemoteProbe";
import { useZeropsGitForge } from "../../zerops/useZeropsGitForge";
import { useVcsPullAction } from "../../state/sourceControlActions";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { ZeropsGitPanel, type ZeropsGitPanelModel } from "./ZeropsGitPanel";
import { ZeropsMateVerb } from "./ZeropsMateCard";

/**
 * Subscribes to one mount's VCS status and reports it up. Renders nothing:
 * its whole job is to own a subscription that belongs to one row.
 */
function CheckoutProbe({
  environmentId,
  hostname,
  onState,
}: {
  readonly environmentId: EnvironmentId;
  readonly hostname: string;
  readonly onState: (hostname: string, state: GitCheckoutState) => void;
}) {
  const cwd = checkoutPathFor(hostname);
  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  const data = status.data;
  const state = useMemo<GitCheckoutState>(
    () => ({
      repository: hostname,
      isRepo: data?.isRepo ?? false,
      hasRemote: data?.hasPrimaryRemote ?? false,
      headRef: data?.refName ?? null,
      aheadCount: data?.aheadCount ?? 0,
      behindCount: data?.behindCount ?? 0,
      hasUpstream: data?.hasUpstream ?? false,
      changedFiles: data?.workingTree.files.length ?? 0,
    }),
    [data, hostname],
  );
  const key = JSON.stringify(state);
  useMemo(() => {
    onState(hostname, state);
    // The serialised state is the dependency: an identical answer re-reported
    // would set state in a loop.
  }, [hostname, key, onState, state]);
  return null;
}

export interface ZeropsGitTabProps {
  readonly threadRef: ScopedThreadRef | null;
  /** The account's Gitea, when there is one. */
  readonly giteaOrigin: string | undefined;
  /** The group's Gitea org, from the registry. */
  readonly owner: string | undefined;
  /** `environments.yaml` on the group repo, when it could be read. */
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  /** Whether this Mate is the viewer's own (D11). */
  readonly isOwner: boolean;
  /** The group half of the panel, which the caller assembles. */
  readonly group: Omit<ZeropsGitPanelModel, "blocks" | "signedIn" | "signInTrouble">;
  readonly signedIn: boolean;
  /** Why the sign-in was refused, when it was (`ZeropsGitPanelModel`). */
  readonly signInTrouble?: string | undefined;
  readonly onOpenPullRequest?: ((block: GitBlock) => void) | undefined;
  readonly onCreatePullRequest?: ((block: GitBlock) => void) | undefined;
  readonly onMergePullRequest?: ((block: GitBlock) => void) | undefined;
  readonly onRelease?: (() => void) | undefined;
  readonly onRollBack?: ZeropsGitPanelProps["onRollBack"];
  readonly onOpenRecipeChange?: ZeropsGitPanelProps["onOpenRecipeChange"];
}

type ZeropsGitPanelProps = Parameters<typeof ZeropsGitPanel>[0];

export function ZeropsGitTab(props: ZeropsGitTabProps) {
  const environmentId = props.threadRef?.environmentId;
  const topology = useProjectTopology(environmentId ?? null);
  const [checkouts, setCheckouts] = useState<ReadonlyMap<string, GitCheckoutState>>(new Map());
  const [generation, setGeneration] = useState(0);
  const pull = useVcsPullAction({ environmentId: environmentId ?? null, cwd: null });

  const onState = useCallback((hostname: string, state: GitCheckoutState) => {
    setCheckouts((current) => {
      const previous = current.get(hostname);
      if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(state)) {
        return current;
      }
      const next = new Map(current);
      next.set(hostname, state);
      return next;
    });
  }, []);

  /** A codebase is a runtime service; managed data services hold no repository. */
  const repositories = useMemo(
    () =>
      (topology.view?.services ?? [])
        .filter((service) => service.group === "runtimes")
        .map((service) => service.hostname),
    [topology.view],
  );

  const targets = useMemo(
    () =>
      repositories.map((repository) => ({
        repository,
        branch: checkouts.get(repository)?.headRef ?? null,
      })),
    [checkouts, repositories],
  );

  /**
   * Whether each remote answers, asked here rather than passed in: the probe
   * needs the repositories, and they come from this Mate's own topology. One
   * round on open, one more after each verb (`generation`), never on a clock.
   */
  const remotes = useZeropsGitRemoteProbes({ environmentId, repositories, generation });

  const forges = useZeropsGitForge({
    giteaOrigin: props.giteaOrigin,
    owner: props.owner,
    targets,
    generation,
    enabled: props.signedIn,
  });

  const blocks = useMemo(
    () =>
      repositories.map((repository) =>
        gitBlock({
          checkout: checkouts.get(repository) ?? {
            repository,
            isRepo: false,
            hasRemote: false,
            headRef: null,
            aheadCount: 0,
            behindCount: 0,
            hasUpstream: false,
            changedFiles: 0,
          },
          forge: forges.get(repository) ?? {
            repository: undefined,
            pullRequest: undefined,
            checks: [],
          },
          declarations: props.declarations,
          evidence: {
            remoteReachable: remotes.get(repository)?.reachable,
            remoteDetail: remotes.get(repository)?.detail,
          },
        }),
      ),
    [checkouts, forges, props.declarations, remotes, repositories],
  );

  const renderBlockAction = (block: GitBlock) => {
    const action = block.action;
    if (!gitActionAllowed(action, { isOwner: props.isOwner }) || action === undefined) return null;
    const run = () => {
      setGeneration((current) => current + 1);
      switch (action.kind) {
        case "update-from-main":
          void pull.run();
          return;
        case "open-pull-request":
          props.onCreatePullRequest?.(block);
          return;
        case "merge":
          props.onMergePullRequest?.(block);
          return;
        case "push":
          // Pushing is the agent's: the tab says what is unpushed and the
          // person asks their Mate, rather than the app committing for them.
          return;
      }
    };
    if (action.kind === "push") return null;
    return <ZeropsMateVerb label={action.label} onClick={run} />;
  };

  return (
    <>
      {environmentId === undefined
        ? null
        : repositories.map((hostname) => (
            <CheckoutProbe
              environmentId={environmentId}
              hostname={hostname}
              key={hostname}
              onState={onState}
            />
          ))}
      <ZeropsGitPanel
        model={{
          ...props.group,
          blocks,
          signedIn: props.signedIn,
          signInTrouble: props.signInTrouble,
        }}
        renderBlockAction={renderBlockAction}
        {...(props.onOpenPullRequest === undefined
          ? {}
          : { onOpenPullRequest: props.onOpenPullRequest })}
        {...(props.onOpenRecipeChange === undefined
          ? {}
          : { onOpenRecipeChange: props.onOpenRecipeChange })}
        {...(props.onRelease === undefined ? {} : { onRelease: props.onRelease })}
        {...(props.onRollBack === undefined ? {} : { onRollBack: props.onRollBack })}
      />
    </>
  );
}
