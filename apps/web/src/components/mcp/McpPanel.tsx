/**
 * The Tools tab: what this Mate's coding agents can use right now and, where something doesn't
 * work, why and what to do. Rows group by what needs the person — Waiting on you (the Mate's
 * proposals, a sign-in, a key, a failure to try again), Ready, Off — and every row has the same
 * four columns: a neutral tile, the name and its meta line, a right column holding either the one
 * thing to do or the state, and the chevron. An open row lines its facts up in one label column
 * and keeps maintenance quiet at its foot: one outlined action, a quiet Turn off or on, and Remove
 * alone at the right edge. "Add a tool" in the head opens the same card the Mate proposes with.
 *
 * `McpPanelBody` draws a list it is given and reports what the person does; `McpPanel` feeds it
 * from the Mate (`useMcpServers`). The harness (`/design-mcp.html`) draws the body over a fixture.
 */
import {
  mcpAgentCannot,
  type EnvironmentId,
  type McpServerAddInput,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useProposalDecisions } from "~/zerops/proposalRecord";
import { useKnownMate } from "~/zerops/useZeropsMates";

import { AskCard, AskFooter } from "../ask/AskCard";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { RightPanelPageEdge } from "../RightPanelPage";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { STATUS_BADGE_TONE } from "../zerops/primitives";
import { McpProposalCardContainer } from "../zerops/proposal/McpProposalCardContainer";
import type { McpProposal } from "../zerops/proposal/mcpProposal.logic";
import {
  agentDisplayName,
  BLANK_SIGN_IN,
  buildMcpRows,
  groupMcpRows,
  MCP_SECRET_MASK,
  mcpAppRedirects,
  mcpSecretsFormText,
  mcpSignInStart,
  mcpTileInitials,
  mcpWhere,
  readMcpAddForm,
  readMcpSecretsForm,
  readMcpSignInEdit,
  type McpAddForm,
  type McpAddFormErrors,
  type McpRowGroup,
  type McpServerRow,
  type McpSignInChoice,
  type McpSignInFields,
  type McpTabState,
} from "./McpServers.logic";
import { ObserveLine } from "./ObserveCredentialControl";
import {
  useMcpServers,
  type McpAction,
  type McpActionResult,
  type McpSignInResult,
} from "./useMcpServers";

export const MCP_WORDS = {
  builtIn: "Built in",
  readFailed: "Couldn't read the tools:",
  tryAgain: "Try again",
  none: "No tools yet.",
  addTool: "Add a tool",
  groups: { waiting: "Waiting on you", ready: "Ready", off: "Off" } satisfies Record<
    McpRowGroup,
    string
  >,
  proposedBy: (mate: string) => `Proposed by ${mate}`,
  review: "Review",
  reads: "Reads",
  changes: "Changes",
  tools: "Tools",
  noTools: "None reported yet",
  more: (count: number) => `+ ${String(count)} more`,
  error: "Error",
  runs: "Runs",
  connectsTo: "Connects to",
  signsIn: "Signs in",
  whenAsked: "In the browser, when the server asks",
  comesWith: "Comes with",
  everyMate: "every Mate (zcp)",
  observes: "Stage, prod",
  keptIn: "Kept in",
  fromRepo: "this repo's .mcp.json; edit it there",
  agents: "Agents",
  reconnect: "Reconnect",
  signIn: "Sign in",
  signInAgain: "Sign in again",
  signOut: "Sign out",
  edit: "Edit",
  editEnv: "Edit environment",
  editHeaders: "Edit sign-in and headers",
  signInHow: "How does it sign in?",
  signInNone: "None",
  signInKey: "API key",
  signInWhenAsked: "Sign in",
  signInApp: "Your own app",
  headerName: "Header",
  key: "Key",
  keyHint: "sent as Authorization: Bearer",
  keyKeepHint: "Leave empty to keep the stored key.",
  scopes: "Scopes",
  scopesHint: "optional, space-separated",
  clientId: "Client ID",
  clientSecret: "Client secret",
  clientSecretHint: "optional",
  clientSecretKeepHint: "Leave empty to keep the stored one.",
  redirects: "Register these redirect addresses in your app:",
  editHint: "Leave •••••• to keep a value; take a line out to drop it.",
  save: "Save",
  signInMate: "Finish signing in on the page that opened. This row updates when you come back.",
  signInOpenAgain: "Open it again",
  signInPaste:
    "After you sign in, the browser lands on a page that doesn't load. Copy that page's address and paste it here.",
  signInPastePlaceholder: "http://localhost:…/callback?code=…",
  signInFinish: "Finish",
  turnOff: "Turn off",
  turnOn: "Turn on",
  remove: "Remove",
  removeAsk: (name: string) => `Remove ${name} for every coding agent?`,
  keep: "Keep",
  addTitle: (mate: string) => `Add a tool for ${mate}`,
  addLine: "An MCP server, by address or command",
  addPress: (mate: string) => `Add for ${mate}`,
  addNote: (mate: string) => `Goes to ${mate}'s agents, not the chat`,
  where: "Where it connects",
  wherePlaceholder: "https://mcp.example.com/mcp or npx -y some-mcp-server",
  name: "Name",
  namePlaceholder: "e.g. github",
  env: "Environment",
  envHint: "KEY=value, one a line",
  headers: "Headers",
  headersHint: "Name: value, one a line",
  cancel: "Cancel",
} as const;

