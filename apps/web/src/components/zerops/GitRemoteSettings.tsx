import { OperationStopped } from "@t3tools/client-runtime/data";
import { gitRemoteExpiry } from "@t3tools/client-runtime/zerops";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { HqRemoteProbe, RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { stoppedWords } from "~/zerops/stoppedWords";
import { useNowMs } from "~/zerops/useNowMs";
import { useId, useState } from "react";
import { Button, InlineButton } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { OutLink } from "../settings/automationParts";
import { gitRemoteLabel } from "./GitDeliveryStatus";
import {
  githubName,
  mirrorGateLine,
  mirrorLeadLine,
  mirrorStateLine,
  type GitMirrorApp,
} from "./gitMirror.logic";

/** Optional actions are supplied by the account's operations, never a component's host client. */
export interface GitRemoteActions {
  readonly replaceToken?: (repo: string, token: string) => Promise<HqRemoteProbe>;
  readonly disconnect?: (repo: string) => Promise<void>;
  readonly connect?: (repo: string, url: string, token: string) => Promise<HqRemoteProbe>;
  readonly reviewAddress?: (repo: string, url: string, token: string) => Promise<HqRemoteProbe>;
  readonly updateAddress?: (repo: string, url: string) => Promise<void>;
  /** Mirrors to a repository the organization's GitHub app reaches (`owner/name`), no token. */
  readonly viaApp?: (repo: string, repository: string) => Promise<void>;
  /** Its Mates no longer fetch the GitHub repository it follows; HQ alone keeps its code. */
  readonly unfollow?: (repo: string) => Promise<void>;
  /** Deletes the repository and its code from Mate; the GitHub repository it mirrors to stays. */
  readonly deleteRepository?: (repo: string) => Promise<void>;
  readonly addressReview?: {
    readonly repo: string;
    readonly verified: Extract<HqRemoteProbe, { readonly ok: true }>;
    readonly confirm: () => Promise<void>;
  };
}

/** The repositories connected to a remote, as the page's column says them: one quiet line each. */
export function connectedRepos(
  repos: ReadonlyArray<RepoListEntry> | undefined,
): ReadonlyArray<RepoListEntry & { readonly remote: NonNullable<RepoListEntry["remote"]> }> {
  return (repos ?? []).flatMap((repo) =>
    repo.name === RECIPE_REPO || repo.remote == null ? [] : [{ ...repo, remote: repo.remote }],
  );
}

/**
 * "medusadev → github.com/acme/medusa": each connected repository and where it mirrors to, with
 * what its token says where the remote refused it or it runs out. Connecting and changing one is
 * the project menu's *Mirror code to GitHub or GitLab…*.
 */
export function GitRemoteLines({
  repos,
  now: at,
}: {
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly now?: number;
}) {
  const clock = useNowMs();
  const now = at ?? clock;
  return (
    <ul data-zerops-surface="git-remotes">
      {connectedRepos(repos).map((repo) => (
        <li className="py-1.5" key={repo.name}>
          <p className="rv-words">
            {repo.name} → {gitRemoteLabel(repo.remote.url)}
          </p>
          {repo.remote.invalidSince === null ? null : (
            <p className="rv-note">
              {repo.remote.via === "app"
                ? "GitHub refused the app's access to this repository."
                : "The remote refused Mate's token. Replace token."}
            </p>
          )}
          {repo.remote.expiresAt == null ||
          gitRemoteExpiry(repo.remote, now) === undefined ? null : (
            <p className="rv-note">{gitRemoteExpiry(repo.remote, now)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export type { GitMirrorApp } from "./gitMirror.logic";

const NO_ENVIRONMENTS: ReadonlyArray<never> = [];
/** GitHub's page for a new fine-grained token, before the repository's URL names its owner. */
const GITHUB_NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";

export function GitRemoteSettings({
  appId,
  repos,
  appName,
  environments = NO_ENVIRONMENTS,
  can,
  actions,
  live = true,
  now: at,
  github,
  onOpenAutomation,
}: {
  readonly appId: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly appName: string;
  readonly environments?: ReadonlyArray<{
    readonly name: string;
    readonly target: { readonly kind: string };
  }>;
  readonly can?: HqOffers | undefined;
  readonly actions?: GitRemoteActions | undefined;
  readonly live?: boolean | undefined;
  readonly now?: number;
  /** The organization's GitHub app; absent: mirrored with a token only; `null`: still read. */
  readonly github?: GitMirrorApp | null;
  /** Opens Settings › Automation, where GitHub is connected. */
  readonly onOpenAutomation?: () => void;
}) {
  const clock = useNowMs();
  const now = at ?? clock;
  const listed = repos?.filter((repo) => repo.name !== RECIPE_REPO);
  const dependencies = environments
    .filter((environment) => environment.target.kind === "git")
    .map((environment) => environment.name);
  // Painted once both are read: the blocks never change shape as the app's read lands.
  const ready = listed !== undefined && github !== null;
  return (
    <div data-zerops-surface="git-remote-settings">
      {!ready ? (
        <p className="rv-note">Reading repositories…</p>
      ) : listed.length === 0 ? (
        <p className="rv-note">No code repository yet.</p>
      ) : (
        <>
          {listed.every((repo) => repo.remote == null) && dependencies.length === 0 ? (
            <p className="rv-note">{mirrorLeadLine(github ?? { kind: "unknown" })}</p>
          ) : null}
          {listed.map((repo) => (
            <Remote
              key={JSON.stringify([appId, repo.name])}
              repo={repo}
              appName={appName}
              dependencies={dependencies}
              can={can}
              actions={actions}
              live={live}
              now={now}
              github={github ?? { kind: "unknown" }}
              onOpenAutomation={onOpenAutomation}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Remote({
  repo,
  appName,
  dependencies,
  can,
  actions,
  live,
  now,
  github,
  onOpenAutomation,
}: {
  readonly repo: RepoListEntry;
  readonly appName: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly can: HqOffers | undefined;
  readonly actions: GitRemoteActions | undefined;
  readonly live: boolean;
  readonly now: number;
  readonly github: GitMirrorApp;
  readonly onOpenAutomation: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [reviewingAddress, setReviewingAddress] = useState(false);
  const [verifiedAddress, setVerifiedAddress] =
    useState<Extract<HqRemoteProbe, { readonly ok: true }>>();
  const [busy, setBusy] = useState(false);
  // Verified and sent: the line says *Saving…* until HQ's record shows the remote.
  const [awaitingRecord, setAwaitingRecord] = useState(false);
  const [answer, setAnswer] = useState<string | undefined>();
  const [disconnecting, setDisconnecting] = useState(false);
  const [unfollowing, setUnfollowing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const urlId = useId();
  const tokenId = useId();
  const repositoryId = useId();
  const allowed = (verb: string) =>
    hqOffer(can, verb, { current: live, unavailableSince: live ? null : 0 }).kind === "allowed";
  const remote = repo.remote;
  if (awaitingRecord && remote != null) setAwaitingRecord(false);
  const app = github.kind === "connected" ? github : null;
  const guide = gitTokenGuide(reviewingAddress ? url : (remote?.url ?? url), appName);
  const keep = remote == null ? actions?.connect : actions?.replaceToken;
  const permitted =
    allowed(remote == null ? "connect_remote" : "replace_remote_token") && keep !== undefined;
  // Through the app: one of its repositories, no token.
  const viaApp =
    app !== null && allowed("connect_remote") && actions?.viaApp !== undefined
      ? actions.viaApp
      : undefined;
  const pick = chosen ?? app?.repositories[0] ?? null;
  // Followed only: the way out is connecting it on GitHub through the app, or no longer following.
  const follows = remote == null ? repo.follows : undefined;
  const followedName = follows === undefined ? null : githubName(follows);
  const connectFollowed =
    viaApp !== undefined && followedName !== null && app !== null
      ? app.repositories.find((name) => name.toLowerCase() === followedName.toLowerCase())
      : undefined;
  const unfollow =
    follows !== undefined && allowed("connect_remote") ? actions?.unfollow : undefined;
  const tokenRemote = remote != null && remote.via !== "app";
  const sameRepository = tokenRemote && app !== null ? githubName(remote.url) : null;
  const switchable =
    viaApp !== undefined &&
    sameRepository !== null &&
    app !== null &&
    app.repositories.some((name) => name.toLowerCase() === sameRepository.toLowerCase());
  const showReplace = permitted && tokenRemote && !editing;
  const showReview =
    remote?.repositoryId != null &&
    remote.via !== "app" &&
    new URL(remote.url).hostname === "github.com" &&
    allowed("update_remote_address") &&
    actions?.reviewAddress !== undefined &&
    actions.updateAddress !== undefined &&
    !editing;
  const disconnectOffered =
    remote != null && allowed("disconnect_remote") && actions?.disconnect !== undefined && !editing;
  const canDisconnect = disconnectOffered && dependencies.length === 0;
  const showDisconnect = canDisconnect && !disconnecting;
  // What keeps Disconnect away, said where Disconnect would stand.
  const disconnectBlocked = disconnectOffered && dependencies.length > 0;
  const review =
    verifiedAddress === undefined || actions?.updateAddress === undefined
      ? actions?.addressReview
      : {
          repo: repo.name,
          verified: verifiedAddress,
          confirm: () => actions.updateAddress!(repo.name, verifiedAddress.remote.url),
        };
  const sameId =
    remote?.repositoryId != null &&
    review?.repo === repo.name &&
    review.verified.remote.repositoryId === remote.repositoryId &&
    new URL(remote.url).host === "github.com" &&
    new URL(review.verified.remote.url).host === "github.com";
  // HQ's own offer for this repository, answered per person; absent from an HQ that has none.
  const deleteRepository = repo.canDelete?.allow === true ? actions?.deleteRepository : undefined;
  const confirmDelete = async () => {
    if (deleteRepository === undefined || busy) return;
    setBusy(true);
    setAnswer(undefined);
    try {
      await deleteRepository(repo.name);
    } catch (cause) {
      setDeleting(false);
      setAnswer(
        cause instanceof OperationStopped
          ? cause.message
          : "HQ couldn't confirm the deletion. Check the repository list before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const stopFollowing = async () => {
    if (unfollow === undefined || busy) return;
    setBusy(true);
    setAnswer(undefined);
    try {
      await unfollow(repo.name);
      setUnfollowing(false);
    } catch (cause) {
      setAnswer(
        stoppedWords(
          cause,
          "HQ couldn't confirm it stopped following. Check it before trying again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const mirrorViaApp = async (repository: string) => {
    if (viaApp === undefined || busy) return;
    setBusy(true);
    setAnswer(undefined);
    try {
      await viaApp(repo.name, repository);
    } catch (cause) {
      setAnswer(
        stoppedWords(cause, "HQ couldn't confirm the mirror. Check it before trying again."),
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (
      !(reviewingAddress
        ? allowed("update_remote_address") && actions?.reviewAddress !== undefined
        : permitted) ||
      !token ||
      guide.kind !== "guide" ||
      busy
    )
      return;
    setBusy(true);
    setAnswer(undefined);
    const candidate = token;
    setToken("");
    try {
      const result = reviewingAddress
        ? await actions!.reviewAddress!(repo.name, url, candidate)
        : remote == null
          ? await actions!.connect!(repo.name, url, candidate)
          : await actions!.replaceToken!(repo.name, candidate);
      setAnswer(
        result.ok
          ? reviewingAddress
            ? "Address verified. Review it before updating HQ."
            : remote == null || remote.via === "app"
              ? undefined
              : "Token replaced."
          : result.reason,
      );
      if (result.ok) {
        if (reviewingAddress) setVerifiedAddress(result);
        if (remote == null) setAwaitingRecord(true);
        setEditing(false);
        setReviewingAddress(false);
      }
    } catch (cause) {
      setAnswer(
        cause instanceof OperationStopped ||
          (cause instanceof HqError &&
            cause.code === "git_probe_refused" &&
            (cause.kind === "refused" || (cause.kind === "unavailable" && cause.status === 429)))
          ? cause.message
          : "HQ couldn't confirm the token change. Check its outcome before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saving = remote == null && (awaitingRecord || (busy && !editing));
  const gate = saving ? undefined : mirrorGateLine(remote, github);
  // The token form: plain where the app is not there to mirror through, else behind its disclosure.
  const tokenForm =
    editing || (remote == null && permitted && viaApp === undefined && app === null);
  const tokenAction = reviewingAddress
    ? "Verify address"
    : remote == null
      ? "Verify and mirror"
      : "Verify and keep token";
  return (
    <section className="grid gap-2 py-3" aria-label={repo.name}>
      <div>
        <p className="rv-words">{repo.name}</p>
        <p className="rv-note" data-zerops-mirror-state="">
          {saving ? "Saving…" : mirrorStateLine(repo, github, now)}
        </p>
        {gate === undefined ? null : (
          <>
            <p className="rv-note" data-zerops-mirror-gate="">
              {gate}
            </p>
            <p className="rv-note">Mate checks GitHub's rules every minute.</p>
          </>
        )}
      </div>
      {connectFollowed !== undefined || unfollow !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          {connectFollowed !== undefined && !editing ? (
            <Button disabled={busy} size="sm" onClick={() => void mirrorViaApp(connectFollowed)}>
              Connect on GitHub
            </Button>
          ) : null}
          {unfollow !== undefined && !unfollowing ? (
            <Button
              className="ms-auto"
              disabled={busy}
              size="sm"
              variant="ghost"
              onClick={() => setUnfollowing(true)}
            >
              Stop following
            </Button>
          ) : null}
        </div>
      ) : null}
      {unfollow !== undefined && unfollowing ? (
        <div className="grid gap-2">
          <p className="rv-note">
            Stop following forgets the GitHub repository HQ follows. The repository stays on GitHub.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void stopFollowing()}
            >
              Confirm stop following
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setUnfollowing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {remote == null &&
      connectFollowed === undefined &&
      viaApp !== undefined &&
      app !== null &&
      !editing ? (
        app.repositories.length === 0 ? (
          <p className="rv-note">
            {app.name} reaches no repository yet.{" "}
            <OutLink href={app.installUrl}>Install it on repositories</OutLink>
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-56 flex-1 gap-1.5">
              <Label htmlFor={repositoryId}>GitHub repository</Label>
              <Select
                onValueChange={(next) => {
                  if (typeof next === "string") setChosen(next);
                }}
                value={pick}
              >
                <SelectTrigger id={repositoryId} size="sm">
                  <SelectValue>{pick}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {app.repositories.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button
              disabled={busy || pick === null}
              onClick={() => {
                if (pick !== null) void mirrorViaApp(pick);
              }}
              size="sm"
            >
              Mirror here
            </Button>
          </div>
        )
      ) : null}
      {(remote == null ? viaApp !== undefined : remote.via === "app") && permitted && !editing ? (
        <p className="rv-note">
          <InlineButton aria-expanded={false} onClick={() => setEditing(true)} tone="muted">
            Use a token instead
          </InlineButton>
        </p>
      ) : null}
      {remote == null && app === null && permitted ? (
        <p className="rv-note">
          Or connect GitHub in{" "}
          {onOpenAutomation === undefined ? (
            "Settings › Automation"
          ) : (
            <InlineButton onClick={onOpenAutomation}>Settings › Automation</InlineButton>
          )}{" "}
          to mirror without a token.
        </p>
      ) : null}
      {showReplace || showReview || showDisconnect || disconnectBlocked ? (
        // A mirrored repository's actions in one row; Disconnect apart, at its end.
        <div className="flex flex-wrap items-center gap-2">
          {showReplace ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Replace token
            </Button>
          ) : null}
          {showReplace && switchable ? (
            <Button
              disabled={busy}
              size="sm"
              variant="secondary"
              onClick={() => {
                if (sameRepository !== null) void mirrorViaApp(sameRepository);
              }}
            >
              Use {app.name} instead
            </Button>
          ) : null}
          {showReview && remote != null ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setUrl(remote.url);
                setVerifiedAddress(undefined);
                setReviewingAddress(true);
                setEditing(true);
              }}
            >
              Review address
            </Button>
          ) : null}
          {showDisconnect ? (
            <Button
              className="ms-auto"
              size="sm"
              variant="ghost"
              onClick={() => setDisconnecting(true)}
            >
              Disconnect
            </Button>
          ) : null}
          {disconnectBlocked ? (
            <p className="rv-note ms-auto">
              {gitRemoteLabel(remote.url)} is used by {dependencies.join(", ")}. Remove those Git
              environments first to disconnect.
            </p>
          ) : null}
        </div>
      ) : null}
      {tokenForm ? (
        <div className="grid gap-2">
          {remote == null || reviewingAddress ? (
            <div className="grid gap-1.5">
              <Label htmlFor={urlId}>Repository URL</Label>
              <Input
                nativeInput
                id={urlId}
                autoComplete="off"
                placeholder="https://github.com/owner/name"
                size="sm"
                spellCheck={false}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={tokenId}>Access token</Label>
            <Input
              nativeInput
              id={tokenId}
              aria-describedby={`${tokenId}-guide`}
              type="password"
              autoComplete="off"
              size="sm"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {guide.kind === "guide" ? (
              <p className="rv-note" id={`${tokenId}-guide`}>
                <OutLink href={guide.tokenUrl}>Create a token on {guide.hostLabel}</OutLink> ·
                Select {guide.repository} · {guide.permission}.
                {guide.host === "github"
                  ? " Workflows: Read and write is needed only if a release changes .github/workflows."
                  : null}
              </p>
            ) : (
              <p className="rv-note" id={`${tokenId}-guide`}>
                <OutLink href={GITHUB_NEW_TOKEN}>Create a token on GitHub</OutLink> · Select the
                repository · Contents, Issues and Webhooks: Read and write.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void submit();
              }}
              disabled={
                busy ||
                !(reviewingAddress ? allowed("update_remote_address") : permitted) ||
                !token ||
                guide.kind !== "guide"
              }
            >
              {tokenAction}
            </Button>
            {editing ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setToken("");
                  setEditing(false);
                  setReviewingAddress(false);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {canDisconnect && actions?.disconnect !== undefined ? (
        disconnecting ? (
          <div className="grid gap-2">
            <p className="rv-note">
              {remote.via === "app"
                ? "Disconnect stops mirroring. The repository stays on GitHub."
                : `Disconnect deletes HQ's sealed token. The token stays valid on ${new URL(remote.url).host} until you revoke it there.`}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await actions.disconnect!(repo.name);
                    setDisconnecting(false);
                  } catch (cause) {
                    setAnswer(
                      stoppedWords(
                        cause,
                        "HQ couldn't confirm disconnect. Check its outcome before trying again.",
                      ),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDisconnecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null
      ) : null}
      {sameId && allowed("update_remote_address") ? (
        <div className="grid gap-2">
          <p className="rv-note">
            Same GitHub repository · Review new address:{" "}
            {gitRemoteLabel(review!.verified.remote.url)}. Access and policy must be rechecked
            before another push.
          </p>
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await review!.confirm();
                  setVerifiedAddress(undefined);
                } catch (cause) {
                  setAnswer(
                    stoppedWords(
                      cause,
                      "HQ couldn't confirm the new address. Check its outcome before trying again.",
                    ),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Update address
            </Button>
          </div>
        </div>
      ) : null}
      {deleteRepository === undefined ? null : deleting ? (
        <div className="grid gap-2">
          <p className="rv-note">
            Delete {repo.name}? Its code is deleted from Mate. The GitHub repository, if any, stays.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
            Delete repository
          </Button>
        </div>
      )}
      {answer === undefined ? null : (
        <p className="rv-note" role="status">
          {answer}
        </p>
      )}
    </section>
  );
}
