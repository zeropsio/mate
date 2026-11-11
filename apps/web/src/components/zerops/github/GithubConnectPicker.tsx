/**
 * Connects one code repository to GitHub: the GitHub accounts the organization's apps are
 * installed on (yours first, a teammate's labelled with who added it), an account's repositories
 * with the one named like the code suggested and the ones another code repository uses visible but
 * not pickable, the explainer before leaving for GitHub to add an account, a token tab for GitLab
 * or another host, and the connect's own steps as HQ's record tells them. The trip to GitHub never
 * starts with another person's own app (`openingApp`): where the organization has no app of its
 * own, the step says so and leads to making one. The connect dialog and the Mate's ask card both
 * hold it: a dialog's footer ends in its main press, a card's starts with it, as every ask's does,
 * and ends in what the card adds (`footerEnd`: its *Not now*).
 */
import { useAtomValue } from "@effect/atom-react";
import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
import { OperationStopped } from "@t3tools/client-runtime/data";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
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
import { cn, randomUUID } from "~/lib/utils";
import { useProjectFlows } from "~/zerops/projectFlows";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import {
  type GitMirrorAppEntry,
  type GitMirrorApps,
  type GitMirrorInstallAction,
  useGitMirrorApps,
} from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { OutLink } from "../../settings/automationParts";
import { hostWords, mirrorAuthorityLine, mirrorGateLine, remoteSyncedAt } from "../gitMirror.logic";
import {
  connectProgress,
  explainerWords,
  freshNames,
  heldRepository,
  installWay,
  newRepositoryUrl,
  noOwnAppWords,
  openingAccount,
  openingApp,
  ownApps,
  type PickerAccount,
  pickerAccounts,
  pickerRepositories,
  readAfterReturn,
  rememberLeaving,
  rememberSeen,
  returnWithSeen,
  SEEN_PARAM,
  seenBefore,
  type PickerRepository,
  unansweredCount,
  unsealedWords,
  usedAppIds,
  waitingAccounts,
} from "./githubConnect.logic";
import { GithubTokenFields, tokenAddressReady } from "./GithubTokenFields";
import {
  dropPress,
  type HeldPress,
  holdPress,
  type PressState,
  pressShown,
  useRepoPress,
} from "./repoPress";

export interface GithubConnectPickerProps {
  /** The HQ application the code repository is in. */
  readonly project: string;
  /** The code repository: `appdev`. */
  readonly repo: string;
  readonly apps: GitMirrorApps;
  /**
   * Where GitHub's install page comes back to; absent: the project's page, which opens this dialog
   * again. Repositories the trip adds read as new wherever the picker opens there.
   */
  readonly returnTo?: string;
  /** Pressed Done once the repository is on GitHub; absent: no Done. */
  readonly onConnected?: () => void;
  /** `full`: a dialog's panel and footer; `compact`: inline, in an ask card. */
  readonly density?: "full" | "compact";
  /** In an ask card: what ends its footer's one row, after the picker's own presses (*Not now*). */
  readonly footerEnd?: React.ReactNode;
}

