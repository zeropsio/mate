/**
 * Connects one code repository to GitHub: the GitHub accounts the organization's apps are
 * installed on (yours first, others labelled with who added them), an account's repositories with
 * the one named like the code suggested and the ones another code repository uses visible but not
 * pickable, the explainer before leaving for GitHub to add an account, a token tab for GitLab or
 * another host, and the connect's own steps as HQ's record tells them. The connect dialog and the
 * Mate's ask card both hold it.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
import { OperationStopped } from "@t3tools/client-runtime/data";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { HqRemoteProbe, RepoListEntry } from "@t3tools/shared/hqChanges";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { DialogFooter, DialogPanel } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { useProjectFlows } from "~/zerops/projectFlows";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import {
  type GitMirrorAppEntry,
  type GitMirrorApps,
  useGitMirrorApps,
} from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { OutLink } from "../../settings/automationParts";
import {
  githubName,
  mirrorAuthorityLine,
  mirrorGateLine,
  remoteSyncedAt,
  type RepoPress,
} from "../gitMirror.logic";
import {
  connectProgress,
  explainerWords,
  freshNames,
  heldRepository,
  installationsNow,
  newRepositoryUrl,
  openingAccount,
  openingApp,
  type PickerAccount,
  pickerAccounts,
  pickerRepositories,
  rememberLeaving,
  seenBefore,
  unsealedWords,
  usedAppIds,
  waitingAccounts,
} from "./githubConnect.logic";
import { GithubTokenFields, tokenAddressReady } from "./GithubTokenFields";
import { holdPress, releasePress, useRepoPress } from "./repoPress";

export interface GithubConnectPickerProps {
  /** The HQ application the code repository is in. */
  readonly project: string;
  /** The code repository: `appdev`. */
  readonly repo: string;
  readonly apps: GitMirrorApps;
  /** Pressed Done once the repository is on GitHub; absent: no Done. */
  readonly onConnected?: () => void;
  /** `full`: a dialog's panel and footer; `compact`: inline, in an ask card. */
  readonly density?: "full" | "compact";
}

