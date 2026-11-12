/**
 * Connects one code repository to GitHub: the GitHub accounts the organization's apps are
 * installed on (yours first, a teammate's labelled with who added it), an account's repositories
 * with the one named like the code suggested and the ones another code repository uses visible but
 * not pickable, the steps before leaving for GitHub to add an account, a token tab for GitLab or
 * another host, and the connect's own steps as HQ's record tells them.
 *
 * Adding an account is one press, *Continue on GitHub*, and the picker decides what the trip does
 * (`githubTrip`): it installs the organization's app, or — where the organization has none this
 * person may be sent to, and they are an Owner or Admin — makes it first, in the same trip. No
 * step asks which app, says whose one is, or sends anyone to Settings; another person's own app is
 * never named. With no account to pick from, those steps are where the picker opens.
 *
 * The connect dialog and the Mate's ask card both hold it: a dialog's footer ends in its main
 * press, a card's starts with it, as every ask's does, and ends in what the card adds
 * (`footerEnd`: its *Not now*).
 */
import { useAtomValue } from "@effect/atom-react";
import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
import { OperationStopped } from "@t3tools/client-runtime/data";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useRouter } from "@tanstack/react-router";
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
import { appOwner } from "../../settings/automationSettings.logic";
import { KeyField } from "../../settings/ConnectFlow";
import { hostWords, mirrorAuthorityLine, mirrorGateLine, remoteSyncedAt } from "../gitMirror.logic";
import {
  connectProgress,
  freshNames,
  type GithubTrip,
  githubTrip,
  heldRepository,
  installWay,
  newRepositoryUrl,
  openingAccount,
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
  // Back from GitHub, the project's page opens this dialog again.
  const back = () =>
    returnWithSeen(
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
          return mirror.install(appId, back());
        },
        make: async (owner, name) => {
          leave();
          return mirror.make(owner, name, back());
        },
        again,
        leaving: leave,
        dismiss: () => {
          if (press.kind !== "none") dropPress(orgId, project, repo, press.press);
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

/**
 * The picker while the organization's GitHub is still read, in an ask card: the card's one footer
 * row as it will stand — the main press's place held by what is going on, then what the card adds
 * (`footerEnd`: its *Not now*, pressable all along).
 */
export function GithubConnectReading({ footerEnd }: { readonly footerEnd?: React.ReactNode }) {
  return (
    <div
      aria-busy="true"
      className="flex flex-wrap items-center gap-2"
      data-github-connect=""
      data-github-connect-foot=""
    >
      <Button disabled size="md">
        <Spinner size="xs" />
        Reading GitHub…
      </Button>
      {footerEnd}
    </div>
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
  /**
   * Leaves for GitHub to make the organization's app, named `name`, on the person's own account
   * (`owner` `null`) or a GitHub organization, and to install it; resolves `false` where HQ
   * refused. Absent: this picker makes none.
   */
  readonly make?: (owner: string | null, name: string) => Promise<boolean>;
  /** Asks HQ again what the organization's apps reach. */
  readonly again: () => void;
  /** The person opens GitHub in another tab: what is there now is remembered. */
  readonly leaving: () => void;
  /** Lets a refused or unconfirmed press go. */
  readonly dismiss: () => void;
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

/** A step's running words: a dialog's are its own size; in an ask card they are the card's body. */
const stepWords = (density: "full" | "compact") =>
  density === "compact" ? "text-body" : "text-sm";

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
  // The GitHub organization typed to own the app the trip makes; `null`: not asked, its own account.
  const [makeOwner, setMakeOwner] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sent, setSent] = useState<Sent | null>(initial?.sent ?? null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  // The trip pressed and not refused: one press leaves once.
  const [leaving, setLeaving] = useState(false);
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

  const trip = githubTrip({
    apps: ready?.apps ?? [],
    viewerId,
    used: usedApps,
    makes: props.admin && actions.make !== undefined,
    organization: props.orgName,
  });
  // No account with a repository this code could go to, and GitHub answered about every one: the
  // steps to add an account are where the picker opens.
  const opens =
    ready !== null && unansweredCount(ready) === 0 && !accounts.some(pickable(props.project, repo));
  const leave = (trip: Promise<boolean>) => {
    if (leaving) return;
    setLeaving(true);
    setTried(true);
    void trip.then((left) => {
      if (!left) setLeaving(false);
    });
  };

  let body: React.ReactNode;
  let foot: React.ReactNode;
  let card: React.ReactNode;
  const size = pressSize(density);
  if (target !== null && progress !== null) {
    ({ body, foot, card } = progressStep({ ...props, sent: target, progress }));
  } else if (step === "explain" || (step === "pick" && opens)) {
    ({ body, foot, card } = explainStep({
      ...props,
      trip,
      onBack: step === "explain" && !opens ? () => setStep("pick") : null,
      onToken: () => setStep("token"),
      pending: leaving || props.installing.kind === "working",
      refusal:
        tried && !leaving && props.installing.kind === "refused" ? props.installing.words : null,
      onTrip: (app) => {
        if (!leaving) leave(actions.install(app.appId));
      },
      makeOwner,
      setMakeOwner,
      onMake: (name) => {
        if (!leaving && actions.make !== undefined)
          leave(actions.make(makeOwner === null ? null : appOwner(makeOwner), name));
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
        {density === "compact" ? null : (
          <ConnectWay onChange={(next) => setStep(next)} value="token" />
        )}
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

/**
 * Whether an account has something for this code repository: the person's own account, or one
 * with a repository no other code repository uses.
 */
const pickable = (project: string, repo: string) => (account: PickerAccount) =>
  account.mine ||
  account.reach.some(
    ({ repository }) =>
      repository.usedBy === null ||
      (repository.usedBy.application === project && repository.usedBy.repo === repo),
  );

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
        <ToggleGroupItem value="pick">GitHub account</ToggleGroupItem>
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
  const { apps, accounts, account, rows, picked, repo, orgName, nameOf, actions } = input;
  const size = pressSize(input.density);
  const words = stepWords(input.density);
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
  const tryNow = (
    <Button onClick={actions.again} size={size}>
      Try again
    </Button>
  );
  if (apps.kind === "unknown")
    return {
      body: (
        <p className={cn(words, "text-muted-foreground")}>
          HQ didn't say which GitHub accounts Mate works in for {orgName ?? "your organization"}.
          Try again, or connect with a token.
        </p>
      ),
      foot: (
        <>
          {tokenLink}
          {tryNow}
        </>
      ),
      card: (
        <>
          {tryNow}
          {tokenPress}
        </>
      ),
    };
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
  const returnedNote = <ReturnedNote returned={input.returned} />;
  const several = unanswered === 1 ? "one account" : `${String(unanswered)} accounts`;
  const notes = (
    <>
      {unanswered === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          GitHub didn't answer about {several}, so {unanswered === 1 ? "its" : "their"} repositories
          aren't listed. {tryAgain}
        </p>
      )}
      <WaitingAccounts accounts={waiting} />
    </>
  );
  if (!accounts.some(pickable(input.project, repo))) {
    // GitHub not answering about an account is not the account missing: try again first. (With
    // every account answered, the picker opens on the steps that add one instead.)
    const add = (
      <Button
        disabled={input.authority !== null}
        onClick={input.onAdd}
        size={size}
        variant="secondary"
      >
        Add a GitHub account
      </Button>
    );
    // Accounts teammates added whose every repository another project uses are not listed: there
    // is nothing here to do with them (the owner, 2026-11-11: "what is this information good for?").
    return {
      body: (
        <>
          {returnedNote}
          <p className={words}>
            GitHub didn't answer about {several} Mate works in. Yours may be among them.
          </p>
          <WaitingAccounts accounts={waiting} />
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
                Mate may not use any repository on {account.account} yet.
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
                  Choose more of {account.account}'s repositories
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

/** What GitHub said on the way back from its page, where the account is not usable yet. */
function ReturnedNote({ returned }: { readonly returned: "requested" | "waiting" | null }) {
  return returned === null ? null : (
    <p className="rounded-md bg-status-busy-surface px-3 py-2 text-sm text-status-busy-text">
      {returned === "requested"
        ? "GitHub asked an owner of the account to approve Mate. Its repositories show here once they do."
        : "What you added on GitHub waits for an Owner or Admin's OK in Settings › GitHub."}
    </p>
  );
}

function WaitingAccounts({ accounts }: { readonly accounts: ReadonlyArray<string> }) {
  return accounts.length === 0 ? null : (
    <p className="text-xs text-muted-foreground">
      {accounts.join(", ")} {accounts.length === 1 ? "waits" : "wait"} for an Owner or Admin's OK in
      Settings › GitHub.
    </p>
  );
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

/**
 * Before leaving for GitHub: what its pages will ask, as numbered steps, and the one press that
 * goes there. What the trip does is decided (`GithubTrip`), never asked.
 */
function explainStep(
  input: GithubConnectPickerViewProps & {
    readonly trip: GithubTrip;
    /** Back to the accounts; `null` where the picker opens here, with none to go back to. */
    readonly onBack: (() => void) | null;
    readonly onToken: () => void;
    /** The trip is asked for: the press waits. */
    readonly pending: boolean;
    /** HQ refused the trip, in its words. */
    readonly refusal: string | null;
    readonly onTrip: (app: GitMirrorAppEntry) => void;
    /** The GitHub organization typed to own the app; `null`: not asked for. */
    readonly makeOwner: string | null;
    readonly setMakeOwner: (owner: string | null) => void;
    readonly onMake: (name: string) => void;
    /** GitHub's own install page was opened in another tab. */
    readonly pageOpened: boolean;
    readonly onPage: () => void;
  },
): StepParts {
  const { apps, orgName, actions, repo, viewerId, trip } = input;
  const size = pressSize(input.density);
  const words = stepWords(input.density);
  const org = orgName ?? "your organization";
  const opens = input.onBack === null;
  const held = input.authority !== null;
  const backPress =
    input.onBack === null ? null : (
      <Button onClick={input.onBack} size={size} variant="ghost">
        Back
      </Button>
    );
  // Where the picker opens here, the other way in stands where Back would.
  const tokenPress = (
    <Button onClick={input.onToken} size={size} variant="secondary">
      Use a token
    </Button>
  );
  const start = opens ? (
    <div className="me-auto self-center text-sm">
      <InlineButton onClick={input.onToken}>
        GitLab or another host? Connect with a token
      </InlineButton>
    </div>
  ) : (
    <div className="me-auto">{backPress}</div>
  );
  const newRepository = (
    <span onClickCapture={actions.leaving}>
      <OutLink href={newRepositoryUrl(viewerAccount(apps, viewerId) ?? "", repo)}>
        New repository on GitHub
      </OutLink>
    </span>
  );
  const notes = (
    <>
      <ReturnedNote returned={input.returned} />
      {apps.kind === "ready" ? <WaitingAccounts accounts={waitingAccounts(apps)} /> : null}
    </>
  );
  if (trip.kind === "ask")
    return {
      body: (
        <>
          {notes}
          <p className={words} data-github-connect-trip="ask">
            Mate isn't set up on GitHub for {org} yet. An Owner or Admin does that once. Until then
            you can connect {repo} with a token.
          </p>
        </>
      ),
      foot: start,
      card: opens ? tokenPress : backPress,
    };
  const way = trip.kind === "install" ? installWay(trip.app) : null;
  const go =
    held || way === null || way.kind === "trip" ? (
      <Button
        disabled={held || input.pending}
        onClick={() => {
          if (trip.kind === "install") input.onTrip(trip.app);
          else input.onMake(trip.name);
        }}
        size={size}
      >
        {input.pending ? "Opening GitHub…" : "Continue on GitHub"}
      </Button>
    ) : (
      <Button
        onClick={input.onPage}
        render={<a href={way.url} rel="noreferrer" target="_blank" />}
        size={size}
      >
        Continue on GitHub ↗
      </Button>
    );
  const bold = "font-medium text-foreground";
  return {
    body: (
      <>
        {notes}
        <div className="grid gap-2.5" data-github-connect-trip={trip.kind}>
          <p className={words}>
            {trip.kind === "make"
              ? `Mate isn't set up on GitHub for ${org} yet. GitHub walks you through it:`
              : opens
                ? "Mate isn't on a GitHub account of yours yet. GitHub asks where it may work:"
                : "GitHub asks where Mate may work:"}
          </p>
          <ol className={cn("grid gap-2 text-muted-foreground", words)}>
            {trip.kind === "make" ? (
              <ExplainStep n={1}>
                Press <span className={bold}>Create GitHub App</span>. That makes Mate's bot there,
                named {trip.name}.
              </ExplainStep>
            ) : null}
            <ExplainStep n={trip.kind === "make" ? 2 : 1}>
              Pick the account that has {repo}'s code.
            </ExplainStep>
            <ExplainStep n={trip.kind === "make" ? 3 : 2}>
              Choose <span className={bold}>Only select repositories</span> and pick it.
            </ExplainStep>
            <ExplainStep n={trip.kind === "make" ? 4 : 3}>GitHub brings you back here.</ExplainStep>
          </ol>
          {trip.kind === "make" && input.makeOwner !== null ? (
            <KeyField
              autoFocus
              hint="Its name on GitHub (github.com/name), where you are an owner. Empty: the bot is made on your own account."
              label="GitHub organization the bot belongs to"
              onChange={input.setMakeOwner}
              placeholder="Your own account"
              value={input.makeOwner}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {trip.kind === "install" ? `GitHub's page calls Mate “${trip.app.name}”. ` : null}
            No repository yet? {newRepository} first.
            {trip.kind === "make" && input.makeOwner === null ? (
              <>
                {" "}
                The bot is made on your own GitHub account;{" "}
                <InlineButton onClick={() => input.setMakeOwner("")} tone="muted">
                  use a GitHub organization instead
                </InlineButton>
                .
              </>
            ) : null}
            {way?.kind === "page" ? " What you add waits for an Owner or Admin's OK." : null}
            {way?.kind === "page" && input.pageOpened ? (
              <>
                {" "}
                Back from GitHub?{" "}
                <InlineButton onClick={actions.again} tone="muted">
                  Check again
                </InlineButton>
              </>
            ) : null}
          </p>
        </div>
        <Refusal words={input.authority ?? input.refusal} />
      </>
    ),
    foot: (
      <>
        {start}
        {go}
      </>
    ),
    card: (
      <>
        {go}
        {opens ? tokenPress : backPress}
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
  if (progress === "paused") {
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
        <div className="grid justify-items-start gap-2.5 pt-3" data-github-connect-paused="">
          <p className="text-sm">
            <Badge dot tone="warning">
              Paused
            </Badge>
          </p>
          <p className="text-lg font-medium">{repo} is connected, and the two mains differ</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{shownAs}</span> and {repo} each have
            commits the other doesn't, so Mate moves neither and overwrites nothing. Ask this
            project's Mate to bring them back in step: it opens one change that holds both. Merge it
            in Mate and pushing starts.
          </p>
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
    ["connect", sent.app === null ? "Connecting with the token" : "Connecting to GitHub"],
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