export function GithubConnectPicker({
  project,
  repo,
  apps,
  returnTo,
  onConnected,
  density = "full",
  footerEnd,
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
  const entry = repos?.find((each) => each.name === repo);
  const git = useGitTargetOperations(project);
  const mirror = useGitMirrorApps(true);
  const press = useRepoPress(orgId, project, repo, entry);
  const navigate = useNavigate();
  const router = useRouter();
  // Back from GitHub, what came back is told apart from what was there before the person left.
  const [before, setBefore] = useState(() => {
    // Back from an install trip to a page that keeps its address (a conversation).
    const here = new URL(window.location.href).searchParams;
    rememberSeen(here.get(SEEN_PARAM), here.get("github"));
    return seenBefore(project, repo);
  });
  // Back from GitHub, HQ is asked once for what GitHub now says; after that, only on Check again or Try again.
  const again = mirror.again;
  useEffect(() => {
    if (seenBefore(project, repo)?.fresh !== true) return;
    readAfterReturn(project, repo);
    again();
  }, [again, project, repo]);
  const writes = hqOffer(git.can, HQ_REMOTE_WRITE_VERB);
  const leave = () => {
    rememberLeaving(project, repo, apps);
    setBefore(seenBefore(project, repo));
  };
  const send = git.send;
  const connect = git.actions?.connect;
  return (
    <GithubConnectPickerView
      actions={{
        ...(send === undefined
          ? {}
          : {
              connectViaApp: async (repository, app) => {
                const held: HeldPress = {
                  kind: "connect",
                  requestId: randomUUID(),
                  target: repository,
                  via: "app",
                  appName: app.name,
                };
                holdPress(orgId, project, repo, held);
                try {
                  await send.viaApp(repo, repository, app.appId, held.requestId!);
                  return null;
                } catch (cause) {
                  // Never recorded: nothing follows it, so the picker says what stopped it.
                  dropPress(orgId, project, repo, held);
                  return refusalWords(cause);
                }
              },
            }),
        ...(connect === undefined
          ? {}
          : {
              connectToken: async (url, token) => {
                const held: HeldPress = {
                  kind: "connect",
                  requestId: null,
                  target: url,
                  via: "token",
                  appName: null,
                };
                holdPress(orgId, project, repo, held);
                try {
                  const answer = await connect(repo, url, token);
                  if (!answer.ok) dropPress(orgId, project, repo, held);
                  return answer.ok ? null : answer.reason;
                } catch (cause) {
                  dropPress(orgId, project, repo, held);
                  return cause instanceof OperationStopped ||
                    (cause instanceof HqError && cause.code === "git_probe_refused")
                    ? cause.message
                    : "HQ couldn't confirm the connection. Check the repository's row before trying again.";
                }
              },
            }),
        install: async (appId) => {
          leave();
          // Back from GitHub's install page, the project's page opens this dialog again.
          const back = returnWithSeen(
            returnTo ??
              router.buildLocation({
                to: "/group/$groupId/flow",
                params: { groupId: project },
                search: { mirror: project, repo },
              }).publicHref,
            project,
            repo,
            apps,
          );
          return mirror.install(appId, back);
        },
        again,
        leaving: leave,
        dismiss: () => {
          if (press.kind !== "none") dropPress(orgId, project, repo, press.press);
        },
        openSettings: () => {
          void navigate({ to: "/settings/automation" });
        },
        ...(onConnected === undefined ? {} : { onConnected }),
      }}
      admin={roleAtLeast(session?.activeOrganization?.roleCode, "ADMIN")}
      apps={apps}
      authority={mirrorAuthorityLine(writes)}
      density={density}
      footerEnd={footerEnd}
      entry={entry}
      fresh={freshNames(apps, before)}
      installing={mirror.installing}
      nameOf={nameOf}
      orgName={session?.activeOrganization?.name}
      press={press}
      project={project}
      projectName={projectNameOf(project) ?? repo}
      projectNameOf={projectNameOf}
      repo={repo}
      returned={before?.returned ?? null}
      usedApps={usedAppIds(repos, repo)}
      viewerId={session?.user?.id ?? null}
    />
  );
}

export interface GithubConnectActions {
  /**
   * Sends a connect through the org app; the press follows it through its operation's record.
   * Resolves with what stopped it where it could not be sent, else `null`.
   */
  readonly connectViaApp?: (repository: string, app: GitMirrorAppEntry) => Promise<string | null>;
  /** Verifies a token and connects with it; resolves with the remote's refusal, else `null`. */
  readonly connectToken?: (url: string, token: string) => Promise<string | null>;
  /** Leaves through HQ's install trip for `appId`; resolves `false` where HQ refused. */
  readonly install: (appId: number) => Promise<boolean>;
  /** Asks HQ again what the organization's apps reach. */
  readonly again: () => void;
  /** The person opens GitHub in another tab: what is there now is remembered. */
  readonly leaving: () => void;
  /** Lets a refused or unconfirmed press go. */
  readonly dismiss: () => void;
  readonly openSettings?: () => void;
  readonly onConnected?: () => void;
}

type Step = "pick" | "explain" | "token";

/**
 * A step, drawn: its body, a dialog's footer (`foot`: its main press last) and an ask card's
 * (`card`: its main press first, as every ask's footer has it).
 */
interface StepParts {
  readonly body: React.ReactNode;
  readonly foot: React.ReactNode;
  readonly card: React.ReactNode;
}

/** A step's own title: a dialog's stands out; in an ask card it stays under the card's title. */
const stepTitle = (density: "full" | "compact") =>
  density === "compact" ? "text-sm font-medium" : "text-base font-medium";

/** A footer press's size: a dialog's are small, an ask card's the size of every ask's. */
const pressSize = (density: "full" | "compact") => (density === "compact" ? "md" : "sm");

/** A connect this picker sent: where to, and how. */
interface Sent {
  /** `owner/name` through an app; the address with a token. */
  readonly target: string;
  readonly app: GitMirrorAppEntry | null;
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
  /** What GitHub said on the way back from its install page. */
  readonly returned: "requested" | "waiting" | null;
  /** The repository's held press, followed through its operation. */
  readonly press: PressState;
  /** This person's install trip: asked, or refused in HQ's words. */
  readonly installing: GitMirrorInstallAction;
  readonly density: "full" | "compact";
  readonly footerEnd?: React.ReactNode;
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
  const { apps, repo, entry, viewerId, usedApps, fresh, actions, initial, density, press } = props;
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
  // The install trip pressed and not refused: one press leaves once.
  const [leavingFor, setLeavingFor] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const [pageOpened, setPageOpened] = useState(false);
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
  const pickedRow = rows.find((row) => row.repository.fullName === picked) ?? null;
  // A press under way leads, wherever it was sent from (the dialog closed and opened again).
  const working = press.kind === "working" && press.press.kind === "connect" ? press.press : null;
  const target: Sent | null =
    working !== null && working.target !== null
      ? {
          target: working.target,
          app:
            working.via === "app"
              ? (ready?.apps.find((app) => app.name === working.appName) ?? sent?.app ?? null)
              : null,
        }
      : sent;
  // The record's remote is read only once it is the one being connected.
  const reached =
    target !== null &&
    pressShown(
      {
        kind: "connect",
        requestId: null,
        target: target.target,
        via: target.app === null ? "token" : "app",
        appName: null,
      },
      entry,
    );
  const progress =
    target === null || press.kind === "refused" || press.kind === "unconfirmed"
      ? null
      : working !== null || !reached
        ? "connect"
        : connectProgress({
            answered: true,
            entry,
            syncedAt: entry === undefined ? undefined : remoteSyncedAt(entry),
          });
  const pressWords = press.kind === "refused" || press.kind === "unconfirmed" ? press.words : null;

  const pick = (account: PickerAccount, fullName: string) => {
    setAccount(account.account);
    setPicked(fullName);
    setRefusal(null);
  };
  const connectApp = async () => {
    if (pickedRow === null || actions.connectViaApp === undefined || working !== null) return;
    setRefusal(null);
    setSent({ target: pickedRow.repository.fullName, app: pickedRow.app });
    const stopped = await actions.connectViaApp(pickedRow.repository.fullName, pickedRow.app);
    if (stopped !== null) {
      setSent(null);
      setRefusal(stopped);
    }
  };
  const connectToken = async () => {
    if (actions.connectToken === undefined || token === "" || working !== null) return;
    const candidate = token;
    setToken("");
    setRefusal(null);
    setSent({ target: url, app: null });
    const stopped = await actions.connectToken(url, candidate);
    if (stopped !== null) {
      setSent(null);
      setRefusal(stopped);
    }
  };

  let body: React.ReactNode;
  let foot: React.ReactNode;
  let card: React.ReactNode;
  const size = pressSize(density);
  if (target !== null && progress !== null) {
    ({ body, foot, card } = progressStep({ ...props, sent: target, progress }));
  } else if (step === "explain") {
    ({ body, foot, card } = explainStep({
      ...props,
      explainApp,
      setExplainApp,
      onBack: () => setStep("pick"),
      pending: leavingFor !== null || props.installing.kind === "working",
      installRefusal:
        tried && leavingFor === null && props.installing.kind === "refused"
          ? props.installing.words
          : null,
      onTrip: (app) => {
        if (leavingFor !== null) return;
        setLeavingFor(app.appId);
        setTried(true);
        void actions.install(app.appId).then((left) => {
          if (!left) setLeavingFor(null);
        });
      },
      pageOpened,
      onPage: () => {
        actions.leaving();
        setPageOpened(true);
      },
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
        <Refusal words={refusal ?? pressWords ?? props.authority} />
      </>
    );
    const back = (
      <Button onClick={() => setStep("pick")} size={size} variant="ghost">
        Back
      </Button>
    );
    const verify = (
      <Button disabled={!canVerify} onClick={() => void connectToken()} size={size}>
        Verify and connect
      </Button>
    );
    foot = (
      <>
        {back}
        {verify}
      </>
    );
    card = (
      <>
        {verify}
        {back}
      </>
    );
  } else {
    ({ body, foot, card } = pickStep({
      ...props,
      accounts,
      account,
      rows,
      picked,
      pickedRow,
      search,
      setSearch,
      refusal: refusal ?? pressWords,
      onPick: (account, fullName) => {
        pick(account, fullName);
        if (pressWords !== null) actions.dismiss();
      },
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
  const key = target !== null && progress !== null ? "progress" : step;
  if (density === "compact")
    return (
      <div className="grid gap-3" data-github-connect="">
        <div
          className="grid animate-zerops-appear content-start gap-3 motion-reduce:animate-none"
          key={key}
        >
          {body}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-github-connect-foot="">
          {card}
          {props.footerEnd}
        </div>
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

/** Who added an account, beside its name; nothing where HQ does not know who. */
function addedWords(
  account: PickerAccount,
  nameOf: (userId: string) => string | undefined,
): string | null {
  if (account.mine) return "you";
  const by = account.installation.addedBy;
  return by === null ? null : `added by ${nameOf(by) ?? "a teammate"}`;
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
    readonly pickedRow: PickerRepository | null;
    readonly search: string;
    readonly setSearch: (search: string) => void;
    readonly refusal: string | null;
    readonly onPick: (account: PickerAccount, fullName: string) => void;
    readonly onAccount: (account: string) => void;
    readonly onAdd: () => void;
    readonly onToken: () => void;
    readonly onConnect: () => void;
  },
): StepParts {
  const { apps, accounts, account, rows, picked, repo, admin, orgName, nameOf, actions } = input;
  const size = pressSize(input.density);
  const tokenLink = (
    <div className="me-auto self-center text-sm">
      <InlineButton onClick={input.onToken}>
        {accounts.length === 0 ? "GitLab or another host? Connect with a token" : "Use a token"}
      </InlineButton>
    </div>
  );
  // In a card the other way is a press beside the main one, as every ask's second way is.
  const tokenPress = (
    <Button onClick={input.onToken} size={size} variant="secondary">
      Use a token
    </Button>
  );
  if (apps.kind === "unknown")
    return {
      body: (
        <p className="text-sm text-muted-foreground">
          HQ didn't say which GitHub accounts {orgName ?? "the organization"} has added.{" "}
          {input.density === "compact"
            ? "Try again in a moment, or connect with a token."
            : "Close this and open it again in a moment, or connect with a token."}
        </p>
      ),
      foot: tokenLink,
      card: tokenPress,
    };
  const addLabel = admin
    ? "Add a GitHub account"
    : "Add your account (waits for an Owner or Admin's OK)";
  const pickable = accounts.some(
    (each) =>
      each.mine ||
      each.reach.some(
        ({ repository }) =>
          repository.usedBy === null ||
          (repository.usedBy.application === input.project && repository.usedBy.repo === repo),
      ),
  );
  const waiting = waitingAccounts(apps);
  const unanswered = unansweredCount(apps);
  // GitHub's silence is a read to run again; what the person changes on GitHub is checked again.
  const tryAgain = (
    <InlineButton onClick={actions.again} tone="muted">
      Try again
    </InlineButton>
  );
  const checkAgain = (
    <InlineButton onClick={actions.again} tone="muted">
      Check again
    </InlineButton>
  );
  const returnedNote =
    input.returned === null ? null : (
      <p className="rounded-md bg-status-busy-surface px-3 py-2 text-sm text-status-busy-text">
        {input.returned === "requested"
          ? "GitHub asked an owner of the account to approve the app. Its repositories show here once they do."
          : "What you added on GitHub waits for an Owner or Admin's OK in Settings › GitHub."}
      </p>
    );
  const notes = (
    <>
      {unanswered === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          GitHub didn't answer about{" "}
          {unanswered === 1 ? "one account" : `${String(unanswered)} accounts`} the organization's
          apps are installed on, so {unanswered === 1 ? "its" : "their"} repositories aren't listed.{" "}
          {tryAgain}
        </p>
      )}
      {waiting.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {waiting.join(", ")} {waiting.length === 1 ? "waits" : "wait"} for an Owner or Admin's OK
          in Settings › GitHub.
        </p>
      )}
    </>
  );
  if (!pickable) {
    // GitHub not answering about an account is not the account missing: try again first.
    const silent = unanswered > 0;
    const tryNow = silent ? (
      <Button onClick={actions.again} size={size}>
        Try again
      </Button>
    ) : null;
    const add = (
      <Button
        disabled={input.authority !== null}
        onClick={input.onAdd}
        size={size}
        variant={silent ? "secondary" : "primary"}
      >
        {addLabel}
      </Button>
    );
    // Accounts teammates added whose every repository another project uses are not listed: there
    // is nothing here to do with them (the owner, 2026-11-11: "what is this information good for?").
    return {
      body: (
        <>
          {returnedNote}
          <p className="text-sm">
            {silent
              ? `GitHub didn't answer about ${unanswered === 1 ? "one account" : `${String(unanswered)} accounts`} the organization's apps are installed on. Yours may be among them.`
              : `None of your GitHub accounts is added yet. Add the one that owns ${repo}'s repository, or the one where you'll create it.`}
          </p>
          {waiting.length === 0 ? null : (
            <p className="text-xs text-muted-foreground">
              {waiting.join(", ")} {waiting.length === 1 ? "waits" : "wait"} for an Owner or Admin's
              OK in Settings › GitHub.
            </p>
          )}
          <Refusal words={input.authority ?? input.refusal} />
        </>
      ),
      foot: (
        <>
          {tokenLink}
          {tryNow}
          {add}
        </>
      ),
      card: (
        <>
          {tryNow}
          {add}
          {tokenPress}
        </>
      ),
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
  const unsealed = input.pickedRow !== null && input.pickedRow.app.setUpBy === null;
  const connect = (
    <Button
      disabled={
        picked === null ||
        unsealed ||
        input.authority !== null ||
        actions.connectViaApp === undefined
      }
      onClick={input.onConnect}
      size={size}
    >
      {pickedName === undefined ? "Connect" : `Connect ${pickedName}`}
    </Button>
  );
  return {
    body: (
      <>
        {returnedNote}
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
              {addedWords(each, nameOf) === null ? null : (
                <span className="text-xs text-muted-foreground">{addedWords(each, nameOf)}</span>
              )}
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
              </span>{" "}
              · {checkAgain}
            </p>
          </>
        )}
        {notes}
        <Refusal
          words={
            input.authority ??
            (unsealed && input.pickedRow !== null
              ? unsealedWords(input.pickedRow.app)
              : input.refusal)
          }
        />
      </>
    ),
    foot: (
      <>
        {tokenLink}
        {connect}
      </>
    ),
    card: (
      <>
        {connect}
        {tokenPress}
      </>
    ),
  };
}

/**
 * Arrow keys move the choice through a radio list, past the rows that can't be picked; Tab leaves
 * the list from the chosen row.
 */
function radioKeys(event: React.KeyboardEvent<HTMLElement>) {
  const step =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
  if (step === 0) return;
  event.preventDefault();
  const radios = [
    ...(event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])') ?? []),
  ];
  const at = radios.indexOf(event.currentTarget);
  const next = radios[(at + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
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
        const first = rows.find((each) => each.taken === null) === row;
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
            onKeyDown={radioKeys}
            role="radio"
            tabIndex={!disabled && (checked || (picked === null && first)) ? 0 : -1}
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
    /** The trip is asked for: the press waits. */
    readonly pending: boolean;
    /** HQ refused the trip, in its words. */
    readonly installRefusal: string | null;
    readonly onTrip: (app: GitMirrorAppEntry) => void;
    /** GitHub's own install page was opened in another tab. */
    readonly pageOpened: boolean;
    readonly onPage: () => void;
  },
): StepParts {
  const { apps, admin, orgName, nameOf, actions, repo, viewerId, usedApps } = input;
  const size = pressSize(input.density);
  const backPress = (
    <Button onClick={input.onBack} size={size} variant="ghost">
      Back
    </Button>
  );
  const back = <div className="me-auto">{backPress}</div>;
  const list = apps.kind === "ready" ? apps.apps : [];
  const org = orgName ?? "The organization";
  const settings =
    admin && actions.openSettings !== undefined ? (
      <Button onClick={actions.openSettings} size={size}>
        Open Settings › GitHub
      </Button>
    ) : null;
  if (list.length === 0)
    return {
      body: (
        <div className="grid gap-2">
          <p className={stepTitle(input.density)}>Set up a GitHub app first</p>
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
          {settings}
        </>
      ),
      card: (
        <>
          {settings}
          {backPress}
        </>
      ),
    };
  // Every app the organization has is another person's own: nobody is sent to install one
  // unasked. The step says whose they are and leads to making the organization's own; one of
  // them is installed only by choosing it here.
  const theirs = list.filter((app) => app.setUpBy !== null);
  if (input.explainApp === null && ownApps(list, viewerId).length === 0 && theirs.length > 0) {
    const [first] = theirs;
    const anyway =
      first === undefined ? null : (
        <Button
          onClick={() => {
            input.setExplainApp(first.appId);
          }}
          size={size}
          variant="ghost"
        >
          {theirs.length === 1 ? `Install ${first.name} anyway` : "Install one of them anyway"}
        </Button>
      );
    return {
      body: (
        <div className="grid gap-2" data-github-connect-own-app="">
          <p className={stepTitle(input.density)}>{org} has no GitHub app of its own</p>
          <p className="text-sm text-muted-foreground">{noOwnAppWords(theirs, nameOf, org)}</p>
          <p className="text-sm text-muted-foreground">
            {admin
              ? `Make one for ${org} in Settings › GitHub: Add a GitHub app, name it after ${org} and put it on your GitHub organization. GitHub then adds your account, and its repositories are listed here.`
              : `An Owner or Admin of ${org} makes one in Settings › GitHub.`}
          </p>
        </div>
      ),
      foot: (
        <>
          {back}
          {anyway}
          {settings}
        </>
      ),
      card: (
        <>
          {settings}
          {backPress}
          {anyway}
        </>
      ),
    };
  }
  const chosenId = input.explainApp ?? openingApp(list, viewerId, usedApps);
  const chosen = list.find((app) => app.appId === chosenId) ?? null;
  const words = chosen === null ? null : explainerWords(chosen, nameOf, viewerId);
  const way = chosen === null ? null : installWay(chosen);
  const go =
    chosen === null || way === null || chosen.setUpBy === null ? (
      <Button disabled size={size}>
        Continue on GitHub
      </Button>
    ) : way.kind === "page" ? (
      <Button
        onClick={input.onPage}
        render={<a href={way.url} rel="noreferrer" target="_blank" />}
        size={size}
      >
        Continue on GitHub ↗
      </Button>
    ) : (
      <Button disabled={input.pending} onClick={() => input.onTrip(chosen)} size={size}>
        {input.pending ? "Opening GitHub…" : "Continue on GitHub"}
      </Button>
    );
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
                    onKeyDown={radioKeys}
                    role="radio"
                    tabIndex={
                      !disabled &&
                      (checked ||
                        (chosenId === null && list.find((one) => one.setUpBy !== null) === app))
                        ? 0
                        : -1
                    }
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
                          ? "Waits for an Owner or Admin to remake it in Settings › GitHub"
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
            {way?.kind === "page" ? (
              <p className="text-xs text-muted-foreground">
                What you add waits for an Owner or Admin's OK in Settings › GitHub.
                {input.pageOpened ? (
                  <>
                    {" "}
                    Back from GitHub?{" "}
                    <InlineButton onClick={actions.again} tone="muted">
                      Check again
                    </InlineButton>
                  </>
                ) : null}
              </p>
            ) : null}
            <Refusal
              words={chosen.setUpBy === null ? unsealedWords(chosen) : input.installRefusal}
            />
          </>
        )}
      </>
    ),
    foot: (
      <>
        {back}
        {go}
      </>
    ),
    card: (
      <>
        {go}
        {backPress}
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
): StepParts {
  const { sent, progress, repo, entry, actions } = input;
  const size = pressSize(input.density);
  const href = sent.app === null ? sent.target : `https://github.com/${sent.target}`;
  const shownAs = sent.app === null ? sent.target.replace(/^https:\/\//u, "") : sent.target;
  if (progress === "done") {
    const gate = mirrorGateLine(
      entry?.remote,
      sent.app === null ? null : { name: sent.app.name, appId: sent.app.appId },
    );
    const open = (
      <Button
        render={<a href={href} rel="noreferrer" target="_blank" />}
        size={size}
        variant="secondary"
      >
        {sent.app === null ? `Open on ${hostWords(sent.target)}` : "Open on GitHub"}
      </Button>
    );
    const done =
      actions.onConnected === undefined ? null : (
        <Button onClick={actions.onConnected} size={size}>
          Done
        </Button>
      );
    return {
      body: (
        <div className="grid justify-items-start gap-2.5 pt-3">
          <p className="text-sm">
            <Badge dot tone="success">
              In sync
            </Badge>
          </p>
          <p className="text-lg font-medium">{repo} is on GitHub</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{shownAs}</span> has {repo}'s main. Mate's
            next change opens there for review.
          </p>
          {gate === undefined || entry?.remote?.governance === "governed" ? null : (
            <p className="text-xs text-muted-foreground">{gate}</p>
          )}
        </div>
      ),
      foot: (
        <>
          {open}
          {done}
        </>
      ),
      card: (
        <>
          {done}
          {open}
        </>
      ),
    };
  }
  const steps: ReadonlyArray<readonly [ConnectStepName, string]> = [
    [
      "connect",
      sent.app === null ? "Connecting with the token" : `Connecting through ${sent.app.name}`,
    ],
    ["push", "Pushing main"],
    ...(sent.app === null ? [] : ([["rules", "Checking GitHub's rules on main"]] as const)),
  ];
  const at = steps.findIndex(([name]) => name === progress);
  return {
    body: (
      <>
        <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm">
          {repo} → <span className="font-mono">{shownAs}</span>
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
    // A card stays where it is: nothing to close, nothing to say under its steps.
    card: null,
  };
}

type ConnectStepName = "connect" | "push" | "rules";
