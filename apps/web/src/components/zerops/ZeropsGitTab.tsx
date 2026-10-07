/**
 * The Git tab, connected: two sources joined where the person already is.
 *
 * The checkout half is one live `subscribeVcsStatus` **per mount** — a child
 * per repository, because a hook cannot be called in a loop and because each
 * mount's subscription then lives and dies with its own row. The change half is
 * the Mate's newest change in each repository, from the project's flow, which
 * HQ's stream keeps (`mateChangeIn`): a push moves it there, and its commits
 * are HQ's detail of it (`ZeropsGitBlockCommits`). What the two mean together
 * is `gitTab.ts`, which this file does not second-guess.
 *
 * Which repositories there are comes from the project's own topology: a runtime
 * service is a codebase, its hostname is the name of its repository in the
 * Mate's application at HQ (`/git/<appId>/<hostname>.git`), and its checkout
 * is `/var/www/{hostname}` — the path zcp mounts every sibling service at.
 *
 * Checkout-side verbs (`vcs.*`) run in the container as the agent's user, so
 * they are the Mate's owner's alone (D11); *Review* is offered to whoever can
 * open this Mate, and the review polices what it offers.
 *
 * Whether each remote answers is the third read here, and the only one that is
 * neither live nor on a clock: `zerops.git.probeRemote` on open and after each
 * verb (`useZeropsGitRemoteProbe`).
 */
import {
  changeAskLabel,
  gitActionAllowed,
  gitBlock,
  gitCheckoutHostnames,
  mateChangeIn,
  type FlowPullRequest,
  type GitBlock,
  type GitChangedFile,
  type GitCheckoutState,
  type GroupEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo, useState, type MouseEvent } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";

import { mergedMain } from "../../zerops/useZeropsChangeDetail";
import { useProjectTopology } from "../../zerops/useProjectTopology";
import { checkoutPathFor, useZeropsGitRemoteProbes } from "../../zerops/useZeropsGitRemoteProbe";
import { useVcsPullAction } from "../../state/sourceControlActions";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { ZeropsAskDialog } from "./ZeropsAskDialog";
import { ZeropsGitBlockCommits } from "./ZeropsGitBlockCommits";
import { ZeropsGitPanel } from "./ZeropsGitPanel";
import { ZeropsMateVerb } from "./ZeropsMateCard";

/** One identity for "nothing changed", so an idle probe reports the same value twice. */
const EMPTY_CHANGED: ReadonlyArray<GitChangedFile> = [];

/**
 * Subscribes to one mount's VCS status and reports it up. Renders nothing: its
 * whole job is to own a subscription that belongs to one row.
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
      read: data !== null,
      isRepo: data?.isRepo ?? false,
      hasRemote: data?.hasPrimaryRemote ?? false,
      headRef: data?.refName ?? null,
      aheadCount: data?.aheadCount ?? 0,
      behindCount: data?.behindCount ?? 0,
      hasUpstream: data?.hasUpstream ?? false,
      changed: data === null ? EMPTY_CHANGED : data.workingTree.files,
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
  /** The Mate's application in HQ, which is its group. */
  readonly appId: string | undefined;
  /** The application's environments as HQ records them, when they could be read. */
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  /**
   * The project's changes as its flow carries them, once HQ's stream has told them; `undefined`
   * before.
   */
  readonly changes:
    | {
        readonly pullRequests: ReadonlyArray<FlowPullRequest>;
        readonly merged: ReadonlyArray<FlowPullRequest>;
      }
    | undefined;
  /** The Mate whose panel this is, by its project: its changes are the ones drawn. */
  readonly mateProjectId: string | undefined;
  /** Whether this Mate is the viewer's own (D11). */
  readonly isOwner: boolean;
  /** The Mate whose panel this is, so a request names who it is going to. */
  readonly mateName?: string | undefined;
  /** Opens a block's change on its own page. */
  readonly onOpenChange?: ((block: GitBlock) => void) | undefined;
  /**
   * Opens the change's review from the verb pressed — the one door to merging (pass 16, R1):
   * nothing merges from the tab.
   */
  readonly onReviewPullRequest?: ((block: GitBlock, from: HTMLElement) => void) | undefined;
}

