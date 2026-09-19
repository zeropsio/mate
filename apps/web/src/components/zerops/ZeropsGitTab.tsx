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
  changeAskLabel,
  gitActionAllowed,
  historyAge,
  gitBlock,
  gitCheckoutHostnames,
  type GitBlock,
  type GitChangedFile,
  type GitCheckoutState,
  type GroupEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useZeropsChangeCommits } from "../../zerops/useZeropsRepositoryCommits";
import { useNowMs } from "../../zerops/useNowMs";

import { useProjectTopology } from "../../zerops/useProjectTopology";
import { checkoutPathFor, useZeropsGitRemoteProbes } from "../../zerops/useZeropsGitRemoteProbe";
import { useZeropsGitForge } from "../../zerops/useZeropsGitForge";
import { useVcsPullAction } from "../../state/sourceControlActions";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { ZeropsAskDialog } from "./ZeropsAskDialog";
import { ZeropsGitPanel } from "./ZeropsGitPanel";
import { ZeropsMateVerb } from "./ZeropsMateCard";

/** One identity for "nothing changed", so an idle probe reports the same value twice. */
const EMPTY_CHANGED: ReadonlyArray<GitChangedFile> = [];

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
      changed: data?.workingTree.files ?? EMPTY_CHANGED,
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

/**
 * The commits one branch has that its base does not — the Mate's own work.
 *
 * A child per block for the same reason `CheckoutProbe` is one: a hook cannot
 * be called in a loop, and each read then lives and dies with the block it
 * belongs to. It is a compare rather than a pull request read, so a branch
 * with no change open yet still shows what is on it.
 */
function BlockCommits({
  base,
  branch,
  giteaOrigin,
  owner,
  repository,
}: {
  readonly base: string;
  readonly branch: string;
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repository: string;
}) {
  const now = useNowMs();
  const commits = useZeropsChangeCommits(
    branch === base ? null : { giteaOrigin, owner, repo: repository, base, head: branch },
  );
  // Nothing to say is nothing drawn: a "Reading…" line under every block on
  // every open would be four words of chrome for a list that is usually short.
  if (commits.kind !== "read" || commits.commits.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-1" data-zerops-surface="git-commits">
      <h4 className="text-xs font-medium text-muted-foreground">
        Commits · {commits.commits.length}
      </h4>
      <ul className="flex min-w-0 flex-col">
        {commits.commits.map((commit) => {
          const age = historyAge(commit.at, now);
          return (
            <li
              className="flex min-w-0 items-baseline gap-2 py-1 text-xs"
              data-zerops-surface="git-commit"
              key={commit.sha}
            >
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {commit.sha.slice(0, 7)}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{commit.subject}</span>
              {age === undefined ? null : (
                <span className="shrink-0 tabular-nums text-muted-foreground">{age}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
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
  /** The Mate whose panel this is, so a request names who it is going to. */
  readonly mateName?: string | undefined;
  readonly signedIn: boolean;
  /** Why the sign-in was refused, when it was (`ZeropsGitPanelModel`). */
  readonly signInTrouble?: string | undefined;
  /** Opens a block's change on its own page, which is where its Merge lives. */
  readonly onOpenChange?: ((block: GitBlock) => void) | undefined;
  /** Opens the pull request in Gitea as the person; the forge is read again once it settles. */
  readonly onCreatePullRequest?: ((block: GitBlock) => Promise<void> | void) | undefined;
  /** Merges it in Gitea as the person; the forge is read again once it settles. */
  readonly onMergePullRequest?: ((block: GitBlock) => Promise<void> | void) | undefined;
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
            changed: EMPTY_CHANGED,
          },
          // Nothing in the map yet is nothing asked yet, never "no repository".
          forge: forges.get(repository) ?? {
            read: false,
            repository: undefined,
            pullRequest: undefined,
            checks: [],
          },
          declarations: props.declarations,
          ...(props.mateName === undefined ? {} : { mateName: props.mateName }),
          evidence: {
            remoteReachable: remotes.get(repository)?.reachable,
            remoteDetail: remotes.get(repository)?.detail,
          },
        }),
      ),
    [checkouts, forges, props.declarations, props.mateName, remotes, repositories],
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
    // The forge is read again once the verb has settled, not when it was
    // pressed: a read racing the request it asks about would show the row as
    // it was (2026-09-17, the request opened and the row kept offering it).
    const key = `${block.repository} ${action.kind}`;
    const isRunning = running === key;
    const settled = () => {
      setRunning((current) => (current === key ? null : current));
      setGeneration((current) => current + 1);
    };
    const run = () => {
      setRunning(key);
      switch (action.kind) {
        case "update-from-main":
          void pull.run().finally(settled);
          return;
        case "open-pull-request":
          void Promise.resolve(props.onCreatePullRequest?.(block)).finally(settled);
          return;
        case "merge":
          void Promise.resolve(props.onMergePullRequest?.(block)).finally(settled);
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
        model={{ blocks, signedIn: props.signedIn, signInTrouble: props.signInTrouble }}
        renderBlockAction={renderBlockVerbs}
        renderBlockCommits={(block) => (
          <BlockCommits
            base={block.baseBranch}
            branch={block.branch}
            giteaOrigin={props.giteaOrigin}
            owner={props.owner}
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