export function GithubConnectPicker({
  project,
  repo,
  apps,
  onConnected,
  density = "full",
}: GithubConnectPickerProps) {
  const orgId = useAccountOrgId();
  const session = useZeropsSessionOptional();
  const nameOf = usePersonNames(orgId ?? undefined);
  const navigation = useAtomValue(shownCanonicalHqListNavigationAtom);
  const projectNameOf = useCallback(
    (id: string) => navigation.structure?.apps.find((app) => app.id === id)?.name,
    [navigation],
  );
  const flow = useProjectFlows(useMemo(() => [project], [project])).flows.get(project);
  const repos = flow?.codeRepos ?? flow?.repos;
  const git = useGitTargetOperations(project);
  const mirror = useGitMirrorApps(true);
  const press = useRepoPress(project, repo);
  const navigate = useNavigate();
  const router = useRouter();
  // Back from GitHub, what came back is told apart from what was there before the person left.
  const [before, setBefore] = useState(() => seenBefore(project, repo));
  const writes = hqOffer(git.can, HQ_REMOTE_WRITE_VERB, {
    current: git.live,
    unavailableSince: git.live ? null : 0,
  });
  const leave = () => {
    rememberLeaving(project, repo, apps);
    setBefore(seenBefore(project, repo));
  };
  // A trip to GitHub in another tab (a new repository, the app's access) re-reads on return.
  useEffect(() => {
    const again = mirror.again;
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [mirror.again]);
  const viaApp = git.actions?.viaApp;
  const connect = git.actions?.connect;
  return (
    <GithubConnectPickerView
      admin={roleAtLeast(session?.activeOrganization?.roleCode, "ADMIN")}
      apps={apps}
      authority={mirrorAuthorityLine(writes)}
      density={density}
      entry={repos?.find((entry) => entry.name === repo)}
      fresh={freshNames(apps, before)}
      nameOf={nameOf}
      orgName={session?.activeOrganization?.name}
      press={press}
      project={project}
      projectName={projectNameOf(project) ?? repo}
      projectNameOf={projectNameOf}
      repo={repo}
      usedApps={usedAppIds(repos, repo)}
      viewerId={session?.user?.id ?? null}
      actions={{
        ...(viaApp === undefined
          ? {}
          : {
              connectViaApp: async (repository, appId) => {
                holdPress(project, repo, "connecting");
                try {
                  await viaApp(repo, repository, appId);
                } finally {
                  releasePress(project, repo, "connecting");
                }
              },
            }),
        ...(connect === undefined
          ? {}
          : {
              connectToken: async (url, token) => {
                holdPress(project, repo, "connecting");
                try {
                  return await connect(repo, url, token);
                } finally {
                  releasePress(project, repo, "connecting");
                }
              },
            }),
        install: (appId) => {
          leave();
          // Back from GitHub's install page, the project's page opens this dialog again.
          const back = new URL(
            router.buildLocation({
              to: "/group/$groupId/flow",
              params: { groupId: project },
              search: { mirror: project, repo, had: installationsNow(apps).join(",") },
            }).href,
            window.location.origin,
          ).toString();
          mirror.install(appId, back);
        },
        leaving: leave,
        openSettings: () => {
          void navigate({ to: "/settings/automation" });
        },
        ...(onConnected === undefined ? {} : { onConnected }),
      }}
    />
  );
}

export interface GithubConnectActions {
  /** Connects through the org app `appId`; resolves once HQ's record shows the remote. */
  readonly connectViaApp?: (repository: string, appId: number) => Promise<void>;
  /** Verifies a token and connects with it; resolves with the remote's answer. */
  readonly connectToken?: (url: string, token: string) => Promise<HqRemoteProbe>;
  /** Leaves for GitHub's install page of `appId`, coming back to this dialog. */
  readonly install: (appId: number) => void;
  /** The person opens GitHub in another tab: what is there now is remembered. */
  readonly leaving: () => void;
  readonly openSettings?: () => void;
  readonly onConnected?: () => void;
}

type Step = "pick" | "explain" | "token";

/** A connect this picker sent: where to, and how. */
interface Sent {
  readonly repository: string;
  readonly via:
    | { readonly kind: "app"; readonly app: GitMirrorAppEntry }
    | { readonly kind: "token" };
  /** HQ answered; its record now leads. */
  readonly answered: boolean;
}

export interface GithubConnectPickerViewProps {
  readonly project: string;
  readonly projectName: string;
  readonly repo: string;
  readonly apps: GitMirrorApps;
  /** The code repository's record; `undefined` while it is read. */
  readonly entry: RepoListEntry | undefined;
  /** The org apps the project's other repositories go through, most used first. */
  readonly usedApps: ReadonlyArray<number>;
  readonly viewerId: string | null;
  readonly admin: boolean;
  readonly orgName: string | undefined;
  readonly nameOf: (userId: string) => string | undefined;
  readonly projectNameOf: (applicationId: string) => string | undefined;
  /** Who may connect, where HQ does not let this person; `null` where it does. */
  readonly authority: string | null;
  /** Repository names (lowercased) that came back from GitHub since the person left. */
  readonly fresh: ReadonlySet<string>;
  readonly press: RepoPress;
  readonly density: "full" | "compact";
  readonly actions: GithubConnectActions;
  /** Where it opens: a fixture's step, account, pick or sent connect. */
  readonly initial?: {
    readonly step?: Step;
    readonly account?: string;
    readonly picked?: string;
    readonly sent?: Sent;
    readonly explainApp?: number;
  };
}

export function GithubConnectPickerView(props: GithubConnectPickerViewProps) {
  const { apps, repo, entry, viewerId, usedApps, fresh, actions, initial, density } = props;
  const ready = apps.kind === "ready" ? apps : null;
  const accounts = useMemo(
    () => (ready === null ? [] : pickerAccounts(ready, viewerId, usedApps)),
    [ready, usedApps, viewerId],
  );
  const held = heldRepository(entry);
  const [step, setStep] = useState<Step>(initial?.step ?? "pick");
  const [chosenAccount, setAccount] = useState<string | null>(initial?.account ?? null);
  const [chosenRepository, setPicked] = useState<string | null>(initial?.picked ?? null);
  const [explainApp, setExplainApp] = useState<number | null>(initial?.explainApp ?? null);
  const [search, setSearch] = useState("");
  const [sent, setSent] = useState<Sent | null>(initial?.sent ?? null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const account =
    accounts.find((each) => each.account === chosenAccount) ??
    accounts.find((each) => each.account === openingAccount(accounts, { repo, held, fresh })) ??
    null;
  const rows = useMemo(
    () =>
      account === null
        ? []
        : pickerRepositories({
            account,
            project: props.project,
            repo,
            held,
            fresh,
            projectNameOf: props.projectNameOf,
          }),
    [account, fresh, held, props.project, props.projectNameOf, repo],
  );
  const suggested = rows.find((row) => row.suggested)?.repository.fullName ?? null;
  const picked =
    chosenRepository !== null &&
    rows.some((row) => row.repository.fullName === chosenRepository && row.taken === null)
      ? chosenRepository
      : chosenRepository === null
        ? suggested
        : null;
  const progress =
    sent === null
      ? null
      : connectProgress({
          answered: sent.answered,
          entry:
            entry?.remote != null &&
            (sent.via.kind === "token" ||
              githubName(entry.remote.url)?.toLowerCase() === sent.repository.toLowerCase())
              ? entry
              : undefined,
          syncedAt: entry === undefined ? undefined : remoteSyncedAt(entry),
        });

  const pick = (account: PickerAccount, fullName: string) => {
    setAccount(account.account);
    setPicked(fullName);
    setRefusal(null);
  };
  const connectApp = async () => {
    if (account === null || picked === null || actions.connectViaApp === undefined) return;
    const target = { repository: picked, via: { kind: "app", app: account.app } } as const;
    setRefusal(null);
    setSent({ ...target, answered: false });
    try {
      await actions.connectViaApp(picked, account.app.appId);
      setSent({ ...target, answered: true });
    } catch (cause) {
      setSent(null);
      setRefusal(refusalWords(cause));
    }
  };
  const connectToken = async () => {
    if (actions.connectToken === undefined || token === "") return;
    const candidate = token;
    setToken("");
    setRefusal(null);
    const target = { repository: githubName(url) ?? url, via: { kind: "token" } } as const;
    setSent({ ...target, answered: false });
    try {
      const answer = await actions.connectToken(url, candidate);
      if (answer.ok) setSent({ ...target, answered: true });
      else {
        setSent(null);
        setRefusal(answer.reason);
      }
    } catch (cause) {
      setSent(null);
      setRefusal(
        cause instanceof OperationStopped ||
          (cause instanceof HqError && cause.code === "git_probe_refused")
          ? cause.message
          : "HQ couldn't confirm the connection. Check the repository's row before trying again.",
      );
    }
  };

  let body: React.ReactNode;
  let foot: React.ReactNode;
  if (sent !== null && progress !== null) {
    ({ body, foot } = progressStep({ ...props, sent, progress }));
  } else if (step === "explain") {
    ({ body, foot } = explainStep({
      ...props,
      explainApp,
      setExplainApp,
      onBack: () => setStep("pick"),
    }));
  } else if (step === "token") {
    const canVerify =
      actions.connectToken !== undefined &&
      props.authority === null &&
      token !== "" &&
      tokenAddressReady(url, props.projectName);
    body = (
      <>
        <ConnectWay onChange={(next) => setStep(next)} value="token" />
        <GithubTokenFields
          onToken={setToken}
          onUrl={setUrl}
          projectName={props.projectName}
          token={token}
          url={url}
        />
        <Refusal words={refusal ?? props.authority} />
      </>
    );
    foot = (
      <>
        <Button onClick={() => setStep("pick")} size="sm" variant="ghost">
          Back
        </Button>
        <Button disabled={!canVerify} onClick={() => void connectToken()} size="sm">
          Verify and connect
        </Button>
      </>
    );
  } else {
    ({ body, foot } = pickStep({
      ...props,
      accounts,
      account,
      rows,
      picked,
      search,
      setSearch,
      refusal,
      onPick: pick,
      onAccount: (next) => {
        setAccount(next);
        setPicked(null);
        setSearch("");
      },
      onAdd: () => setStep("explain"),
      onToken: () => setStep("token"),
      onConnect: () => void connectApp(),
    }));
  }
  const key = sent === null ? step : "progress";
  if (density === "compact")
    return (
      <div className="grid gap-3" data-github-connect="">
        <div
          className="grid animate-zerops-appear content-start gap-3 motion-reduce:animate-none"
          key={key}
        >
          {body}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">{foot}</div>
      </div>
    );
  return (
    <>
      <DialogPanel>
        <div
          className="grid min-h-72 animate-zerops-appear content-start gap-4 motion-reduce:animate-none"
          data-github-connect=""
          key={key}
        >
          {body}
        </div>
      </DialogPanel>
      <DialogFooter>{foot}</DialogFooter>
    </>
  );
}

/** HQ's refusal of a connect, in its words; a lost answer says to check before trying again. */
function refusalWords(cause: unknown): string {
  if (cause instanceof OperationStopped) return cause.message;
  return "HQ couldn't confirm the connection. Check the repository's row before trying again.";
}

function Refusal({ words }: { readonly words: string | null }) {
  return words === null ? null : (
    <p className="text-sm text-destructive-foreground" role="alert">
      {words}
    </p>
  );
}

/** GitHub app or token: the two ways in, as a segmented control. */
function ConnectWay({
  value,
  onChange,
}: {
  readonly value: "pick" | "token";
  readonly onChange: (next: "pick" | "token") => void;
}) {
  return (
    <div>
      <ToggleGroup
        aria-label="How Mate reaches the repository"
        onValueChange={(next) => {
          const chosen = next[0];
          if (chosen === "pick" || chosen === "token") onChange(chosen);
        }}
        value={[value]}
        variant="segmented"
      >
        <ToggleGroupItem value="pick">GitHub app</ToggleGroupItem>
        <ToggleGroupItem value="token">Use a token</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/** Who added an account, beside its name. */
function addedWords(
  account: PickerAccount,
  nameOf: (userId: string) => string | undefined,
): string {
  if (account.mine) return "you";
  const by = account.installation.addedBy;
  if (by === null) return "added on GitHub";
  return `added by ${nameOf(by) ?? "a teammate"}`;
}

function AccountFace({ account }: { readonly account: string }) {
  return (
    <img
      alt=""
      className="size-5 shrink-0 rounded-full bg-muted"
      height={20}
      src={`https://github.com/${encodeURIComponent(account)}.png?size=40`}
      width={20}
    />
  );
}

function pickStep(
  input: GithubConnectPickerViewProps & {
    readonly accounts: ReadonlyArray<PickerAccount>;
    readonly account: PickerAccount | null;
    readonly rows: ReturnType<typeof pickerRepositories>;
    readonly picked: string | null;
    readonly search: string;
    readonly setSearch: (search: string) => void;
    readonly refusal: string | null;
    readonly onPick: (account: PickerAccount, fullName: string) => void;
    readonly onAccount: (account: string) => void;
    readonly onAdd: () => void;
    readonly onToken: () => void;
    readonly onConnect: () => void;
  },
): { body: React.ReactNode; foot: React.ReactNode } {
  const { apps, accounts, account, rows, picked, repo, admin, orgName, nameOf, actions } = input;
  const tokenLink = (
    <div className="me-auto">
      <InlineButton onClick={input.onToken}>
        {accounts.length === 0 ? "GitLab or another host? Connect with a token" : "Use a token"}
      </InlineButton>
    </div>
  );
  if (apps.kind === "unknown")
    return {
      body: (
        <p className="text-sm text-muted-foreground">
          HQ didn't say which GitHub accounts {orgName ?? "the organization"} has added. Close this
          and open it again in a moment, or connect with a token.
        </p>
      ),
      foot: tokenLink,
    };
  const addLabel = admin
    ? "Add a GitHub account"
    : "Add your account (waits for an Owner or Admin's OK)";
  const pickable = accounts.some(
    (each) =>
      each.mine ||
      each.installation.repositories.some(
        (repository) =>
          repository.usedBy === null ||
          (repository.usedBy.application === input.project && repository.usedBy.repo === repo),
      ),
  );
  const waiting = waitingAccounts(apps);
  const waitingNote =
    waiting.length === 0 ? null : (
      <p className="text-xs text-muted-foreground">
        {waiting.join(", ")} {waiting.length === 1 ? "waits" : "wait"} for an Owner or Admin's OK in
        Settings › GitHub.
      </p>
    );
  if (!pickable) {
    return {
      body: (
        <>
          <p className="text-sm text-muted-foreground">Your GitHub accounts</p>
          <div className="grid justify-items-start gap-3 rounded-lg border border-dashed border-input p-4">
            <p className="text-sm">
              None of your GitHub accounts is added yet. Add the account that owns {repo}'s
              repository, or the one where you'll create it.
            </p>
            <Button disabled={input.authority !== null} onClick={input.onAdd} size="sm">
              {addLabel}
            </Button>
          </div>
          {accounts.length === 0 ? null : (
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">
                Accounts others added to {orgName ?? "the organization"}
              </p>
              {accounts.map((each) => (
                <div
                  className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                  key={each.account}
                >
                  <AccountFace account={each.account} />
                  <span>
                    {each.account} · {addedWords(each, nameOf)}
                  </span>
                  {pickerRepositories({
                    account: each,
                    project: input.project,
                    repo,
                    held: null,
                    fresh: input.fresh,
                    projectNameOf: input.projectNameOf,
                  }).map((row) => (
                    <span key={row.repository.fullName}>
                      <span className="font-mono text-xs">
                        {row.repository.fullName.split("/")[1]}
                      </span>{" "}
                      {row.taken ?? ""}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          {waitingNote}
          <Refusal words={input.authority} />
        </>
      ),
      foot: tokenLink,
    };
  }
  const freshHere = rows.filter((row) => row.fresh).length;
  const shown =
    input.search.trim() === ""
      ? rows
      : rows.filter((row) =>
          row.repository.fullName.toLowerCase().includes(input.search.trim().toLowerCase()),
        );
  const pickedName = picked?.split("/")[1];
  const unsealed = account !== null && account.app.setUpBy === null;
  return {
    body: (
      <>
        {freshHere === 0 || account === null ? null : (
          <p className="rounded-md bg-status-ok-surface px-3 py-2 text-sm text-status-ok-text">
            {account.account} is added ·{" "}
            {freshHere === 1 ? "1 new repository" : `${String(freshHere)} new repositories`}
          </p>
        )}
        <div aria-label="GitHub account" className="flex flex-wrap gap-1.5" role="group">
          {accounts.map((each) => (
            <button
              aria-pressed={each.account === account?.account}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border bg-background ps-1.5 pe-3 text-sm outline-none transition-[background-color,box-shadow] duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                each.account === account?.account
                  ? "border-primary ring-1 ring-primary"
                  : "border-border",
              )}
              key={each.account}
              onClick={() => input.onAccount(each.account)}
              type="button"
            >
              <AccountFace account={each.account} />
              {each.account}
              <span className="text-xs text-muted-foreground">{addedWords(each, nameOf)}</span>
            </button>
          ))}
          <button
            className="inline-flex h-8 items-center rounded-full border border-dashed border-input px-3 text-sm text-primary outline-none transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            disabled={input.authority !== null}
            onClick={input.onAdd}
            type="button"
          >
            + Add account
          </button>
        </div>
        {account === null ? null : (
          <>
            {rows.length > 5 ? (
              <Input
                aria-label="Search repositories"
                nativeInput
                onChange={(event) => input.setSearch(event.target.value)}
                placeholder={`Search ${account.account}'s repositories`}
                size="sm"
                value={input.search}
              />
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {account.app.name} reaches no repository on {account.account} yet.
              </p>
            ) : (
              <RepositoryList
                account={account}
                onPick={input.onPick}
                picked={picked}
                rows={shown}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Not listed?{" "}
              <span onClickCapture={actions.leaving}>
                <OutLink href={account.installation.manageUrl}>
                  Give {account.app.name} access on {account.account}
                </OutLink>
              </span>{" "}
              ·{" "}
              <span onClickCapture={actions.leaving}>
                <OutLink href={newRepositoryUrl(account.account, repo)}>
                  New repository on GitHub
                </OutLink>
              </span>
            </p>
          </>
        )}
        {waitingNote}
        <Refusal
          words={input.authority ?? (unsealed ? unsealedWords(account.app) : input.refusal)}
        />
      </>
    ),
    foot: (
      <>
        {tokenLink}
        <Button
          disabled={
            picked === null ||
            unsealed ||
            input.authority !== null ||
            actions.connectViaApp === undefined
          }
          onClick={input.onConnect}
          size="sm"
        >
          {pickedName === undefined ? "Connect" : `Connect ${pickedName}`}
        </Button>
      </>
    ),
  };
}

function RepositoryList({
  account,
  rows,
  picked,
  onPick,
}: {
  readonly account: PickerAccount;
  readonly rows: ReturnType<typeof pickerRepositories>;
  readonly picked: string | null;
  readonly onPick: (account: PickerAccount, fullName: string) => void;
}) {
  return (
    <div
      aria-label="Repository"
      className="grid max-h-64 overflow-y-auto rounded-lg border"
      role="radiogroup"
    >
      {rows.map((row) => {
        const name = row.repository.fullName;
        const checked = picked === name;
        const disabled = row.taken !== null;
        const words = [
          row.repository.private ? "Private" : "Public",
          row.current ? "connected now" : null,
          row.suggested && !row.current ? "name matches" : null,
        ]
          .filter((part) => part !== null)
          .join(" · ");
        return (
          <button
            aria-checked={checked}
            aria-disabled={disabled}
            className={cn(
              "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2.5 border-t px-3 py-2.5 text-left outline-none transition-colors duration-150 ease-out first:border-t-0 focus-visible:bg-accent",
              disabled ? "cursor-default" : "hover:bg-accent/60",
              row.fresh &&
                "animate-zerops-appear bg-status-busy-surface motion-reduce:animate-none",
            )}
            key={name}
            onClick={() => {
              if (!disabled) onPick(account, name);
            }}
            role="radio"
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 items-center justify-center rounded-full border",
                checked ? "border-primary" : "border-input",
              )}
            >
              {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="grid min-w-0 gap-px">
              <span
                className={cn(
                  "font-mono text-sm wrap-anywhere",
                  disabled ? "text-muted-foreground/70" : "text-foreground",
                )}
              >
                {name}
              </span>
              <span className="text-xs text-muted-foreground">{row.taken ?? words}</span>
            </span>
            {row.fresh ? (
              <Badge tone="info">New</Badge>
            ) : row.suggested ? (
              <Badge tone="info">Suggested</Badge>
            ) : (
              <span />
            )}
          </button>
        );
      })}
    </div>
  );
}

function explainStep(
  input: GithubConnectPickerViewProps & {
    readonly explainApp: number | null;
    readonly setExplainApp: (appId: number) => void;
    readonly onBack: () => void;
  },
): { body: React.ReactNode; foot: React.ReactNode } {
  const { apps, admin, orgName, nameOf, actions, repo, viewerId, usedApps } = input;
  const back = (
    <div className="me-auto">
      <Button onClick={input.onBack} size="sm" variant="ghost">
        Back
      </Button>
    </div>
  );
  const list = apps.kind === "ready" ? apps.apps : [];
  const org = orgName ?? "The organization";
  if (list.length === 0)
    return {
      body: (
        <div className="grid gap-2">
          <p className="text-base font-medium">Set up a GitHub app first</p>
          <p className="text-sm text-muted-foreground">
            {org} has no GitHub app yet. Mate connects repositories through one, set up once for the
            organization.{" "}
            {admin
              ? "You can set it up in Settings › GitHub."
              : `An Owner or Admin of ${org} sets it up in Settings › GitHub.`}
          </p>
        </div>
      ),
      foot: (
        <>
          {back}
          {admin && actions.openSettings !== undefined ? (
            <Button onClick={actions.openSettings} size="sm">
              Open Settings › GitHub
            </Button>
          ) : null}
        </>
      ),
    };
  const chosenId = input.explainApp ?? openingApp(list, viewerId, usedApps);
  const chosen = list.find((app) => app.appId === chosenId) ?? null;
  const words = chosen === null ? null : explainerWords(chosen, nameOf);
  return {
    body: (
      <>
        {list.length > 1 ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              {org} has {String(list.length)} GitHub apps. Which one goes on the account?
            </p>
            <div aria-label="GitHub app" className="grid rounded-lg border" role="radiogroup">
              {list.map((app) => {
                const checked = app.appId === chosenId;
                const disabled = app.setUpBy === null;
                return (
                  <button
                    aria-checked={checked}
                    aria-disabled={disabled}
                    className={cn(
                      "grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2.5 border-t px-3 py-2.5 text-left outline-none transition-colors duration-150 ease-out first:border-t-0 focus-visible:bg-accent",
                      disabled ? "cursor-default" : "hover:bg-accent/60",
                    )}
                    key={app.appId}
                    onClick={() => {
                      if (!disabled) input.setExplainApp(app.appId);
                    }}
                    role="radio"
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full border",
                        checked ? "border-primary" : "border-input",
                      )}
                    >
                      {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
                    </span>
                    <span className="grid min-w-0 gap-px">
                      <span
                        className={cn(
                          "text-sm",
                          disabled ? "text-muted-foreground/70" : "text-foreground",
                        )}
                      >
                        {app.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {disabled
                          ? "Waits for an Owner or Admin to confirm it in Settings › GitHub"
                          : `Owned by ${app.owner} · set up by ${app.setUpBy === viewerId ? "you" : (nameOf(app.setUpBy ?? "") ?? "a teammate")}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {chosen === null || words === null ? null : (
          <>
            <div className="grid gap-1 rounded-lg bg-muted px-3.5 py-3 text-sm">
              <span className="font-medium">GitHub asks you to install {chosen.name}</span>
              <span className="text-muted-foreground">
                {words.install} {words.about}
              </span>
            </div>
            <ol className="grid gap-2.5 text-sm">
              <ExplainStep n={1}>Pick the account that owns {repo}'s repository.</ExplainStep>
              <ExplainStep n={2}>
                Choose <span className="font-medium">Only select repositories</span> and pick it. No
                repository yet?{" "}
                <OutLink href={newRepositoryUrl(viewerAccount(apps, viewerId) ?? "", repo)}>
                  New repository on GitHub
                </OutLink>{" "}
                first.
              </ExplainStep>
              <ExplainStep n={3}>GitHub brings you back here.</ExplainStep>
            </ol>
            {admin ? null : (
              <p className="text-xs text-muted-foreground">
                What you add waits for an Owner or Admin's OK in Settings › GitHub.
              </p>
            )}
            {chosen.setUpBy === null ? <Refusal words={unsealedWords(chosen)} /> : null}
          </>
        )}
      </>
    ),
    foot: (
      <>
        {back}
        <Button
          disabled={chosen === null || chosen.setUpBy === null}
          onClick={() => {
            if (chosen !== null) actions.install(chosen.appId);
          }}
          size="sm"
        >
          Continue on GitHub
        </Button>
      </>
    ),
  };
}

/** An account the person added, to fill GitHub's new-repository page with; else none. */
function viewerAccount(apps: GitMirrorApps, viewerId: string | null): string | null {
  if (apps.kind !== "ready" || viewerId === null) return null;
  return apps.installations.find((each) => each.addedBy === viewerId)?.account ?? null;
}

function ExplainStep({ n, children }: { readonly n: number; readonly children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-5.5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function progressStep(
  input: GithubConnectPickerViewProps & {
    readonly sent: Sent;
    readonly progress: ReturnType<typeof connectProgress>;
  },
): { body: React.ReactNode; foot: React.ReactNode } {
  const { sent, progress, repo, entry, actions } = input;
  const href = sent.via.kind === "app" ? `https://github.com/${sent.repository}` : sent.repository;
  if (progress === "done") {
    const gate = mirrorGateLine(
      entry?.remote,
      sent.via.kind === "app" ? { name: sent.via.app.name, appId: sent.via.app.appId } : null,
    );
    return {
      body: (
        <div className="grid justify-items-start gap-2.5 pt-3">
          <Badge dot tone="success">
            In sync
          </Badge>
          <p className="text-lg font-medium">{repo} is on GitHub</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{sent.repository}</span> has {repo}'s main.
            Mate's next change opens there for review.
          </p>
          {gate === undefined || entry?.remote?.governance === "governed" ? null : (
            <p className="text-xs text-muted-foreground">{gate}</p>
          )}
        </div>
      ),
      foot: (
        <>
          <Button
            render={<a href={href} rel="noreferrer" target="_blank" />}
            size="sm"
            variant="secondary"
          >
            Open on GitHub
          </Button>
          {actions.onConnected === undefined ? null : (
            <Button onClick={actions.onConnected} size="sm">
              Done
            </Button>
          )}
        </>
      ),
    };
  }
  const steps: ReadonlyArray<readonly [ConnectStepName, string]> = [
    [
      "connect",
      sent.via.kind === "app"
        ? `Connecting through ${sent.via.app.name}`
        : "Connecting with the token",
    ],
    ["push", "Pushing main"],
    ...(sent.via.kind === "app" ? ([["rules", "Checking GitHub's rules on main"]] as const) : []),
  ];
  const at = steps.findIndex(([name]) => name === progress);
  return {
    body: (
      <>
        <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm">
          {repo} → <span className="font-mono">{sent.repository}</span>
        </p>
        <ol aria-live="polite" className="grid gap-2.5">
          {steps.map(([name, words], index) => (
            <li
              className={cn(
                "flex items-center gap-2.5 text-sm",
                index < at ? "text-foreground" : "text-muted-foreground",
              )}
              key={name}
            >
              <span aria-hidden="true" className="flex size-3.5 items-center justify-center">
                {index < at ? (
                  <CheckIcon className="size-3.5 text-status-ok-text" />
                ) : index === at ? (
                  <Spinner size="sm" />
                ) : (
                  <span className="size-3 rounded-full border border-border" />
                )}
              </span>
              {words}
              {index === at ? "…" : null}
            </li>
          ))}
        </ol>
      </>
    ),
    foot: (
      <p className="me-auto text-xs text-muted-foreground">
        You can close this. The project page shows the same steps.
      </p>
    ),
  };
}

type ConnectStepName = "connect" | "push" | "rules";
