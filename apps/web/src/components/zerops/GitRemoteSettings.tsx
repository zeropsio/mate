import { OperationStopped } from "@t3tools/client-runtime/data";
import { gitRemoteExpiry } from "@t3tools/client-runtime/zerops";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { HqRemoteProbe, RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { useNowMs } from "~/zerops/useNowMs";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { gitRemoteLabel } from "./GitDeliveryStatus";

/** Optional actions are supplied by the account's operations, never a component's host client. */
export interface GitRemoteActions {
  readonly replaceToken?: (repo: string, token: string) => Promise<HqRemoteProbe>;
  readonly disconnect?: (repo: string) => Promise<void>;
  readonly connect?: (repo: string, url: string, token: string) => Promise<HqRemoteProbe>;
  readonly reviewAddress?: (repo: string, url: string, token: string) => Promise<HqRemoteProbe>;
  readonly updateAddress?: (repo: string, url: string) => Promise<void>;
  readonly addressReview?: {
    readonly repo: string;
    readonly verified: Extract<HqRemoteProbe, { readonly ok: true }>;
    readonly confirm: () => Promise<void>;
  };
}

export function GitRemoteSettings({
  appId,
  repos,
  appName,
  environments = [],
  can,
  actions,
  live = true,
  now: at,
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
}) {
  const clock = useNowMs();
  const now = at ?? clock;
  const [openedFor, setOpenedFor] = useState<string>();
  const listed = repos?.filter((repo) => repo.name !== RECIPE_REPO);
  const dependencies = environments
    .filter((environment) => environment.target.kind === "git")
    .map((environment) => environment.name);
  // Once shown for this project, the list stays while the person works in it: a disconnect
  // never folds it away under them.
  if (
    openedFor !== appId &&
    (dependencies.length > 0 || listed?.some((repo) => repo.remote != null) === true)
  )
    setOpenedFor(appId);
  const connectable =
    hqOffer(can, "connect_remote", { current: live, unavailableSince: live ? null : 0 }).kind ===
      "allowed" && actions?.connect !== undefined;
  return (
    <div data-zerops-surface="git-remote-settings">
      {listed === undefined ? (
        <p className="rv-note">Reading repositories…</p>
      ) : listed.length === 0 ? (
        <p className="rv-note">No code repository yet.</p>
      ) : openedFor !== appId ? (
        <div className="flex flex-col items-start gap-2 py-3">
          <p className="rv-note">
            Connect a GitHub repository to release this project to a Git branch.
          </p>
          {connectable ? (
            <Button size="sm" variant="outline" onClick={() => setOpenedFor(appId)}>
              Connect repository
            </Button>
          ) : null}
        </div>
      ) : (
        listed.map((repo) => (
          <Remote
            key={JSON.stringify([appId, repo.name])}
            repo={repo}
            appName={appName}
            dependencies={dependencies}
            can={can}
            actions={actions}
            live={live}
            now={now}
          />
        ))
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
}: {
  readonly repo: RepoListEntry;
  readonly appName: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly can: HqOffers | undefined;
  readonly actions: GitRemoteActions | undefined;
  readonly live: boolean;
  readonly now: number;
}) {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [reviewingAddress, setReviewingAddress] = useState(false);
  const [verifiedAddress, setVerifiedAddress] =
    useState<Extract<HqRemoteProbe, { readonly ok: true }>>();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | undefined>();
  const [disconnecting, setDisconnecting] = useState(false);
  const allowed = (verb: string) =>
    hqOffer(can, verb, { current: live, unavailableSince: live ? null : 0 }).kind === "allowed";
  const remote = repo.remote;
  const guide = gitTokenGuide(reviewingAddress ? url : (remote?.url ?? url), appName);
  const keep = remote == null ? actions?.connect : actions?.replaceToken;
  const permitted =
    allowed(remote == null ? "connect_remote" : "replace_remote_token") && keep !== undefined;
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
            : "Token verified. Waiting for HQ's saved remote record."
          : result.reason,
      );
      if (result.ok) {
        if (reviewingAddress) setVerifiedAddress(result);
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
  return (
    <div className="py-3" aria-label={repo.name}>
      <p className="rv-words">
        {repo.name} · {remote == null ? "No remote connected" : gitRemoteLabel(remote.url)}
      </p>
      {remote == null ? null : (
        <>
          {gitRemoteExpiry(remote, now) === undefined ? null : (
            <p className="rv-note">{gitRemoteExpiry(remote, now)}</p>
          )}
          {remote.invalidSince === null ? null : (
            <p className="rv-note">The remote refused Mate's token. Replace token.</p>
          )}
        </>
      )}
      {permitted && !editing ? (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {remote == null ? "Connect repository" : "Replace token"}
        </Button>
      ) : null}
      {remote?.repositoryId != null &&
      new URL(remote.url).hostname === "github.com" &&
      allowed("update_remote_address") &&
      actions?.reviewAddress !== undefined &&
      actions.updateAddress !== undefined &&
      !editing ? (
        <Button
          size="sm"
          variant="outline"
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
      {editing ? (
        <div className="flex flex-col gap-2">
          {remote == null || reviewingAddress ? (
            <Input
              nativeInput
              aria-label="Repository HTTPS URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          ) : null}
          {guide.kind === "guide" ? (
            <p className="rv-note">
              <a href={guide.tokenUrl} target="_blank" rel="noreferrer">
                Create a token on {guide.hostLabel}
              </a>{" "}
              · Select {guide.repository} · {guide.permission}.
              {guide.host === "github"
                ? " Workflows: Read and write is needed only if a release changes .github/workflows."
                : null}
            </p>
          ) : (
            <p className="rv-note">Enter a repository's HTTPS URL.</p>
          )}
          <Input
            nativeInput
            aria-label="Candidate token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                busy ||
                !(reviewingAddress ? allowed("update_remote_address") : permitted) ||
                !token ||
                guide.kind !== "guide"
              }
              onClick={() => {
                void submit();
              }}
            >
              {reviewingAddress ? "Verify address" : "Verify and keep token"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setToken("");
                setEditing(false);
                setReviewingAddress(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {remote != null && dependencies.length > 0 ? (
        <p className="rv-note">
          {gitRemoteLabel(remote.url)} is used by {dependencies.join(", ")}. Remove those Git
          environments first.
        </p>
      ) : null}
      {remote != null &&
      dependencies.length === 0 &&
      allowed("disconnect_remote") &&
      actions?.disconnect !== undefined ? (
        <>
          <Button size="sm" variant="outline" onClick={() => setDisconnecting(true)}>
            Disconnect
          </Button>
          {disconnecting ? (
            <div>
              <p className="rv-note">
                Disconnect deletes HQ's sealed token. The token stays valid on{" "}
                {new URL(remote.url).host} until you revoke it there.
              </p>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await actions.disconnect!(repo.name);
                    setDisconnecting(false);
                  } catch {
                    setAnswer(
                      "HQ couldn't confirm disconnect. Check its outcome before trying again.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm disconnect
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDisconnecting(false)}>
                Cancel
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {sameId && allowed("update_remote_address") ? (
        <div>
          <p className="rv-note">
            Same GitHub repository · Review new address:{" "}
            {gitRemoteLabel(review!.verified.remote.url)}. Access and policy must be rechecked
            before another push.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await review!.confirm();
                setVerifiedAddress(undefined);
              } catch {
                setAnswer(
                  "HQ couldn't confirm the new address. Check its outcome before trying again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Update address
          </Button>
        </div>
      ) : null}
      {answer === undefined ? null : (
        <p className="rv-note" role="status">
          {answer}
        </p>
      )}
    </div>
  );
}
