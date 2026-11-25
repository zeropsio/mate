import { deriveEnvironmentName } from "@t3tools/shared/hqEnvironment";
import {
  tokenExpiryLabel,
  type HqGitAdoption,
  type RepoListEntry,
} from "@t3tools/shared/hqChanges";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { GitEnvironmentSetup } from "~/zerops/setUpEnvironment";
import { Button } from "../ui/button";
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
  gitCiAccessRows,
  gitSetupBranchValid,
  gitSetupRepository,
  gitSetupRepositoryHint,
  gitSetupRepositories,
  gitSetupReview,
} from "./GitEnvironmentForm.logic";
import { Loading } from "~/components/ui/loading";
import { Text } from "~/components/ui/text";

export interface GitEnvironmentFormProps {
  readonly groupName: string;
  readonly tier: "stage" | "production";
  readonly defaultName: string;
  readonly takenNames: ReadonlyArray<string> | undefined;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly setup: GitEnvironmentSetup;
  readonly offered: { readonly add: boolean; readonly connect: boolean; readonly replace: boolean };
  /** HQ’s own reason this person cannot add a Git environment. */
  readonly unavailableReason?: string | undefined;
  readonly onBack?: () => void;
  readonly onCancel: () => void;
  readonly onAdded: (name: string) => void;
}

