/** A repository's upkeep, using the same held press and operations as the project row. */
import { OperationStopped } from "@t3tools/client-runtime/data";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  HardDriveIcon,
  KeyRoundIcon,
  Link2Icon,
  MoreHorizontalIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { Fragment, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { Dialog, DialogPopup as StoragePopup } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import { Text } from "~/components/ui/text";
import { randomUUID } from "~/lib/utils";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useNowMs } from "~/zerops/useNowMs";
import { useRepoStorage } from "~/zerops/useRepoStorage";
import { useCompactProjectFlows } from "~/zerops/projectFlows";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { stoppedWords } from "~/zerops/stoppedWords";
import { GitMirrorDialog } from "../GitMirrorDialog";
import { StorageLimit } from "../gitBrowser/GitStorageFigure";
import { CutText } from "../system";
import {
  hostWords,
  repoState,
  type RepoPress,
  type RepoState,
  type RepoStateApps,
} from "../gitMirror.logic";
import { GithubTokenFields } from "./GithubTokenFields";
import { dropPress, holdPress, type HeldPress, type PressState, useRepoPress } from "./repoPress";
import * as upkeep from "./repoUpkeep.logic";
import {
  repositoryUpkeep,
  type RepoRowActions,
  type RepositoryUpkeepEntry,
} from "./repoUpkeep.logic";

/** The same connect dialog serves the first connect on the project and upkeep on the repository. */
export function RepositoryConnectDialog({
  appId,
  project,
  repo,
  onClose,
}: {
  readonly appId: string;
  readonly project: string;
  readonly repo: string | null;
  readonly onClose: () => void;
}) {
  return repo === null ? null : (
    <GitMirrorDialog appId={appId} appName={project} key={repo} onClose={onClose} repo={repo} />
  );
}

type Slots = {
  readonly menu: ReactNode;
  readonly status: ReactNode;
  readonly storage: ReturnType<typeof useRepoStorage>["view"];
};

/** The page reads its existing application and navigation projections, never a second remote read. */
export function RepositoryUpkeep({
  appId,
  project,
  repo,
  homeStorage,
  children,
}: {
  readonly appId: string;
  readonly project: string;
  readonly repo: string;
  readonly homeStorage?: GitHomeAbout["storage"];
  readonly children: (slots: Slots) => ReactNode;
}) {
  const entry = useHqAppDetail(appId).repos?.find((each) => each.name === repo);
  const git = useGitTargetOperations(appId);
  const session = useZeropsSessionOptional();
  const { flows } = useCompactProjectFlows(useMemo(() => [appId], [appId]));
  const flow = flows.get(appId);
  const storage = useRepoStorage(appId, repo);
  const now = useNowMs();
  const navigate = useNavigate();
  const needsApps = entry?.remote?.via === "app" && entry.remote.invalidSince !== null;
  const mirror = useGitMirrorApps(needsApps);
  const pressState = useRepoPress(git.orgId, appId, repo, entry);
  if (entry === undefined || flow === undefined)
    return children({ menu: null, status: null, storage: storage.view });
  return (
    <RepositoryUpkeepView
      entry={entry}
      project={appId}
      projectName={project}
      orgId={git.orgId}
      orgName={session?.activeOrganization?.name}
      now={now}
      apps={mirror.apps?.kind === "ready" ? mirror.apps : null}
      writes={hqOffer(git.can, HQ_REMOTE_WRITE_VERB).kind === "allowed"}
      admin={roleAtLeast(session?.activeOrganization?.roleCode, "ADMIN")}
      dependencies={flow.environments
        .filter((each) => each.target.kind === "git")
        .map((each) => each.name)}
      actions={{
        ...git.actions,
        ...(git.send === undefined ? {} : { sendDisconnect: git.send.disconnect }),
      }}
      storage={storage}
      homeStorage={homeStorage}
      pressState={pressState}
      onSetUpGithub={() => {
        void navigate({ to: "/settings/automation" });
      }}
    >
      {children}
    </RepositoryUpkeepView>
  );
}