export function ZeropsGitTab(props: ZeropsGitTabProps) {
  const environmentId = props.threadRef?.environmentId;
  const topology = useProjectTopology(environmentId ?? null);
  const [checkouts, setCheckouts] = useState<ReadonlyMap<string, GitCheckoutState>>(new Map());
  const [generation, setGeneration] = useState(0);
  // The verb that is running, by its block: the row says so where it was
  // pressed, and takes no second click while it runs.
  const [running, setRunning] = useState<string | null>(null);
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

  /**
   * A codebase is a runtime service, minus the stage half of each dev/stage
   * pair: a stage gets its partner's code deployed and is never a checkout
   * (`gitCheckoutHostnames`). Managed data services hold no repository.
   */
  const repositories = useMemo(
    () => gitCheckoutHostnames(topology.view?.services ?? []),
    [topology.view],
  );

  /**
   * Whether each remote answers, asked here rather than passed in: the probe
   * needs the repositories, and they come from this Mate's own topology. One
   * round on open, one more after each verb (`generation`), never on a clock.
   */
  const remotes = useZeropsGitRemoteProbes({ environmentId, repositories, generation });

  const blocks = useMemo(
    () =>
      repositories.map((repository) =>
        gitBlock({
          checkout: checkouts.get(repository) ?? {
            repository,
            read: false,
            isRepo: false,
            hasRemote: false,
            headRef: null,
            aheadCount: 0,
            behindCount: 0,
            hasUpstream: false,
            changed: EMPTY_CHANGED,
          },
          // Changes not told yet are nothing asked yet, never "no repository".
          changes:
            props.changes === undefined
              ? { read: false, change: undefined }
              : {
                  read: true,
                  change: mateChangeIn(props.changes, props.mateProjectId, repository),
                },
          declarations: props.declarations,
          ...(props.mateName === undefined ? {} : { mateName: props.mateName }),
          evidence: {
            remoteReachable: remotes.get(repository)?.reachable,
            remoteDetail: remotes.get(repository)?.detail,
          },
        }),
      ),
    [
      checkouts,
      props.changes,
      props.declarations,
      props.mateName,
      props.mateProjectId,
      remotes,
      repositories,
    ],
  );

  /**
   * The words a block wants handed back, waiting on the person's *Send*.
   *
   * The request goes into this Mate's own conversation — the one the panel is
   * open beside — rather than through `useAskMate`, which exists to find a
   * Mate from somewhere else in the app and navigate to it. Here there is
   * nowhere to navigate to: the person is already looking at the Mate they
   * would be writing to.
   */
  const [asking, setAsking] = useState<{ readonly ask: string; readonly what: string } | null>(
    null,
  );
  const sendAsk = useCallback(() => {
    const threadRef = props.threadRef;
    if (asking === null || threadRef === null) return;
    useComposerDraftStore.getState().requestSend(threadRef, asking.ask);
    setAsking(null);
  }, [asking, props.threadRef]);

  const renderBlockAction = (block: GitBlock) => {
    const action = block.action;
    if (!gitActionAllowed(action, { isOwner: props.isOwner }) || action === undefined) return null;
    // The remote is probed again once the verb has settled, not when it was
    // pressed: a probe racing the verb it asks about would show the row as it
    // was.
    const key = `${block.repository} ${action.kind}`;
    const isRunning = running === key;
    const settled = () => {
      setRunning((current) => (current === key ? null : current));
      setGeneration((current) => current + 1);
    };
    const run = (event: MouseEvent<HTMLButtonElement>) => {
      switch (action.kind) {
        case "update-from-main":
          setRunning(key);
          void pull.run().finally(settled);
          return;
        case "review":
          // The review reads the change itself.
          props.onReviewPullRequest?.(block, event.currentTarget);
          return;
        case "push":
          // Pushing is the agent's: the tab says what is unpushed and the
          // person asks their Mate, rather than the app committing for them.
          return;
      }
    };
    if (action.kind === "push") return null;
    return (
      <ZeropsMateVerb
        disabled={isRunning}
        label={isRunning ? action.running : action.label}
        onClick={run}
      />
    );
  };

  /**
   * The verbs under one block: the one that runs here, and — where the block
   * is stuck on something only the agent can undo — the one that hands it
   * back. A panel that names a problem and offers nothing is the dead end this
   * whole surface was rebuilt to close.
   */
  const renderBlockVerbs = (block: GitBlock) => {
    const verdict = block.verdict;
    const verb = renderBlockAction(block);
    // No verdict is no answer yet, and there is nothing to hand back until
    // the forge has said what is wrong.
    if (verdict?.ask === undefined || props.threadRef === null) return verb;
    const ask = verdict.ask;
    return (
      <>
        <ZeropsMateVerb
          label={changeAskLabel(props.mateName)}
          onClick={() => setAsking({ ask, what: verdict.text })}
        />
        {verb}
      </>
    );
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
        model={{ blocks }}
        renderBlockAction={renderBlockVerbs}
        renderBlockCommits={(block) => (
          <ZeropsGitBlockCommits
            appId={props.appId}
            change={
              block.pullRequestNumber === undefined || block.pullRequestHead === undefined
                ? undefined
                : { number: block.pullRequestNumber, head: block.pullRequestHead }
            }
            // Each repository has its own main, independent of the application's other merges.
            main={mergedMain(block.repository, props.changes?.merged)}
            repository={block.repository}
          />
        )}
        {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
      />
      <ZeropsAskDialog
        ask={asking?.ask ?? ""}
        mateName={props.mateName}
        onConfirm={sendAsk}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        open={asking !== null}
        sending={false}
        tint={undefined}
        what={asking?.what ?? ""}
      />
    </>
  );
}