/** One of the Mate's proposals still waiting on the person, with the card that answers it. */
export interface McpProposalRow {
  readonly id: string;
  readonly name: string;
  readonly reason: string | null;
  readonly card: ReactNode;
}

export function McpPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
  /** The agent the open conversation runs on: whose state each row carries. */
  readonly driver: ProviderDriverKind | null;
  /** The conversation's MCP proposals; the tab lists the ones HQ knows are still open. */
  readonly proposals?: ReadonlyArray<McpProposal>;
}) {
  const { state, refresh, act, signIn } = useMcpServers({
    environmentId: props.environmentId,
    threadId: props.threadId,
  });
  const mateName = useKnownMate(props.environmentId)?.name;
  const all = props.proposals ?? [];
  const decided = useProposalDecisions(all.map((proposal) => proposal.id));
  const proposals = all.flatMap((proposal): McpProposalRow[] => {
    const entry = decided(proposal.id);
    if (!entry.known || entry.decision !== undefined) return [];
    return [
      {
        id: proposal.id,
        name: proposal.params.server.name,
        reason: proposal.reason ?? proposal.summary,
        card: (
          <McpProposalCardContainer
            driver={props.driver}
            environmentId={props.environmentId}
            proposal={proposal}
            threadId={props.threadId ?? null}
          />
        ),
      },
    ];
  });
  return (
    <McpPanelBody
      act={act}
      driver={props.driver}
      mateName={mateName}
      observe={<ObserveLine environmentId={props.environmentId} />}
      onRetry={refresh}
      proposals={proposals}
      signIn={signIn}
      state={state}
    />
  );
}