type Panel = "fix" | "disconnect" | "token" | "unfollow" | "limit" | "delete" | null;
const PANEL_LABELS: Record<Exclude<Panel, null | "limit">, (repo: string) => string> = {
  fix: () => "How to fix diverged mains",
  disconnect: (repo) => `Disconnect ${repo}`,
  token: (repo) => `Replace the token for ${repo}`,
  unfollow: (repo) => `Stop following for ${repo}`,
  delete: (repo) => `Delete ${repo} from Mate`,
};

/** The repository's heading menu and its state line, drawn where the frame places them. */
export function RepositoryUpkeepView({
  entry,
  project,
  projectName,
  apps,
  orgId,
  orgName,
  now,
  writes,
  admin,
  dependencies,
  actions,
  storage,
  homeStorage,
  pressState,
  onSetUpGithub,
  children,
}: {
  readonly entry: RepoListEntry;
  readonly project: string;
  readonly projectName: string;
  readonly apps: RepoStateApps | null;
  readonly orgId: string | null;
  readonly orgName: string | undefined;
  readonly now: number;
  readonly writes: boolean;
  readonly admin: boolean;
  readonly dependencies: ReadonlyArray<string>;
  readonly actions: RepoRowActions;
  readonly storage: ReturnType<typeof useRepoStorage>;
  readonly homeStorage?: GitHomeAbout["storage"];
  readonly pressState: PressState;
  readonly onSetUpGithub: () => void;
  readonly children: (slots: Slots) => ReactNode;
}) {
  const press: RepoPress =
    pressState.kind === "working"
      ? pressState.press.kind === "connect"
        ? "connecting"
        : "disconnecting"
      : null;
  const state = repoState(entry, { apps, orgName, now, press });
  const [panel, setPanel] = useState<Panel>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitPending, setLimitPending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const limitFocus = useRef<HTMLElement>(null);
  const open = (next: Exclude<Panel, null | "limit">, from: HTMLElement | null) => {
    opener.current = from ?? more.current;
    setAnchor(more.current ?? from);
    setPanel(next);
  };
  const remote = entry.remote;
  const disconnect = () => {
    if (actions.sendDisconnect === undefined) return;
    setPanel(null);
    setAnswer(null);
    const held: HeldPress = {
      kind: "disconnect",
      requestId: randomUUID(),
      target: null,
      via: null,
      appName: null,
    };
    holdPress(orgId, project, entry.name, held);
    actions.sendDisconnect(entry.name, held.requestId!).catch((cause: unknown) => {
      dropPress(orgId, project, entry.name, held);
      setAnswer(
        stoppedWords(
          cause,
          "HQ couldn't confirm the disconnect. Check the row before trying again.",
        ),
      );
    });
  };
  const said =
    pressState.kind === "refused" || pressState.kind === "unconfirmed"
      ? {
          words: pressState.words,
          dismiss: () => dropPress(orgId, project, entry.name, pressState.press),
        }
      : answer === null
        ? null
        : { words: answer, dismiss: () => setAnswer(null) };
  const offered = repositoryUpkeep({
    remote,
    follows: entry.follows,
    canDelete: entry.canDelete,
    destination: state.destination,
    writes,
    press,
    actions,
    limit: storage.offer.kind === "allowed" && storage.set !== undefined,
  });
  const groups = upkeep.repositoryUpkeepGroups(offered);
  const menuItem = (item: RepositoryUpkeepEntry) => {
    switch (item) {
      case "open":
        return (
          <MenuItem
            render={<a href={state.destination!.href} target="_blank" rel="noopener noreferrer" />}
          >
            <ArrowUpRightIcon aria-hidden="true" />
            Open on {hostWords(remote!.url)}
          </MenuItem>
        );
      case "connect":
        return (
          <MenuItem onClick={() => setConnecting(true)}>
            <Link2Icon aria-hidden="true" />
            Connect to GitHub…
          </MenuItem>
        );
      case "change":
        return (
          <MenuItem onClick={() => setConnecting(true)}>
            <Link2Icon aria-hidden="true" />
            Change repository…
          </MenuItem>
        );
      case "token":
        return (
          <MenuItem onClick={() => open("token", null)}>
            <KeyRoundIcon aria-hidden="true" />
            Replace token…
          </MenuItem>
        );
      case "disconnect":
        return (
          <MenuItem onClick={() => open("disconnect", null)}>
            <UnlinkIcon aria-hidden="true" />
            Disconnect…
          </MenuItem>
        );
      case "unfollow":
        return (
          <MenuItem onClick={() => open("unfollow", null)}>
            <UnlinkIcon aria-hidden="true" />
            Stop following…
          </MenuItem>
        );
      case "limit":
        return (
          <MenuItem onClick={() => setPanel("limit")}>
            <HardDriveIcon aria-hidden="true" />
            Storage limit…
          </MenuItem>
        );
      case "delete":
        return (
          <MenuItem onClick={() => open("delete", null)} variant="destructive">
            <Trash2Icon aria-hidden="true" />
            Delete repository…
          </MenuItem>
        );
    }
  };
  const menu = (
    <>
      {groups.length === 0 ? null : (
        <Menu>
          <MenuTrigger
            aria-label={`More for ${entry.name}`}
            ref={more}
            render={<Button size="icon-sm" variant="ghost" />}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end" width="fit">
            {groups.map((group, index) => (
              <Fragment key={group[0]}>
                {index === 0 ? null : <MenuSeparator />}
                {group.map((item) => (
                  <Fragment key={item}>{menuItem(item)}</Fragment>
                ))}
              </Fragment>
            ))}
          </MenuPopup>
        </Menu>
      )}
      <Popover
        onOpenChange={(open) => {
          if (!open && !busy) setPanel(null);
        }}
        open={panel !== null && panel !== "limit"}
      >
        <PopoverPopup
          align="end"
          anchor={anchor}
          aria-label={
            panel === null || panel === "limit" ? undefined : PANEL_LABELS[panel](entry.name)
          }
          finalFocus={opener}
          width="md"
        >
          {panel === "fix" ? (
            <HowToFix />
          ) : panel === "disconnect" && remote != null ? (
            <Confirm
              action="Disconnect"
              onCancel={() => setPanel(null)}
              onConfirm={dependencies.length > 0 ? undefined : disconnect}
              title={`Disconnect ${entry.name} from ${state.destination?.label ?? "its remote"}?`}
            >
              {dependencies.length > 0
                ? `${dependencies.join(", ")} ${dependencies.length === 1 ? "delivers" : "deliver"} through it. Remove ${dependencies.length === 1 ? "that Git environment" : "those Git environments"} first.`
                : remote.via === "app"
                  ? "Mate stops pushing; nothing on GitHub changes."
                  : `Mate stops pushing and forgets the token; nothing on ${new URL(remote.url).host} changes. Revoke the token there if nothing else uses it.`}
            </Confirm>
          ) : panel === "token" && remote != null ? (
            <ReplaceToken
              actions={actions}
              busy={busy}
              onDone={() => setPanel(null)}
              projectName={projectName}
              repo={entry.name}
              setBusy={setBusy}
              url={remote.url}
            />
          ) : panel === "unfollow" ? (
            <Confirm
              action="Stop following"
              busy={busy}
              onCancel={() => setPanel(null)}
              onConfirm={async () => {
                if (actions.unfollow === undefined) return;
                setBusy(true);
                try {
                  await actions.unfollow(entry.name);
                  setPanel(null);
                } catch (cause) {
                  setAnswer(
                    stoppedWords(
                      cause,
                      "HQ couldn't confirm it stopped following. Check it before trying again.",
                    ),
                  );
                  setPanel(null);
                } finally {
                  setBusy(false);
                }
              }}
              title={`Stop following ${state.destination?.label ?? "it"}?`}
            >
              Its Mates no longer fetch it and HQ alone keeps the code. The repository stays on
              GitHub.
            </Confirm>
          ) : panel === "delete" ? (
            <DeleteFromMate
              busy={busy}
              destination={state.destination?.label ?? null}
              onCancel={() => setPanel(null)}
              onDelete={async () => {
                if (actions.deleteRepository === undefined) return;
                setBusy(true);
                try {
                  await actions.deleteRepository(entry.name);
                  setPanel(null);
                } catch (cause) {
                  setAnswer(
                    cause instanceof OperationStopped
                      ? cause.message
                      : "HQ couldn't confirm the deletion. Check the repository list before trying again.",
                  );
                  setPanel(null);
                } finally {
                  setBusy(false);
                }
              }}
              repo={entry.name}
            />
          ) : null}
        </PopoverPopup>
      </Popover>
      <Dialog
        open={panel === "limit"}
        onOpenChange={(isOpen) => {
          if (!isOpen && !limitPending) setPanel(null);
        }}
      >
        <StoragePopup initialFocus={limitFocus}>
          {panel === "limit" && storage.set !== undefined ? (
            <StorageLimit
              repo={entry.name}
              storage={homeStorage}
              view={storage.view}
              set={storage.set}
              pending={limitPending}
              setPending={setLimitPending}
              focusRef={limitFocus}
              onDone={() => setPanel(null)}
            />
          ) : null}
        </StoragePopup>
      </Dialog>
      <RepositoryConnectDialog
        appId={project}
        project={projectName}
        repo={connecting ? entry.name : null}
        onClose={() => setConnecting(false)}
      />
    </>
  );
  const status = (
    <div className="flex flex-wrap items-center gap-2">
      <StateLine state={state} />
      <FixButton
        state={state}
        writes={writes}
        admin={admin}
        onConnect={() => setConnecting(true)}
        onFix={(from) => open("fix", from)}
        onToken={(from) => open("token", from)}
        onSetUpGithub={onSetUpGithub}
      />
      {said === null ? null : (
        <Text render={<p />} variant="error" role="status">
          {said.words}{" "}
          <InlineButton onClick={said.dismiss} tone="muted">
            Dismiss
          </InlineButton>
        </Text>
      )}
    </div>
  );
  return children({ menu, status, storage: storage.view });
}