export function GitEnvironmentForm({
  groupName,
  tier,
  defaultName,
  takenNames,
  repos,
  setup,
  offered,
  unavailableReason,
  onBack,
  onCancel,
  onAdded,
}: GitEnvironmentFormProps) {
  const name =
    takenNames === undefined ? undefined : deriveEnvironmentName(defaultName, tier, takenNames);
  const id = useId();
  const [step, setStep] = useState<"repository" | "token" | "branch">("repository");
  const [address, setAddress] = useState("");
  const [branch, setBranch] = useState(tier === "production" ? "main" : "staging");
  const [readBranch, setReadBranch] = useState(branch);
  const [preview, setPreview] = useState<{
    key: string;
    adoption?: ReadonlyArray<HqGitAdoption>;
    error?: string;
  }>();
  const [pending, setPending] = useState<"connect" | "add">();
  const [notice, setNotice] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const [token, setToken] = useState("");
  const [tested, setTested] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const repository = gitSetupRepository(repos, address, groupName);
  const remote = repository?.existing?.remote;
  const connected = repository?.connected === true;
  const previewKey =
    step === "branch" && connected && offered.add && gitSetupBranchValid(readBranch) && !uncertain
      ? JSON.stringify([
          readBranch,
          gitSetupRepositories(repos)?.map(({ repo, leftOut }) => [
            repo.name,
            repo.mainHead,
            repo.remote?.url,
            repo.remote?.repositoryId,
            leftOut,
          ]),
        ])
      : undefined;
  const adoption =
    branch === readBranch && preview?.key === previewKey ? preview?.adoption : undefined;
  const reading = previewKey !== undefined && preview?.key !== previewKey;
  const review = gitSetupReview(repos, readBranch, adoption);
  const busy = pending !== undefined || reading;
  const canAdd =
    step === "branch" &&
    name !== undefined &&
    connected &&
    offered.add &&
    gitSetupBranchValid(branch) &&
    readBranch === branch &&
    review === "ready" &&
    !busy &&
    !uncertain;
  const readPreview = useEffectEvent((value: string) => setup.preview(value));
  // Read once for the chosen branch and exact repository evidence, never on a timer.
  useEffect(() => {
    if (previewKey === undefined) return;
    let current = true;
    void readPreview(readBranch).then(
      (result) => {
        if (current) setPreview({ key: previewKey, adoption: result });
      },
      (cause: unknown) => {
        if (current)
          setPreview({
            key: previewKey,
            error: cause instanceof Error ? cause.message : "HQ could not read the branch.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [previewKey, readBranch]);

  async function act(action: "connect" | "add", run: () => Promise<void>) {
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
      if (action === "add" && previewKey !== undefined) setPreview({ key: previewKey });
    } finally {
      if (mounted.current) setPending(undefined);
    }
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="git-environment-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === "repository") {
          if (repository && !busy && !uncertain) setStep(connected ? "branch" : "token");
        } else if (step === "token") {
          if (connected && !busy && !uncertain) setStep("branch");
        } else {
          setReadBranch(branch);
          if (!canAdd || adoption === undefined || name === undefined) return;
          void act("add", async () => {
            await setup.add({
              tier,
              name,
              target: { kind: "git", branch, delivery: "direct" },
              adoption,
            });
            if (mounted.current) onAdded(name);
          });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {step === "token" ? "A token that may write to it" : "A branch in your Git repository"}
        </DialogTitle>
        <DialogDescription>
          {step === "token"
            ? `Give Mate access to ${repository?.guide.repository ?? "your repository"}.`
            : "Mate pushes there. What that repository does with a push is up to how it is set up."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {step === "repository" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-repository`}>Repository</Label>
            <Input
              id={`${id}-repository`}
              value={address}
              placeholder="github.com/acme/app"
              autoComplete="off"
              spellCheck={false}
              disabled={busy || uncertain}
              onChange={(event) => {
                setAddress(event.target.value);
                setTested(false);
                setPreview(undefined);
                setNotice(undefined);
              }}
            />
            <Text render={<p />} variant="note">
              {repository
                ? `${repository.guide.hostLabel} · a token comes next`
                : "A token comes next"}
            </Text>
            {address.trim() !== "" && repos !== undefined && repository === undefined ? (
              <p role="alert" className="text-body text-destructive">
                {gitSetupRepositoryHint(address)}
              </p>
            ) : null}
            {repos === undefined ? (
              <Text render={<p />} variant="note">
                Reading the application’s repositories…
              </Text>
            ) : null}
            {connected ? (
              <p className="text-body">
                {address} is already connected to {groupName}.
              </p>
            ) : null}
          </div>
        ) : null}
        {step === "token" && repository ? (
          <div className="space-y-3">
            {repository.guide.host === "github" ? (
              <>
                <p className="text-body">
                  Create a fine-grained token on GitHub for {repository.guide.repository} only. The
                  link fills in the name, owner, expiry and permissions.
                </p>
                <Button
                  className="-ms-2.5"
                  render={
                    <a href={repository.guide.tokenUrl} rel="noopener noreferrer" target="_blank" />
                  }
                  size="sm"
                  variant="link"
                >
                  Create the token on GitHub
                </Button>
                <p className="text-body">
                  On GitHub, under Repository access choose Only select repositories and pick{" "}
                  {repository.guide.repository} — the link cannot do it for you.
                </p>
                <p className="text-body font-medium">On GitHub, check that it says</p>
                <ul className="space-y-1 text-body">
                  <li>Resource owner: {repository.guide.owner}</li>
                  <li>
                    Repository access: Only select repositories → {repository.guide.repository}
                  </li>
                  <li>{repository.guide.permission}</li>
                  <li>Workflows: Read and write (optional)</li>
                  <li>Expiration: 366 days</li>
                </ul>
                <Text render={<p />} variant="note">
                  Your organization may require approval or limit the token’s lifetime.
                </Text>
              </>
            ) : (
              <>
                <p className="text-body">
                  Create a personal access token with {repository.guide.permission}. Check{" "}
                  {repository.guide.hostLabel}’s settings; other hosts may use different permission
                  names.
                </p>
                <Button
                  className="-ms-2.5"
                  render={
                    <a href={repository.guide.tokenUrl} rel="noopener noreferrer" target="_blank" />
                  }
                  size="sm"
                  variant="link"
                >
                  {repository.guide.host === "unknown"
                    ? "Open likely token settings"
                    : `Create ${repository.guide.hostLabel} token`}
                </Button>
              </>
            )}
            <Label htmlFor={`${id}-token`}>Token</Label>
            <Input
              id={`${id}-token`}
              type="password"
              value={token}
              autoComplete="off"
              disabled={busy || uncertain}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={
                busy ||
                uncertain ||
                token.trim() === "" ||
                !(repository.sameRemote ? offered.replace : offered.connect)
              }
              onClick={() => {
                const candidate = token.trim();
                setToken("");
                if (candidate === "") return;
                void act("connect", async () => {
                  const result = await setup.connect(
                    repository.name,
                    repository.url,
                    candidate,
                    repository.sameRemote,
                  );
                  if (!mounted.current) return;
                  setTested(result.ok);
                  setNotice(result.ok ? undefined : result.reason);
                });
              }}
            >
              Test
            </Button>
            <Text render={<p />} variant="note">
              Mate keeps it in HQ. Agents and containers never see it.
            </Text>
            {pending === "connect" ? (
              <p role="status" className="text-body">
                Testing the token against {repository.guide.repository}…
              </p>
            ) : null}
            {tested && !connected ? (
              <p role="status" className="text-body">
                Token verified. Waiting for HQ’s repository record.
              </p>
            ) : null}
            {connected ? (
              <ul aria-label="Token test results" className="space-y-1 text-body">
                <li>Sees {repository.guide.repository}</li>
                <li>Can push to {repository.guide.repository}</li>
                <li className="text-muted-foreground">
                  A release that changes .github/workflows needs Workflows: Read and write, which
                  Mate can’t test.
                </li>
                <li>{tokenExpiryLabel(remote?.expiresAt ?? null)}</li>
              </ul>
            ) : null}
          </div>
        ) : null}
        {step === "branch" ? (
          <div className="space-y-3">
            <p className="break-all text-body">{repository?.url}</p>
            <Label htmlFor={`${id}-branch`}>Branch</Label>
            <Input
              id={`${id}-branch`}
              value={branch}
              disabled={pending !== undefined || uncertain}
              aria-invalid={!gitSetupBranchValid(branch)}
              onChange={(event) => {
                setBranch(event.target.value);
              }}
              onBlur={() => setReadBranch(branch)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  setReadBranch(branch);
                }
              }}
            />
            {!gitSetupBranchValid(branch) ? (
              <p role="alert" className="text-body text-destructive">
                Enter an unreserved Git branch name. The mate/ prefix is reserved.
              </p>
            ) : null}
            <p className="text-body font-medium">How Mate hands over</p>
            <p className="text-body">
              Push directly to {branch || "the branch"} — Mate must be the only one that writes to
              it.
            </p>
            <Text render={<p />} variant="note">
              A commit made on {branch || "the branch"} any other way stops Mate’s pushes until you
              settle it.
            </Text>
            {reading ? (
              <p role="status" className="text-body">
                Reading the remote branch and HQ main…
              </p>
            ) : null}
            {review === "ready"
              ? adoption?.map((entry) => (
                  <div key={entry.repo} className="space-y-1 text-body">
                    {entry.branchRules === "none_on_plan" ? (
                      <p>No branch rules on this plan</p>
                    ) : null}
                    {entry.ci ? (
                      <Text render={<ul />} variant="note" aria-label="Reads to show CI">
                        <li>Optional, to show CI:</li>
                        {gitCiAccessRows(entry.ci).map((row) => (
                          <li key={row}>{row}</li>
                        ))}
                      </Text>
                    ) : null}
                    <p>
                      {gitAdoptionSentence(entry)}
                      {entry.seed ? " HQ starts from the remote’s files." : ""}
                    </p>
                  </div>
                ))
              : null}
            <Text render={<p />} variant="note">
              {tier === "production"
                ? "Adding production pushes nothing. It starts with the next Release."
                : "Adoption before attachment pushes nothing to this stage. Its first push follows the next main move."}{" "}
              Verified remotes stay connected if you cancel environment setup.
            </Text>
          </div>
        ) : null}
        {preview?.key === previewKey && preview?.error ? (
          <Text render={<p />} variant="description" role="status">
            {preview.error}
          </Text>
        ) : null}
        {step === "branch" && name === undefined ? (
          takenNames === undefined ? (
            <Loading label="This project's environment names" shape="line" />
          ) : (
            <Text render={<p />} variant="description" role="status">
              This project has used all generated names. Remove an unused environment before adding
              another.
            </Text>
          )
        ) : null}
        {notice ? (
          <Text render={<p />} variant="description" role="status">
            {notice}
          </Text>
        ) : null}
        {uncertain ? (
          <Text render={<p />} variant="description">
            HQ may have accepted setup. Close this form and check the environment and repository
            records before trying again.
          </Text>
        ) : null}
        {pending === "add" ? (
          <Text render={<p />} variant="description" role="status">
            Adding environment… HQ may accept it even if you close this form.
          </Text>
        ) : null}
        {!offered.add ? (
          <Text render={<p />} variant="description">
            {unavailableReason ?? "HQ has not said yet."}
          </Text>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {pending === "add" ? "Close" : "Cancel"}
        </Button>
        {step !== "repository" || onBack ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setToken("");
              if (step === "repository") onBack?.();
              else setStep("repository");
            }}
          >
            Back
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={
            step === "repository"
              ? repository === undefined || busy || uncertain
              : step === "token"
                ? !connected || busy || uncertain
                : !canAdd
          }
        >
          {step !== "branch"
            ? "Continue"
            : pending === "add"
              ? "Adding…"
              : `Add ${tier} to ${groupName}`}
        </Button>
      </DialogFooter>
    </form>
  );
}
