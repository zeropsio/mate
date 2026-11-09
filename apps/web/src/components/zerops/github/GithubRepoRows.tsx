/**
 * A project's Repositories: one row per code repository — its name, where its code goes, the one
 * line that says whether it moves, at most one button (the fix for that state) and a ⋯ for the
 * rest: Open on GitHub, Change repository…, Replace token, Disconnect…, Delete from Mate…. Every
 * press shows its progress on the row until HQ's record shows the outcome.
 */
import { OperationStopped } from "@t3tools/client-runtime/data";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { HqRemoteProbe, RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { GitHubIcon } from "~/components/Icons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { stoppedWords } from "~/zerops/stoppedWords";
import { GitMirrorDialog } from "../GitMirrorDialog";
import {
  mirrorAuthorityLine,
  repoState,
  type RepoPress,
  type RepoState,
  type RepoStateApps,
} from "../gitMirror.logic";
import { GithubTokenFields } from "./GithubTokenFields";
import { holdPress, releasePress, useRepoPress } from "./repoPress";

/** What a row's presses do, from the account's operations; absent ones are not offered. */
export interface RepoRowActions {
  readonly disconnect?: (repo: string) => Promise<void>;
  readonly replaceToken?: (repo: string, token: string) => Promise<HqRemoteProbe>;
  readonly unfollow?: (repo: string) => Promise<void>;
  readonly deleteRepository?: (repo: string) => Promise<void>;
}

/** The section as the project page holds it: reads, presses and the connect dialog. */
export function ProjectRepositories({
  groupId,
  groupName,
  repos,
  environments,
}: {
  readonly groupId: string;
  readonly groupName: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly environments: ReadonlyArray<{
    readonly name: string;
    readonly target: { readonly kind: string };
  }>;
}) {
  const git = useGitTargetOperations(groupId);
  const session = useZeropsSessionOptional();
  const navigate = useNavigate();
  const now = useNowMs();
  const [connecting, setConnecting] = useState<string | null>(null);
  // The apps are asked only where a row's stop is told by them: an app gone or not installed.
  const needsApps = (repos ?? []).some(
    (entry) => entry.remote?.via === "app" && entry.remote.invalidSince !== null,
  );
  const mirror = useGitMirrorApps(needsApps);
  const writes = hqOffer(git.can, HQ_REMOTE_WRITE_VERB, {
    current: git.live,
    unavailableSince: git.live ? null : 0,
  });
  return (
    <>
      <RepoRowsView
        actions={git.actions ?? {}}
        admin={roleAtLeast(session?.activeOrganization?.roleCode, "ADMIN")}
        apps={mirror.apps?.kind === "ready" ? mirror.apps : null}
        authority={mirrorAuthorityLine(writes)}
        dependencies={environments
          .filter((environment) => environment.target.kind === "git")
          .map((environment) => environment.name)}
        now={now}
        onConnect={setConnecting}
        onSetUpGithub={() => {
          void navigate({ to: "/settings/automation" });
        }}
        orgName={session?.activeOrganization?.name}
        project={groupId}
        projectName={groupName}
        repos={repos}
      />
      {connecting === null ? null : (
        <GitMirrorDialog
          appId={groupId}
          appName={groupName}
          key={connecting}
          onClose={() => setConnecting(null)}
          repo={connecting}
        />
      )}
    </>
  );
}

export interface RepoRowsViewProps {
  readonly project: string;
  readonly projectName: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly apps: RepoStateApps | null;
  readonly orgName: string | undefined;
  readonly now: number;
  /** Who may change remotes, where HQ does not let this person; `null` where it does. */
  readonly authority: string | null;
  readonly admin: boolean;
  /** Git environments that deliver through the project's remotes: they keep Disconnect away. */
  readonly dependencies: ReadonlyArray<string>;
  readonly actions: RepoRowActions;
  /** Opens the connect dialog for a code repository. */
  readonly onConnect: (repo: string) => void;
  readonly onSetUpGithub: () => void;
  /** A fixture's press, held on every row it names. */
  readonly pressOf?: (repo: string) => RepoPress;
}

export function RepoRowsView(props: RepoRowsViewProps) {
  const listed = props.repos?.filter((entry) => entry.name !== RECIPE_REPO);
  if (listed === undefined)
    return <p className="px-2 text-xs text-muted-foreground">Reading repositories…</p>;
  const someUnconnected = listed.some((entry) => entry.remote == null);
  return (
    <div className="grid" data-zerops-surface="git-remotes">
      <ul className="grid">
        {listed.map((entry) => (
          <RepoRow entry={entry} key={entry.name} {...props} />
        ))}
      </ul>
      {someUnconnected && props.authority !== null ? (
        <p className="px-2 pt-1 text-xs text-muted-foreground">{props.authority}</p>
      ) : null}
    </div>
  );
}

type Panel = "fix" | "disconnect" | "token" | "unfollow" | "delete" | null;

function RepoRow({
  entry,
  project,
  projectName,
  apps,
  orgName,
  now,
  authority,
  admin,
  dependencies,
  actions,
  onConnect,
  onSetUpGithub,
  pressOf,
}: RepoRowsViewProps & { readonly entry: RepoListEntry }) {
  const held = useRepoPress(project, entry.name);
  const press = pressOf?.(entry.name) ?? held;
  const state = repoState(entry, { apps, orgName, now, press });
  const [panel, setPanel] = useState<Panel>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const anchor = useRef<HTMLDivElement>(null);
  const writes = authority === null;
  const remote = entry.remote;
  // Sent and answered, the row says *Disconnecting…* until HQ's record no longer names the remote.
  useEffect(() => {
    if (held === "disconnecting" && remote == null && !inFlight.current)
      releasePress(project, entry.name, "disconnecting");
  }, [entry.name, held, project, remote]);

  const disconnect = async () => {
    if (actions.disconnect === undefined) return;
    setPanel(null);
    setAnswer(null);
    inFlight.current = true;
    holdPress(project, entry.name, "disconnecting");
    try {
      await actions.disconnect(entry.name);
      inFlight.current = false;
      if (remote == null) releasePress(project, entry.name, "disconnecting");
    } catch (cause) {
      inFlight.current = false;
      releasePress(project, entry.name, "disconnecting");
      setAnswer(
        stoppedWords(
          cause,
          "HQ couldn't confirm the disconnect. Check the row before trying again.",
        ),
      );
    }
  };

  const fix = fixButton(state, {
    writes,
    admin,
    onConnect: () => onConnect(entry.name),
    onFix: () => setPanel("fix"),
    onToken: () => setPanel("token"),
    onSetUpGithub,
  });
  const tokenRemote = remote != null && remote.via !== "app";
  const items = {
    open: state.destination,
    change: writes && press === null && (remote != null || entry.follows !== undefined),
    token: writes && press === null && tokenRemote && actions.replaceToken !== undefined,
    disconnect: writes && press === null && remote != null && actions.disconnect !== undefined,
    unfollow:
      writes && remote == null && entry.follows !== undefined && actions.unfollow !== undefined,
    delete: entry.canDelete?.allow === true && actions.deleteRepository !== undefined,
  };
  const menu = Object.values(items).some((item) => item !== null && item !== false);
  return (
    <li className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 px-2 py-2.5 first:border-t-0">
      <div className="grid min-w-0 gap-0.5">
        <p className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="shrink-0 font-mono text-foreground">{entry.name}</span>
          {state.destination === null ? null : (
            <a
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 truncate hover:underline",
                state.tone === "busy" ? "text-muted-foreground" : "text-foreground",
              )}
              href={state.destination.href}
              rel="noreferrer"
              target="_blank"
            >
              <GitHubIcon aria-hidden="true" className="size-3.5 shrink-0 self-center" />
              <span className="truncate">{state.destination.label}</span>
            </a>
          )}
        </p>
        <StateLine state={state} />
        {answer === null ? null : (
          <p className="text-xs text-destructive-foreground" role="status">
            {answer}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1" ref={anchor}>
        {fix}
        {menu ? (
          <Menu>
            <MenuTrigger
              aria-label={`More for ${entry.name}`}
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-52">
              {items.open === null ? null : (
                <MenuItem render={<a href={items.open.href} rel="noreferrer" target="_blank" />}>
                  Open on GitHub ↗
                </MenuItem>
              )}
              {items.change ? (
                <MenuItem onClick={() => onConnect(entry.name)}>Change repository…</MenuItem>
              ) : null}
              {items.token ? (
                <MenuItem onClick={() => setPanel("token")}>Replace token…</MenuItem>
              ) : null}
              {items.disconnect ? (
                <MenuItem onClick={() => setPanel("disconnect")}>Disconnect…</MenuItem>
              ) : null}
              {items.unfollow ? (
                <MenuItem onClick={() => setPanel("unfollow")}>Stop following…</MenuItem>
              ) : null}
              {items.delete ? (
                <>
                  {items.open !== null || items.change || items.disconnect || items.unfollow ? (
                    <MenuSeparator />
                  ) : null}
                  <MenuItem onClick={() => setPanel("delete")} variant="destructive">
                    Delete from Mate…
                  </MenuItem>
                </>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      <Popover
        onOpenChange={(open) => {
          if (!open && !busy) setPanel(null);
        }}
        open={panel !== null}
      >
        <PopoverPopup align="end" anchor={anchor} width="md">
          {panel === "fix" ? (
            <HowToFix />
          ) : panel === "disconnect" && remote != null ? (
            <Confirm
              action="Disconnect"
              onCancel={() => setPanel(null)}
              onConfirm={dependencies.length > 0 ? undefined : () => void disconnect()}
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
    </li>
  );
}

function StateLine({ state }: { readonly state: RepoState }) {
  if (state.tone === "busy")
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <Spinner aria-hidden="true" size="xs" />
        {state.line}
      </p>
    );
  if (state.tone === "quiet") return <p className="text-xs text-muted-foreground">{state.line}</p>;
  return (
    <p
      className={cn(
        "text-xs",
        state.tone === "ok"
          ? "text-muted-foreground"
          : state.tone === "warn"
            ? "text-status-attention-text"
            : "text-status-failed-text",
      )}
    >
      <Badge
        dot
        tone={state.tone === "ok" ? "success" : state.tone === "warn" ? "warning" : "danger"}
        wrap
      >
        {state.line}
      </Badge>
    </p>
  );
}

/** The row's one button: the fix its state offers this person, or nothing. */
function fixButton(
  state: RepoState,
  input: {
    readonly writes: boolean;
    readonly admin: boolean;
    readonly onConnect: () => void;
    readonly onFix: () => void;
    readonly onToken: () => void;
    readonly onSetUpGithub: () => void;
  },
) {
  const press = (label: string, onClick: () => void) => (
    <Button onClick={onClick} size="sm" variant="secondary">
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
    <div className="grid gap-2 text-sm">
      <p className="font-medium">GitHub's main has commits Mate's main doesn't</p>
      <p className="text-muted-foreground">
        Mate stopped pushing so it doesn't overwrite them. Bring those commits into Mate as a
        change, or, if nobody needs them, reset GitHub's main to Mate's. Mate pushes again once the
        two mains match.
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
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
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
      <p className="text-sm font-medium">Replace the token for {repo}</p>
      <GithubTokenFields onToken={setToken} projectName={projectName} token={token} url={url} />
      {refusal === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {refusal}
        </p>
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
      <p className="text-sm font-medium">Delete {repo} from Mate?</p>
      <p className="text-sm text-muted-foreground">
        Its code is deleted from Mate.{" "}
        {destination === null ? "" : `${destination} on GitHub stays as it is.`}
      </p>
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
          {busy ? "Deleting…" : "Delete from Mate"}
        </Button>
      </div>
    </div>
  );
}