/** What a state's dot says where its colour is not seen. */
const DOT_WORDS = { ok: "Working", warn: "Needs attention", bad: "Stopped" } as const;

/**
 * Line two: the state's one line. Calm, it is one line, cut at the row's end. Where something
 * stopped or needs the person, why is the row's content and is said whole, on as many lines as
 * it takes: a reason cut after four words with the rest behind a hover is a reason not given
 * (nothing needs a hover to be read). Its mark (a dot, or a spinner while a press is on its way)
 * stands on the words' x-height.
 */
export function StateLine({ state }: { readonly state: RepoState }) {
  return (
    <Text className="min-w-0" render={<p />} variant="note">
      {stateSays(state) ? (
        <span className="block text-pretty">
          <StateWords state={state} />
        </span>
      ) : (
        <CutText className="block truncate" text={state.line}>
          <StateWords state={state} />
        </CutText>
      )}
    </Text>
  );
}

/** Where something stopped or needs the person: its line is said whole, never cut. */
export const stateSays = (state: RepoState) => state.tone === "warn" || state.tone === "bad";

/** The state's mark and words, in the ink its tone takes; the line around them is the caller's. */
export function StateWords({ state }: { readonly state: RepoState }) {
  return (
    <span
      className={
        state.tone === "warn"
          ? "text-status-attention-text"
          : state.tone === "bad"
            ? "text-status-failed-text"
            : undefined
      }
      role={state.tone === "busy" ? "status" : undefined}
    >
      {state.tone === "quiet" ? null : (
        <span className="me-1.5 inline-flex align-middle">
          {state.tone === "busy" ? (
            <Spinner aria-hidden="true" size="xs" />
          ) : (
            <Badge
              aria-label={DOT_WORDS[state.tone]}
              dot
              tone={state.tone === "ok" ? "success" : state.tone === "warn" ? "warning" : "danger"}
            />
          )}
        </span>
      )}
      {state.line}
    </span>
  );
}