export function McpPanelBody(props: {
  readonly state: McpTabState;
  readonly driver: ProviderDriverKind | null;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
  readonly signIn: (name: string) => Promise<McpSignInResult>;
  readonly onRetry: () => void;
  readonly mateName?: string | undefined;
  /** Whose Zerops permissions the built-in row observes stage and production with. */
  readonly observe?: ReactNode;
  readonly proposals?: ReadonlyArray<McpProposalRow> | undefined;
}) {
  const { state, driver, act } = props;
  const mate = props.mateName ?? "this Mate";
  const rows = useMemo(
    () => (state.list === null ? [] : buildMcpRows(state.list, driver)),
    [driver, state.list],
  );
  const listed = new Set(rows.map((row) => row.name.toLowerCase()));
  const proposals = (props.proposals ?? []).filter(
    (proposal) => !listed.has(proposal.name.toLowerCase()),
  );
  const groups = groupMcpRows(rows);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const toggleOpen = (name: string, next: boolean) =>
    setOpen((current) => {
      const copy = new Set(current);
      if (next) copy.add(name);
      else copy.delete(name);
      return copy;
    });
  const waiting = groups.find((group) => group.id === "waiting")?.rows ?? [];
  const shown: ReadonlyArray<{ readonly id: McpRowGroup; readonly count: number }> = [
    { id: "waiting" as const, count: proposals.length + waiting.length },
    ...groups
      .filter((group) => group.id !== "waiting")
      .map((group) => ({ id: group.id, count: group.rows.length })),
  ].filter((group) => group.count > 0);

  return (
    <ScrollArea className="h-full">
      <div
        className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 pt-3 pb-8"
        data-mcp-panel
      >
        {/* The spinner's place beside the head's action is kept: its coming and going moves nothing. */}
        <RightPanelPageEdge>
          <span className="flex items-center gap-2">
            <span className="flex size-4 items-center justify-center" data-mcp-busy={state.busy}>
              {state.busy ? <Spinner size="sm" tone="muted" /> : null}
            </span>
            {state.list === null ? null : (
              <Button
                disabled={adding}
                onClick={() => setAdding(true)}
                size="sm"
                variant="secondary"
              >
                {MCP_WORDS.addTool}
              </Button>
            )}
          </span>
        </RightPanelPageEdge>

        {state.error === null ? null : (
          <p className="text-line leading-4.5 text-destructive-foreground" role="alert">
            {MCP_WORDS.readFailed} {state.error}{" "}
            <InlineButton onClick={props.onRetry} tone="muted">
              {MCP_WORDS.tryAgain}
            </InlineButton>
          </p>
        )}

        {adding && state.list !== null ? (
          <McpAddCard
            act={act}
            agents={state.list.agents}
            existing={state.list.servers.map((entry) => entry.name)}
            mate={mate}
            onClose={() => setAdding(false)}
            onAdded={(name) => {
              setAdding(false);
              toggleOpen(name, true);
            }}
          />
        ) : null}

        {state.list !== null && rows.length === 0 && proposals.length === 0 ? (
          <p className="text-line leading-4.5 text-muted-foreground">{MCP_WORDS.none}</p>
        ) : null}

        {shown.map((group) => (
          <section className="flex flex-col gap-2" data-mcp-group={group.id} key={group.id}>
            <h3 className="flex items-center gap-2 font-medium text-xs text-muted-foreground">
              {MCP_WORDS.groups[group.id]}
              <span className="tabular-nums" data-mcp-group-count>
                {group.count}
              </span>
            </h3>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {group.id === "waiting"
                ? proposals.map((proposal) => (
                    <ProposalRowView
                      key={`proposal:${proposal.id}`}
                      mate={mate}
                      onOpenChange={(next) => toggleOpen(`proposal:${proposal.id}`, next)}
                      open={open.has(`proposal:${proposal.id}`)}
                      proposal={proposal}
                    />
                  ))
                : null}
              {(groups.find((found) => found.id === group.id)?.rows ?? []).map((row) => (
                <ToolRow
                  act={act}
                  agents={state.list?.agents ?? []}
                  key={row.name}
                  observe={row.managed ? props.observe : undefined}
                  onOpenChange={(next) => toggleOpen(row.name, next)}
                  onRefresh={props.onRetry}
                  open={open.has(row.name)}
                  row={row}
                  signIn={props.signIn}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── A row ────────────────────────────────────────────────────────────

/** The neutral tile: colour belongs to state, never to what a tool is. */
function Tile({ letters }: { readonly letters: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted font-medium text-muted-foreground text-xs"
    >
      {letters}
    </span>
  );
}

/** Each installed agent as its own icon with a dot for its state; the words in its tooltip. */
function AgentMarks({ marks }: { readonly marks: McpServerRow["marks"] }) {
  return (
    <span className="relative flex shrink-0 items-center gap-2" data-mcp-agents>
      {marks.map((mark) => {
        const Icon = PROVIDER_ICON_BY_PROVIDER[mark.driver] ?? null;
        return (
          <Tooltip key={mark.driver}>
            <TooltipTrigger
              render={
                <span
                  aria-label={mark.label}
                  className="inline-flex items-center gap-1"
                  data-mcp-agent={mark.driver}
                  data-mcp-agent-tone={mark.tone}
                  role="img"
                />
              }
            >
              {Icon === null ? (
                <span className="text-xs">{agentDisplayName(mark.driver)}</span>
              ) : (
                <Icon aria-hidden className="size-3.5" />
              )}
              <Badge aria-label={mark.label} dot tone={STATUS_BADGE_TONE[mark.tone]} />
            </TooltipTrigger>
            <TooltipPopup>{mark.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </span>
  );
}

/**
 * The row's four columns. The whole row opens it (the trigger lies under its content); only the
 * right column's action and the agent marks' tooltips stand above it.
 */
function RowHead(props: {
  readonly label: string;
  readonly open: boolean;
  readonly tile: ReactNode;
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly right: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/tool relative grid grid-cols-[28px_minmax(0,1fr)_auto_14px] items-center gap-x-3 px-3 py-2.5 transition-colors duration-150 hover:bg-accent/40",
        props.open && "bg-accent/30",
      )}
    >
      <CollapsibleTrigger
        aria-label={props.label}
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      {props.tile}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex h-5 min-w-0 items-center gap-2">{props.title}</span>
        <span className="flex h-4.5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {props.meta}
        </span>
      </span>
      <span className="relative flex min-w-22 items-center justify-end" data-mcp-right>
        {props.right}
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className={cn(
          "size-3.5 text-muted-foreground transition-transform duration-150",
          props.open && "rotate-90",
        )}
      />
    </div>
  );
}

function ProposalRowView(props: {
  readonly proposal: McpProposalRow;
  readonly mate: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { proposal } = props;
  return (
    <li data-mcp-proposal={proposal.id}>
      <Collapsible onOpenChange={props.onOpenChange} open={props.open}>
        <RowHead
          label={`${proposal.name}: ${MCP_WORDS.proposedBy(props.mate)}`}
          meta={<span className="truncate">{proposal.reason}</span>}
          open={props.open}
          right={
            props.open ? null : (
              <Button onClick={() => props.onOpenChange(true)} size="sm" variant="primary">
                {MCP_WORDS.review}
              </Button>
            )
          }
          tile={<Tile letters={mcpTileInitials(proposal.name, false)} />}
          title={
            <>
              <span className="min-w-0 truncate font-medium text-sm">{proposal.name}</span>
              <Badge>{MCP_WORDS.proposedBy(props.mate)}</Badge>
            </>
          }
        />
        <CollapsiblePanel>
          <div className="pt-1 pr-3 pb-4 pl-13">{proposal.card}</div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

interface Signing {
  readonly flow: string;
  readonly url: string;
  readonly landing: "mate" | "paste";
}

type Pending = "reconnect" | "toggle" | "remove" | "signIn" | "signOut" | "finish" | "save";

function ToolRow(props: {
  readonly row: McpServerRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
  readonly signIn: (name: string) => Promise<McpSignInResult>;
  readonly onRefresh: () => void;
  readonly agents: ReadonlyArray<ProviderDriverKind>;
  readonly observe?: ReactNode;
}) {
  const { row, act } = props;
  const [pending, setPending] = useState<Pending | null>(null);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [startedSigning, setSigning] = useState<Signing | null>(null);
  const [landed, setLanded] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const remote = row.config.kind === "url";
  const signInStart = useMemo(() => mcpSignInStart(row), [row]);
  const [signInFields, setSignInFields] = useState<McpSignInFields>(signInStart);
  // A sign-in under way shows only while the agent still waits for one.
  const signing = row.actions.signIn === null ? null : startedSigning;

  const run = async (which: Pending, action: McpAction) => {
    setPending(which);
    setFailure(null);
    const result = await act(action);
    setPending(null);
    setArmed(false);
    if (!result.ok) setFailure(result.message);
  };

  const startSignIn = async () => {
    // Opened in the press itself, so no popup blocker stands in the way; pointed at the
    // provider's page once the Mate answers, with no way back to this window.
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    props.onOpenChange(true);
    setPending("signIn");
    setFailure(null);
    const result = await props.signIn(row.name);
    setPending(null);
    if (!result.ok || result.signIn.kind === "signed-in") {
      tab?.close();
      if (result.ok) props.onRefresh();
      else setFailure(result.message);
      return;
    }
    const { flow, url, landing } = result.signIn;
    if (tab !== null) tab.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    setLanded("");
    setSigning({ flow, url, landing });
  };

  const openEdit = (choice?: McpSignInChoice) => {
    props.onOpenChange(true);
    setEditError(null);
    setSignInFields(choice === undefined ? signInStart : { ...signInStart, choice });
    setEditing(mcpSecretsFormText(row.secrets.kind, row.secrets.names));
  };

  const finishSignIn = async (current: Signing) => {
    setPending("finish");
    setFailure(null);
    const result = await act({
      kind: "finishSignIn",
      name: row.name,
      flow: current.flow,
      landed: landed.trim(),
    });
    setPending(null);
    if (result.ok) setSigning(null);
    else setFailure(result.message);
  };

  const saveEdit = async (text: string) => {
    const read = readMcpSecretsForm(row.secrets.kind, text);
    if (!read.ok) {
      setEditError(read.error);
      return;
    }
    const signIn = remote
      ? readMcpSignInEdit(signInStart, signInFields)
      : { ok: true as const, auth: undefined };
    if (!signIn.ok) {
      setEditError(signIn.error);
      return;
    }
    setPending("save");
    setEditError(null);
    const result = await act({
      kind: "update",
      name: row.name,
      values: read.values,
      keep: read.keep,
      ...(signIn.auth !== undefined ? { auth: signIn.auth } : {}),
    });
    setPending(null);
    if (result.ok) setEditing(null);
    else setEditError(result.message);
  };

  const { right } = row;
  const rightColumn =
    right.kind === "state" ? (
      <Badge dot tone={STATUS_BADGE_TONE[right.tone]}>
        <span className="text-xs text-muted-foreground" data-mcp-state-words>
          {right.words}
        </span>
      </Badge>
    ) : (
      <Button
        disabled={pending !== null}
        onClick={() => {
          if (right.action === "signIn") void startSignIn();
          else if (right.action === "addKey") openEdit("header");
          else void run("reconnect", { kind: "reconnect", name: row.name });
        }}
        size="sm"
        variant="primary"
      >
        {pending === "signIn" || (right.action === "tryAgain" && pending === "reconnect") ? (
          <Spinner size="xs" />
        ) : null}
        {right.label}
      </Button>
    );

  // The meta line: the agents as marks, then the one thing the right column can't say.
  const metaWords =
    row.cannot.length > 0
      ? row.cannot.length === 1
        ? row.cannot[0]
        : row.cannot.join(" ")
      : right.kind === "action" && right.action !== "tryAgain" && right.action !== "addKey"
        ? null
        : (row.note?.text ?? null);

  return (
    <li data-mcp-group={row.group} data-mcp-server={row.name} data-mcp-state={row.state}>
      <Collapsible onOpenChange={props.onOpenChange} open={props.open}>
        <RowHead
          label={`${row.name}: ${right.kind === "state" ? right.words : right.label}`}
          meta={
            <>
              {row.marks.length > 0 ? <AgentMarks marks={row.marks} /> : null}
              {metaWords === null ? null : (
                <span
                  className={cn(
                    "min-w-0 truncate",
                    row.note?.kind === "error" &&
                      row.cannot.length === 0 &&
                      "text-destructive-foreground",
                  )}
                  data-mcp-note={row.note?.kind}
                >
                  {metaWords}
                </span>
              )}
            </>
          }
          open={props.open}
          right={rightColumn}
          tile={<Tile letters={row.initials} />}
          title={
            <>
              <span
                className={cn(
                  "min-w-0 shrink truncate font-medium text-sm",
                  row.state === "disabled" && "text-muted-foreground",
                )}
              >
                {row.name}
              </span>
              <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">
                {row.runs}
              </span>
              {row.managed ? <Badge className="shrink-0">{MCP_WORDS.builtIn}</Badge> : null}
            </>
          }
        />
        <CollapsiblePanel>
          <div className="flex flex-col gap-3 pt-2 pr-3 pb-3 pl-13" data-mcp-details={row.name}>
            <ToolFacts
              observe={props.observe}
              onSignOut={() => void run("signOut", { kind: "signOut", name: row.name })}
              pending={pending}
              row={row}
            />

            {signing === null ? null : signing.landing === "mate" ? (
              <p className="text-xs text-muted-foreground" data-mcp-signing="mate">
                {MCP_WORDS.signInMate}{" "}
                <InlineButton
                  onClick={() => window.open(signing.url, "_blank", "noopener,noreferrer")}
                  tone="muted"
                >
                  {MCP_WORDS.signInOpenAgain}
                </InlineButton>
              </p>
            ) : (
              <form
                className="flex flex-col gap-1.5"
                data-mcp-signing="paste"
                onSubmit={(event) => {
                  event.preventDefault();
                  void finishSignIn(signing);
                }}
              >
                <span className="text-xs text-muted-foreground">{MCP_WORDS.signInPaste}</span>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={MCP_WORDS.signInPaste}
                      autoComplete="off"
                      nativeInput
                      onChange={(event) => setLanded(event.target.value)}
                      placeholder={MCP_WORDS.signInPastePlaceholder}
                      size="sm"
                      spellCheck={false}
                      value={landed}
                    />
                  </div>
                  <Button
                    disabled={pending !== null || landed.trim() === ""}
                    size="sm"
                    type="submit"
                    variant="secondary"
                  >
                    {pending === "finish" ? <Spinner size="xs" /> : null}
                    {MCP_WORDS.signInFinish}
                  </Button>
                </div>
              </form>
            )}

            {editing === null ? null : (
              <form
                className="flex flex-col gap-3"
                data-mcp-editing
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEdit(editing);
                }}
              >
                {remote ? (
                  <SignInFields
                    editing
                    fields={signInFields}
                    onChange={setSignInFields}
                    redirects={mcpAppRedirects(props.agents)}
                  />
                ) : null}
                <FieldLine
                  error={undefined}
                  hint={row.secrets.kind === "env" ? MCP_WORDS.envHint : MCP_WORDS.headersHint}
                  label={row.secrets.kind === "env" ? MCP_WORDS.env : MCP_WORDS.headers}
                >
                  <Textarea
                    aria-label={
                      row.secrets.kind === "env" ? MCP_WORDS.editEnv : MCP_WORDS.editHeaders
                    }
                    autoCapitalize="off"
                    autoComplete="off"
                    onChange={(event) => setEditing(event.target.value)}
                    rows={3}
                    size="sm"
                    spellCheck={false}
                    value={editing}
                  />
                </FieldLine>
                <span className="text-xs text-muted-foreground">{MCP_WORDS.editHint}</span>
                {editError === null ? null : (
                  <span className="text-xs text-destructive-foreground" role="alert">
                    {editError}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Button disabled={pending !== null} size="sm" type="submit" variant="primary">
                    {pending === "save" ? <Spinner size="xs" /> : null}
                    {MCP_WORDS.save}
                  </Button>
                  <Button
                    disabled={pending !== null}
                    onClick={() => setEditing(null)}
                    size="sm"
                    variant="ghost"
                  >
                    {MCP_WORDS.cancel}
                  </Button>
                </div>
              </form>
            )}

            <ToolFoot
              armed={armed}
              editing={editing !== null}
              onArm={setArmed}
              onEdit={() => openEdit()}
              pending={pending}
              row={row}
              run={run}
            />
            {failure === null ? null : (
              <p className="text-xs text-destructive-foreground" role="alert">
                {failure}
              </p>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

/** One label column down every open row, so values line up across the tab. */
function Fact(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-xs leading-5 text-muted-foreground">{props.label}</dt>
      <dd className="m-0 min-w-0 text-xs leading-5">{props.children}</dd>
    </>
  );
}

const TOOLS_SHOWN = 6;

/** A tool's name, its description on hover where the server gave one. */
function ToolNames({ tools }: { readonly tools: ReadonlyArray<McpServerRow["tools"][number]> }) {
  const [all, setAll] = useState(false);
  const names = tools;
  const shown = all ? tools : tools.slice(0, TOOLS_SHOWN);
  return (
    <span className="flex flex-wrap items-center gap-1" data-mcp-tools>
      {shown.map((tool) => {
        const chip = (
          <span className="rounded-md border border-border px-1.5 font-mono text-xs leading-5">
            {tool.name}
          </span>
        );
        return tool.description === null ? (
          <span key={tool.name}>{chip}</span>
        ) : (
          <Tooltip key={tool.name}>
            <TooltipTrigger render={<span />}>{chip}</TooltipTrigger>
            <TooltipPopup>{tool.description}</TooltipPopup>
          </Tooltip>
        );
      })}
      {names.length > shown.length ? (
        <InlineButton onClick={() => setAll(true)} tone="muted">
          {MCP_WORDS.more(names.length - shown.length)}
        </InlineButton>
      ) : null}
    </span>
  );
}

function ToolFacts(props: {
  readonly row: McpServerRow;
  readonly observe?: ReactNode;
  readonly pending: Pending | null;
  readonly onSignOut: () => void;
}) {
  const { row } = props;
  const reads = row.tools.filter((tool) => tool.mark === "reads");
  const changes = row.tools.filter((tool) => tool.mark === "changes");
  const unmarked = row.tools.filter((tool) => tool.mark === null);
  const error = row.note?.kind === "error" ? row.note.text : null;
  return (
    <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5" data-mcp-facts>
      {reads.length > 0 ? (
        <Fact label={MCP_WORDS.reads}>
          <ToolNames tools={reads} />
        </Fact>
      ) : null}
      {changes.length > 0 ? (
        <Fact label={MCP_WORDS.changes}>
          <ToolNames tools={changes} />
        </Fact>
      ) : null}
      {unmarked.length > 0 || row.tools.length === 0 ? (
        <Fact label={MCP_WORDS.tools}>
          {unmarked.length > 0 ? (
            <ToolNames tools={unmarked} />
          ) : (
            <span className="text-muted-foreground">{MCP_WORDS.noTools}</span>
          )}
        </Fact>
      ) : null}
      {error === null ? null : (
        <Fact label={MCP_WORDS.error}>
          <span className="whitespace-pre-wrap break-words font-mono text-destructive-foreground">
            {error}
          </span>
        </Fact>
      )}
      {row.managed && props.observe !== undefined ? (
        <Fact label={MCP_WORDS.observes}>{props.observe}</Fact>
      ) : null}
      <Fact label={row.config.kind === "command" ? MCP_WORDS.runs : MCP_WORDS.connectsTo}>
        <span className="break-all font-mono">
          {row.config.kind === "command" ? row.config.line : row.config.url}
        </span>
      </Fact>
      {row.signInLabel === null && !row.actions.signOut ? null : (
        <Fact label={MCP_WORDS.signsIn}>
          <span data-mcp-sign-in-label>{row.signInLabel ?? MCP_WORDS.whenAsked}</span>
          {row.actions.signOut ? (
            <>
              {" · "}
              <InlineButton disabled={props.pending !== null} onClick={props.onSignOut}>
                {MCP_WORDS.signOut}
              </InlineButton>
            </>
          ) : null}
        </Fact>
      )}
      {row.secrets.names.length === 0 ? null : (
        <Fact label={row.secrets.kind === "env" ? MCP_WORDS.env : MCP_WORDS.headers}>
          <span className="flex flex-col" data-mcp-secrets>
            {row.secrets.names.map((name) => (
              <span className="flex min-w-0 gap-2 font-mono" key={name}>
                <span className="min-w-0 truncate">{name}</span>
                <span className="shrink-0 text-muted-foreground">{MCP_SECRET_MASK}</span>
              </span>
            ))}
          </span>
        </Fact>
      )}
      {row.agentsLine === null ? null : (
        <Fact label={MCP_WORDS.agents}>
          <span data-mcp-agents-line>{row.agentsLine}</span>
        </Fact>
      )}
      {row.managed ? <Fact label={MCP_WORDS.comesWith}>{MCP_WORDS.everyMate}</Fact> : null}
      {row.origin === "repo" ? <Fact label={MCP_WORDS.keptIn}>{MCP_WORDS.fromRepo}</Fact> : null}
    </dl>
  );
}

/**
 * The open row's quiet foot: one outlined action (the fix, Reconnect or Turn on), quiet
 * presses after it, and Remove alone at the right edge. Removing asks once, in place.
 */
function ToolFoot(props: {
  readonly row: McpServerRow;
  readonly pending: Pending | null;
  readonly armed: boolean;
  readonly editing: boolean;
  readonly onArm: (armed: boolean) => void;
  readonly onEdit: () => void;
  readonly run: (which: Pending, action: McpAction) => Promise<void>;
}) {
  const { row, pending } = props;
  const busy = pending !== null;
  const spin = (which: Pending) => (pending === which ? <Spinner size="xs" /> : null);
  if (props.armed) {
    return (
      <div className="flex min-h-7 flex-wrap items-center gap-2" data-mcp-actions>
        <span className="text-xs">{MCP_WORDS.removeAsk(row.name)}</span>
        <Button
          disabled={busy}
          onClick={() => void props.run("remove", { kind: "remove", name: row.name })}
          size="sm"
          variant="destructive"
        >
          {spin("remove")}
          {MCP_WORDS.remove}
        </Button>
        <Button disabled={busy} onClick={() => props.onArm(false)} size="sm" variant="ghost">
          {MCP_WORDS.keep}
        </Button>
      </div>
    );
  }
  const off = row.actions.toggle === "on";
  const editable = row.secrets.editable && !props.editing;
  const editLabel = row.secrets.kind === "env" ? MCP_WORDS.editEnv : MCP_WORDS.editHeaders;
  const outlined = off ? "turnOn" : row.actions.reconnect ? "reconnect" : editable ? "edit" : null;
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-2" data-mcp-actions>
      {outlined === "turnOn" ? (
        <Button
          disabled={busy}
          onClick={() =>
            void props.run("toggle", { kind: "setEnabled", name: row.name, enabled: true })
          }
          size="sm"
          variant="secondary"
        >
          {spin("toggle")}
          {MCP_WORDS.turnOn}
        </Button>
      ) : outlined === "reconnect" ? (
        <Button
          disabled={busy}
          onClick={() => void props.run("reconnect", { kind: "reconnect", name: row.name })}
          size="sm"
          variant="secondary"
        >
          {spin("reconnect")}
          {MCP_WORDS.reconnect}
        </Button>
      ) : outlined === "edit" ? (
        <Button disabled={busy} onClick={props.onEdit} size="sm" variant="secondary">
          {editLabel}
        </Button>
      ) : null}
      {editable && outlined !== "edit" ? (
        <Button disabled={busy} onClick={props.onEdit} size="sm" variant="ghost">
          {MCP_WORDS.edit}
        </Button>
      ) : null}
      {row.actions.toggle === "off" ? (
        <Button
          disabled={busy}
          onClick={() =>
            void props.run("toggle", { kind: "setEnabled", name: row.name, enabled: false })
          }
          size="sm"
          variant="ghost"
        >
          {spin("toggle")}
          {MCP_WORDS.turnOff}
        </Button>
      ) : null}
      {row.actions.remove ? (
        <span className="ms-auto">
          <Button
            disabled={busy}
            onClick={() => props.onArm(true)}
            size="sm"
            variant="destructive-ghost"
          >
            {MCP_WORDS.remove}
          </Button>
        </span>
      ) : null}
    </div>
  );
}

// ── Fields ───────────────────────────────────────────────────────────

function FieldLine(props: {
  readonly label: string;
  readonly hint?: string;
  readonly error: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">{props.label}</span>
        {props.hint === undefined ? null : (
          <span className="text-muted-foreground">{props.hint}</span>
        )}
      </span>
      {props.children}
      {props.error === undefined ? null : (
        <span className="text-xs text-destructive-foreground" role="alert">
          {props.error}
        </span>
      )}
    </label>
  );
}

const SIGN_IN_CHOICES: ReadonlyArray<{ readonly value: McpSignInChoice; readonly label: string }> =
  [
    { value: "none", label: MCP_WORDS.signInNone },
    { value: "header", label: MCP_WORDS.signInKey },
    { value: "oauth", label: MCP_WORDS.signInWhenAsked },
    { value: "oauth-app", label: MCP_WORDS.signInApp },
  ];

/** How a URL server signs in: one choice, and only the fields that choice needs. */
function SignInFields(props: {
  readonly fields: McpSignInFields;
  readonly onChange: (fields: McpSignInFields) => void;
  readonly redirects: ReadonlyArray<{ readonly agent: string; readonly url: string }>;
  /** The edit form: an empty key or client secret keeps the stored one. */
  readonly editing?: boolean;
  readonly error?: string | undefined;
}) {
  const { fields } = props;
  const set = (patch: Partial<McpSignInFields>) => props.onChange({ ...fields, ...patch });
  const text = (
    label: string,
    key: "headerName" | "key" | "scopes" | "clientId" | "clientSecret",
    hint?: string,
    secret = false,
  ) => (
    <FieldLine error={undefined} label={label} {...(hint === undefined ? {} : { hint })}>
      <Input
        autoCapitalize="off"
        autoComplete="off"
        nativeInput
        onChange={(event) => set({ [key]: event.target.value })}
        size="sm"
        spellCheck={false}
        type={secret ? "password" : "text"}
        value={fields[key]}
      />
    </FieldLine>
  );
  const bearer = fields.headerName.trim().toLowerCase() === "authorization";
  return (
    <div className="flex flex-col gap-3" data-mcp-sign-in={fields.choice}>
      <div className="flex flex-col gap-1">
        <span className="font-medium text-xs">{MCP_WORDS.signInHow}</span>
        <ToggleGroup
          aria-label={MCP_WORDS.signInHow}
          className="self-start"
          onValueChange={(next) => {
            const choice = SIGN_IN_CHOICES.find((option) => option.value === next[0])?.value;
            if (choice !== undefined) set({ choice });
          }}
          value={[fields.choice]}
          variant="segmented"
        >
          {SIGN_IN_CHOICES.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      {fields.choice === "header" ? (
        <>
          {text(MCP_WORDS.headerName, "headerName")}
          {text(
            MCP_WORDS.key,
            "key",
            props.editing ? MCP_WORDS.keyKeepHint : bearer ? MCP_WORDS.keyHint : undefined,
            true,
          )}
        </>
      ) : null}
      {fields.choice === "oauth" ? text(MCP_WORDS.scopes, "scopes", MCP_WORDS.scopesHint) : null}
      {fields.choice === "oauth-app" ? (
        <>
          {text(MCP_WORDS.clientId, "clientId")}
          {text(
            MCP_WORDS.clientSecret,
            "clientSecret",
            props.editing ? MCP_WORDS.clientSecretKeepHint : MCP_WORDS.clientSecretHint,
            true,
          )}
          {text(MCP_WORDS.scopes, "scopes", MCP_WORDS.scopesHint)}
          {props.redirects.length === 0 ? null : (
            <div className="flex flex-col gap-0.5 text-xs" data-mcp-redirects>
              <span className="text-muted-foreground">{MCP_WORDS.redirects}</span>
              {props.redirects.map((redirect) => (
                <span className="flex min-w-0 gap-2" key={redirect.agent}>
                  <span className="shrink-0">{redirect.agent}</span>
                  <span className="min-w-0 break-all font-mono">{redirect.url}</span>
                </span>
              ))}
            </div>
          )}
        </>
      ) : null}
      {props.error === undefined ? null : (
        <span className="text-xs text-destructive-foreground" role="alert">
          {props.error}
        </span>
      )}
    </div>
  );
}

// ── Adding ───────────────────────────────────────────────────────────

const BLANK_FORM: McpAddForm = {
  name: "",
  kind: "command",
  commandLine: "",
  url: "",
  extra: "",
  signIn: BLANK_SIGN_IN,
};

/**
 * "Add a tool": the card the Mate proposes with, filled in by the person — where it connects,
 * its name, how it signs in and only the fields that needs. The agents that can't use it as set
 * up are named before it is added, from the same table the Mate's list reads.
 */
function McpAddCard(props: {
  readonly existing: ReadonlyArray<string>;
  readonly agents: ReadonlyArray<ProviderDriverKind>;
  readonly mate: string;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
  readonly onAdded: (name: string) => void;
  readonly onClose: () => void;
}) {
  const [where, setWhere] = useState("");
  const [form, setForm] = useState<McpAddForm>(BLANK_FORM);
  const [errors, setErrors] = useState<McpAddFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const reach = mcpWhere(where);
  const full: McpAddForm = { ...form, ...reach.form };
  const command = full.kind === "command";
  const read = readMcpAddForm(full, props.existing);
  // Who can't use it is known from where it connects and how it signs in, before it has a name.
  const needs = readMcpAddForm({ ...full, name: full.name.trim() || "tool" }, []);
  const cannot = needs.ok
    ? props.agents.flatMap((driver) => mcpAgentCannot(driver, needs.input) ?? [])
    : [];
  const edit = (patch: Partial<McpAddForm>, clears: keyof McpAddFormErrors) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      if (current[clears] === undefined) return current;
      const { [clears]: _cleared, ...rest } = current;
      return rest;
    });
  };
  const submit = async () => {
    if (!read.ok) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setPending(true);
    const input: McpServerAddInput = read.input;
    const result = await props.act({ kind: "add", input });
    setPending(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    props.onAdded(input.name);
  };
  const filled = form.name.trim() !== "" && where.trim() !== "";
  return (
    <form
      data-mcp-add
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <AskCard
        askId="mcp-add"
        density="full"
        footer={
          <AskFooter
            also={
              <Button disabled={pending} onClick={props.onClose} size="md" variant="ghost">
                {MCP_WORDS.cancel}
              </Button>
            }
            density="full"
            main={{
              label: MCP_WORDS.addPress(props.mate),
              onPress: () => void submit(),
              disabled: !filled,
            }}
            note={MCP_WORDS.addNote(props.mate)}
            state={
              failure !== null
                ? { kind: "waiting" }
                : pending
                  ? { kind: "working", words: "Adding…", pressed: "main" }
                  : { kind: "waiting" }
            }
          />
        }
        kind="mcp-add"
        state={pending ? "working" : "waiting"}
        title={MCP_WORDS.addTitle(props.mate)}
        where={{ scope: "mate", detail: null }}
      >
        <p className="text-caption text-muted-foreground">{MCP_WORDS.addLine}</p>
        <FieldLine error={errors.target} label={MCP_WORDS.where}>
          <Input
            autoCapitalize="off"
            autoComplete="off"
            autoFocus
            nativeInput
            onChange={(event) => {
              setWhere(event.target.value);
              setErrors(({ target: _target, ...rest }) => rest);
            }}
            placeholder={MCP_WORDS.wherePlaceholder}
            size="sm"
            spellCheck={false}
            value={where}
          />
        </FieldLine>
        {reach.words === null ? null : (
          <span className="text-caption text-muted-foreground" data-mcp-reach>
            {reach.words}
          </span>
        )}
        <FieldLine error={errors.name} label={MCP_WORDS.name}>
          <Input
            autoCapitalize="off"
            autoComplete="off"
            nativeInput
            onChange={(event) => edit({ name: event.target.value }, "name")}
            placeholder={MCP_WORDS.namePlaceholder}
            size="sm"
            spellCheck={false}
            value={form.name}
          />
        </FieldLine>
        {command ? (
          <FieldLine error={errors.extra} hint={MCP_WORDS.envHint} label={MCP_WORDS.env}>
            <Textarea
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => edit({ extra: event.target.value }, "extra")}
              rows={2}
              size="sm"
              spellCheck={false}
              value={form.extra}
            />
          </FieldLine>
        ) : (
          <SignInFields
            error={errors.auth}
            fields={form.signIn}
            onChange={(signIn) => edit({ signIn }, "auth")}
            redirects={mcpAppRedirects(props.agents)}
          />
        )}
        {cannot.length === 0 ? null : (
          <p className="text-caption text-muted-foreground" data-mcp-add-cannot>
            {cannot.join(" ")}
          </p>
        )}
        {failure === null ? null : (
          <p className="text-caption text-destructive-foreground" role="alert">
            {failure}
          </p>
        )}
      </AskCard>
    </form>
  );
}
