import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { GitEnvironmentSetup } from "~/zerops/setUpEnvironment";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  gitAdoptionSentence,
  gitSetupBranchValid,
  gitSetupExpiry,
  gitSetupRepositories,
  gitSetupReview,
} from "./GitEnvironmentForm.logic";

export interface GitEnvironmentFormProps {
  readonly groupName: string;
  readonly tier: "stage" | "production";
  readonly defaultName: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly setup: GitEnvironmentSetup;
  readonly offered: { readonly add: boolean; readonly connect: boolean; readonly replace: boolean };
  readonly where?: ReactNode;
  readonly onCancel: () => void;
  readonly onAdded: (name: string) => void;
}

export function GitEnvironmentForm({
  groupName,
  tier,
  defaultName,
  repos,
  setup,
  offered,
  where,
  onCancel,
  onAdded,
}: GitEnvironmentFormProps) {
  const id = useId();
  const [name, setName] = useState(defaultName);
  const [branch, setBranch] = useState(tier === "production" ? "main" : "staging");
  const [adoption, setAdoption] = useState<ReadonlyArray<HqGitAdoption>>();
  const [confirmed, setConfirmed] = useState<ReadonlyArray<HqGitAdoption>>();
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const roster = gitSetupRepositories(repos);
  const review = gitSetupReview(repos, branch, adoption);
  useEffect(() => {
    if (review !== "ready") setConfirmed(undefined);
  }, [review]);
  const busy = pending !== undefined;
  const canReview =
    offered.add &&
    gitSetupBranchValid(branch) &&
    review !== "unread" &&
    review !== "empty" &&
    !busy &&
    !uncertain;
  const canAdd =
    offered.add &&
    name.trim() !== "" &&
    review === "ready" &&
    confirmed === adoption &&
    !busy &&
    !uncertain;

  const act = async (action: string, run: () => Promise<void>) => {
    if (busy || uncertain) return;
    setPending(action);
    setNotice(undefined);
    try {
      await run();
    } catch (cause) {
      if (!mounted.current) return;
      setNotice(cause instanceof Error ? cause.message : "HQ could not complete setup.");
      if (
        cause !== null &&
        typeof cause === "object" &&
        "kind" in cause &&
        cause.kind === "uncertain"
      )
        setUncertain(true);
      if (action === "add") {
        setAdoption(undefined);
        setConfirmed(undefined);
      }
    } finally {
      if (mounted.current) setPending(undefined);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="git-environment-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canAdd || adoption === undefined) return;
        void act("add", async () => {
          await setup.add({
            tier,
            name: name.trim(),
            target: { kind: "git", branch, delivery: "direct" },
            adoption,
          });
          if (mounted.current) onAdded(name.trim());
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>New {tier} environment</DialogTitle>
        <DialogDescription>
          Mate pushes to a branch in your repository. What happens next is up to how that repository
          is set up.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {where}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Environment</Label>
          <Input
            id={`${id}-name`}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-branch`}>Git branch</Label>
          <Input
            id={`${id}-branch`}
            value={branch}
            disabled={busy}
            aria-invalid={!gitSetupBranchValid(branch)}
            onChange={(event) => {
              setBranch(event.target.value);
              setAdoption(undefined);
              setConfirmed(undefined);
            }}
          />
          {!gitSetupBranchValid(branch) ? (
            <p role="alert" className="text-sm text-destructive">
              Enter an unreserved Git branch name. The mate/ prefix is reserved.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Push directly to {branch || "the branch"}: Mate must be the only one that writes to it.
            A commit made on {branch || "the branch"} any other way stops Mate’s pushes until you
            settle it. Its branch and direct mode stay fixed; to change them, remove this
            environment and add it again.
          </p>
        </div>
        <section aria-label="Git repositories" className="space-y-3">
          <h3 className="text-sm font-medium">Code repositories</h3>
          {roster === undefined ? (
            <p className="text-sm text-muted-foreground">Reading the application’s repositories…</p>
          ) : roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No code repositories have been recorded yet.
            </p>
          ) : (
            roster.map(({ repo, leftOut }) => (
              <RemoteSetup
                key={repo.name}
                repo={repo}
                groupName={groupName}
                leftOut={leftOut}
                disabled={busy || uncertain}
                connectOffered={repo.remote == null ? offered.connect : offered.replace}
                onConnect={(url, token) => {
                  void act(`connect:${repo.name}`, async () => {
                    const connecting = setup.connect(repo.name, url, token, repo.remote != null);
                    token = "";
                    const result = await connecting;
                    if (!mounted.current) return;
                    setAdoption(undefined);
                    setConfirmed(undefined);
                    setNotice(
                      result.ok
                        ? `${repo.name}: token verified and connected. Waiting for HQ’s repository record if it has not arrived yet.`
                        : `${repo.name}: ${result.reason}`,
                    );
                  });
                }}
              />
            ))
          )}
        </section>
        {notice === undefined ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {uncertain ? (
          <p className="text-sm text-muted-foreground">
            HQ may have accepted setup. Close this form and check the environment and repository
            records before trying again.
          </p>
        ) : null}
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            disabled={!canReview}
            onClick={() => {
              void act("preview", async () => {
                const result = await setup.preview(branch);
                if (mounted.current) {
                  setAdoption(result);
                  setConfirmed(undefined);
                }
              });
            }}
          >
            {pending === "preview" ? "Reading branch review…" : "Review branch"}
          </Button>
          {review === "stale" ? (
            <p role="alert" className="text-sm text-destructive">
              The branch, HQ main or repository roster changed while this was being reviewed. Review
              it again.
            </p>
          ) : null}
          {adoption?.map((entry) => (
            <p className="text-sm" key={entry.repo}>
              {entry.repo}: {gitAdoptionSentence(entry)}
              {entry.seed ? " HQ starts from the remote’s files." : ""}
            </p>
          ))}
          {review === "ready" ? (
            <div className="flex items-start gap-2">
              <Checkbox
                id={`${id}-confirm`}
                checked={confirmed === adoption}
                disabled={busy}
                onCheckedChange={(checked) => setConfirmed(checked === true ? adoption : undefined)}
              />
              <Label htmlFor={`${id}-confirm`}>
                I confirm these exact file counts before HQ main moves.
              </Label>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {tier === "production"
              ? "Adding production pushes nothing. It starts with the next Release."
              : "Adoption before attachment pushes nothing to this stage. Its first push follows the next main move."}{" "}
            Verified remotes stay connected if you cancel environment setup.
          </p>
        </div>
        {pending === undefined ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {pending === "add"
              ? "Adding environment… HQ may accept it even if you close this form."
              : pending.startsWith("connect:")
                ? "Testing the token and connecting the remote…"
                : "Reading the remote branch and HQ main…"}
          </p>
        )}
        {!offered.add ? (
          <p className="text-sm text-muted-foreground">
            HQ is not offering Git environment setup right now. Zerops remains available where HQ
            allows it.
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {pending === "add" ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" disabled={!canAdd}>
          {pending === "add" ? "Adding…" : `Add ${tier} to ${groupName}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RemoteSetup({
  repo,
  groupName,
  leftOut,
  disabled,
  connectOffered,
  onConnect,
}: {
  readonly repo: RepoListEntry;
  readonly groupName: string;
  readonly leftOut: string | undefined;
  readonly disabled: boolean;
  readonly connectOffered: boolean;
  readonly onConnect: (url: string, token: string) => void;
}) {
  const id = useId();
  const [url, setUrl] = useState(repo.remote?.url ?? "");
  const tokenInput = useRef<HTMLInputElement>(null);
  const [hasToken, setHasToken] = useState(false);
  const guide = gitTokenGuide(repo.remote?.url ?? url, groupName);
  const connected = repo.remote != null && leftOut === undefined;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">
        {repo.name} · {connected ? "Included" : "Left out"}
      </p>
      {leftOut === undefined ? null : <p className="text-xs text-muted-foreground">{leftOut}</p>}
      {repo.remote == null ? (
        <>
          <Label htmlFor={`${id}-url`}>Repository HTTPS URL for {repo.name}</Label>
          <Input
            id={`${id}-url`}
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            disabled={disabled}
            aria-invalid={guide.kind === "invalid"}
            onChange={(event) => {
              setUrl(event.target.value);
              if (tokenInput.current !== null) tokenInput.current.value = "";
              setHasToken(false);
            }}
          />
        </>
      ) : (
        <>
          <p className="break-all text-xs text-muted-foreground">{repo.remote.url}</p>
          <p className="text-xs text-muted-foreground">{gitSetupExpiry(repo.remote.expiresAt)}</p>
        </>
      )}
      {connected ? null : (
        <>
          {guide.kind === "invalid" ? (
            <p role="alert" className="text-sm text-destructive">
              Enter a credential-free HTTPS repository URL. SSH URLs are not supported.
            </p>
          ) : guide.kind === "guide" ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {guide.hostLabel} · {guide.repository}
              </p>
              {guide.host === "github" ? (
                <>
                  <p>
                    Create a fine-grained personal access token. Resource owner: {guide.owner}.
                    Under Repository access, choose Only select repositories → {guide.repository}.
                    The link cannot select it for you.
                  </p>
                  <p>
                    {guide.permission} is required. Workflows: Read and write is optional; keep it
                    if releases change .github/workflows. Your organization may require approval or
                    limit its lifetime.
                  </p>
                </>
              ) : (
                <p>
                  Create a personal access token with {guide.permission}. Check {guide.hostLabel}’s
                  settings; other hosts may use different permission names.
                </p>
              )}
              <a
                className="text-primary underline underline-offset-2"
                href={guide.tokenUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {guide.host === "unknown"
                  ? "Open likely token settings"
                  : `Create ${guide.hostLabel} token`}
              </a>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter the repository URL to see which token to create.
            </p>
          )}
          <Label htmlFor={`${id}-token`}>Token for {repo.name}</Label>
          <Input
            id={`${id}-token`}
            ref={tokenInput}
            type="password"
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setHasToken(event.target.value.trim() !== "")}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !connectOffered || !hasToken || guide.kind !== "guide"}
            onClick={() => {
              const candidate = tokenInput.current?.value.trim() ?? "";
              if (tokenInput.current !== null) tokenInput.current.value = "";
              setHasToken(false);
              if (candidate !== "" && guide.kind === "guide")
                onConnect(repo.remote?.url ?? url.trim(), candidate);
            }}
          >
            Test and connect {repo.name}
          </Button>
        </>
      )}
    </div>
  );
}