/** The row's one button: the fix its state offers this person, or nothing. */
export function FixButton({
  state,
  ...input
}: {
  readonly state: RepoState;
} & {
  readonly writes: boolean;
  readonly admin: boolean;
  readonly onConnect: () => void;
  readonly onFix: (from: HTMLElement) => void;
  readonly onToken: (from: HTMLElement) => void;
  readonly onSetUpGithub: () => void;
  readonly otherFix?: React.ReactNode;
  readonly firstConnect?: boolean;
}) {
  const press = (label: string, onClick: (from: HTMLElement) => void) =>
    input.otherFix !== undefined && (state.fix !== "connect" || !input.firstConnect) ? (
      input.otherFix
    ) : (
      <Button onClick={(event) => onClick(event.currentTarget)} size="sm" variant="secondary">
        {label}
      </Button>
    );
  switch (state.fix) {
    case null:
      return null;
    case "how-to-fix":
      return press("How to fix", input.onFix);
    case "set-up-github":
      return input.admin ? press("Set up GitHub", input.onSetUpGithub) : null;
    case "connect":
      return input.writes ? press("Connect to GitHub", input.onConnect) : null;
    case "reconnect":
      return input.writes ? press("Reconnect", input.onConnect) : null;
    case "replace-token":
      return input.writes ? press("Replace token", input.onToken) : null;
  }
}

function HowToFix() {
  return (
    <div className="grid gap-2 text-body">
      <p className="font-medium">GitHub's main has commits Mate's main doesn't</p>
      <p className="text-muted-foreground">
        Mate stopped pushing so it overwrites nothing. Ask this project's Mate to bring the two back
        in step: it opens one change that holds both. Merge it in Mate, and Mate pushes again.
      </p>
    </div>
  );
}

function Confirm({
  title,
  children,
  action,
  busy = false,
  onConfirm,
  onCancel,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly action: string;
  readonly busy?: boolean;
  /** Absent: the press is kept away, and the words say why. */
  readonly onConfirm: (() => void) | undefined;
  readonly onCancel: () => void;
}) {
  return (
    <div className="grid gap-2.5">
      <p className="text-body font-medium">{title}</p>
      <Text render={<p />} variant="description">
        {children}
      </Text>
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        {onConfirm === undefined ? null : (
          <Button disabled={busy} onClick={onConfirm} size="sm" variant="destructive">
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReplaceToken({
  repo,
  url,
  projectName,
  actions,
  busy,
  setBusy,
  onDone,
}: {
  readonly repo: string;
  readonly url: string;
  readonly projectName: string;
  readonly actions: RepoRowActions;
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly onDone: () => void;
}) {
  const [token, setToken] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const submit = async () => {
    if (actions.replaceToken === undefined || token === "") return;
    const candidate = token;
    setToken("");
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await actions.replaceToken(repo, candidate);
      if (answer.ok) onDone();
      else setRefusal(answer.reason);
    } catch (cause) {
      setRefusal(
        cause instanceof OperationStopped ||
          (cause instanceof HqError && cause.code === "git_probe_refused")
          ? cause.message
          : "HQ couldn't confirm the token change. Check the row before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-body font-medium">Replace the token for {repo}</p>
      <GithubTokenFields onToken={setToken} projectName={projectName} token={token} url={url} />
      {refusal === null ? null : (
        <Text render={<p />} variant="error" role="alert">
          {refusal}
        </Text>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onDone} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={busy || token === ""} onClick={() => void submit()} size="sm">
          {busy ? "Verifying…" : "Verify and keep token"}
        </Button>
      </div>
    </div>
  );
}

function DeleteFromMate({
  repo,
  destination,
  busy,
  onDelete,
  onCancel,
}: {
  readonly repo: string;
  readonly destination: string | null;
  readonly busy: boolean;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const id = useId();
  return (
    <div className="grid gap-2.5">
      <p className="text-body font-medium">Delete {repo}?</p>
      <Text render={<p />} variant="description">
        Its code and history kept by Mate are deleted: main, its changes, and what releases build
        from. The files in its Mate's workspace stay.
        {destination === null ? "" : ` ${destination} on GitHub stays as it is.`}
      </Text>
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Type {repo} to confirm</Label>
        <Input
          autoComplete="off"
          id={id}
          nativeInput
          onChange={(event) => setTyped(event.target.value)}
          size="sm"
          spellCheck={false}
          value={typed}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={busy || typed !== repo}
          onClick={onDelete}
          size="sm"
          variant="destructive"
        >
          {busy ? "Deleting…" : "Delete repository"}
        </Button>
      </div>
    </div>
  );
}
