/**
 * The MCP tab: the servers this Mate's agents can call, one row each, and a
 * form to add one for every agent.
 *
 * `McpPanelBody` draws a list it is given and reports what the person does;
 * `McpPanel` feeds it from the Mate (`useMcpServers`). The harness
 * (`/design-mcp.html`) draws the body over a fixture.
 */
import type { EnvironmentId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Button, InlineButton } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Chip, MicroLabel, StatusDot } from "../zerops/primitives";
import {
  buildMcpRows,
  readMcpAddForm,
  type McpAddForm,
  type McpAddFormErrors,
  type McpServerRow,
  type McpTabState,
} from "./McpServers.logic";
import { useMcpServers, type McpAction, type McpActionResult } from "./useMcpServers";

export const MCP_WORDS = {
  title: "MCP servers",
  line: "Tools your agents can call. A server added here is set up for every agent on this Mate.",
  builtIn: "Built in",
  readFailed: "Couldn't read the servers:",
  tryAgain: "Try again",
  none: "No servers yet.",
  tools: "Tools",
  noTools: "No tools reported yet.",
  readOnly: "Read-only",
  canChange: "Can change",
  error: "Error",
  runs: "Runs",
  url: "URL",
  reconnect: "Reconnect",
  turnOff: "Turn off",
  turnOn: "Turn on",
  remove: "Remove",
  removeAsk: (name: string) => `Remove ${name} for every agent?`,
  keep: "Keep",
  fromRepo: "From this repo's .mcp.json — edit it there.",
  addTitle: "Add a server",
  name: "Name",
  command: "Command",
  url2: "URL",
  commandPlaceholder: "npx -y @modelcontextprotocol/server-github",
  urlPlaceholder: "https://mcp.example.com/mcp",
  env: "Environment",
  envHint: "KEY=value, one a line",
  headers: "Headers",
  headersHint: "Name: value, one a line",
  add: "Add",
} as const;

export function McpPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
  /** The agent the open conversation runs on: whose state each dot carries. */
  readonly driver: ProviderDriverKind | null;
}) {
  const { state, refresh, act } = useMcpServers({
    environmentId: props.environmentId,
    threadId: props.threadId,
  });
  return <McpPanelBody act={act} driver={props.driver} onRetry={refresh} state={state} />;
}

export function McpPanelBody(props: {
  readonly state: McpTabState;
  readonly driver: ProviderDriverKind | null;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
  readonly onRetry: () => void;
}) {
  const { state, driver, act } = props;
  const rows = useMemo(
    () => (state.list === null ? [] : buildMcpRows(state.list, driver)),
    [driver, state.list],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleOpen = (name: string, next: boolean) =>
    setOpen((current) => {
      const copy = new Set(current);
      if (next) copy.add(name);
      else copy.delete(name);
      return copy;
    });

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-full w-full max-w-3xl flex-col px-4 pt-3 pb-8" data-mcp-panel>
        <div className="mt-1 flex h-7 items-center gap-2">
          <h2 className="font-semibold text-base leading-6">{MCP_WORDS.title}</h2>
          <span className="grow" />
          {/* The spinner's place is kept, so its coming and going moves nothing. */}
          <span className="flex size-4 items-center justify-center" data-mcp-busy={state.busy}>
            {state.busy ? <Spinner size="sm" tone="muted" /> : null}
          </span>
        </div>
        <p className="mt-0.5 text-line leading-4.5 text-muted-foreground">{MCP_WORDS.line}</p>

        {state.error === null ? null : (
          <p className="mt-3 text-line leading-4.5 text-destructive-foreground" role="alert">
            {MCP_WORDS.readFailed} {state.error}{" "}
            <InlineButton onClick={props.onRetry} tone="muted">
              {MCP_WORDS.tryAgain}
            </InlineButton>
          </p>
        )}

        {state.list === null ? null : rows.length === 0 ? (
          <p className="mt-4 text-line leading-4.5 text-muted-foreground">{MCP_WORDS.none}</p>
        ) : (
          <ul className="-mx-2 mt-3 flex flex-col" data-mcp-rows>
            {rows.map((row) => (
              <McpServerRowView
                act={act}
                key={row.name}
                onOpenChange={(next) => toggleOpen(row.name, next)}
                open={open.has(row.name)}
                row={row}
              />
            ))}
          </ul>
        )}

        {state.list === null ? null : (
          <McpAddServer
            act={act}
            existing={state.list.servers.map((entry) => entry.name)}
            onAdded={(name) => toggleOpen(name, true)}
          />
        )}
      </div>
    </ScrollArea>
  );
}

function McpServerRowView(props: {
  readonly row: McpServerRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
}) {
  const { row } = props;
  return (
    <li data-mcp-server={row.name} data-mcp-state={row.state}>
      <Collapsible onOpenChange={props.onOpenChange} open={props.open}>
        <CollapsibleTrigger className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex h-5 shrink-0 items-center">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <StatusDot dotOnly label={row.stateLabel} tone={row.tone} />
              </TooltipTrigger>
              <TooltipPopup>{row.stateLabel}</TooltipPopup>
            </Tooltip>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex h-5 min-w-0 items-center gap-2">
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
              {row.managed ? (
                <Chip className="shrink-0" label={MCP_WORDS.builtIn} tone="off" />
              ) : null}
            </span>
            {row.note === null ? null : (
              <span
                className={cn(
                  "line-clamp-2 text-xs leading-4.5",
                  row.note.kind === "error"
                    ? "text-destructive-foreground"
                    : "text-muted-foreground",
                )}
                data-mcp-note={row.note.kind}
              >
                {row.note.text}
              </span>
            )}
            {row.agentsLine === null ? null : (
              <span className="truncate text-xs leading-4.5 text-muted-foreground" data-mcp-agents>
                {row.agentsLine}
              </span>
            )}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <McpServerDetails act={props.act} row={row} />
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

function DetailBlock({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <MicroLabel>{label}</MicroLabel>
      {children}
    </div>
  );
}

function McpServerDetails(props: {
  readonly row: McpServerRow;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
}) {
  const { row, act } = props;
  const [pending, setPending] = useState<"reconnect" | "toggle" | "remove" | null>(null);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (which: "reconnect" | "toggle" | "remove", action: McpAction) => {
    setPending(which);
    setFailure(null);
    const result = await act(action);
    setPending(null);
    setArmed(false);
    if (!result.ok) setFailure(result.message);
  };

  const error = row.note?.kind === "error" ? row.note.text : null;
  return (
    <div className="flex flex-col gap-3 pt-1 pr-2 pb-4 pl-7" data-mcp-details={row.name}>
      <DetailBlock label={MCP_WORDS.tools}>
        {row.tools.length === 0 ? (
          <span className="text-xs text-muted-foreground">{MCP_WORDS.noTools}</span>
        ) : (
          <ul className="flex flex-col gap-0.5" data-mcp-tools>
            {row.tools.map((tool) => (
              <li className="flex min-w-0 items-baseline gap-2 text-xs" key={tool.name}>
                <span className="shrink-0 font-mono">{tool.name}</span>
                {tool.mark === null ? null : (
                  <span className="shrink-0 text-muted-foreground" data-mcp-tool-mark={tool.mark}>
                    {tool.mark === "reads" ? MCP_WORDS.readOnly : MCP_WORDS.canChange}
                  </span>
                )}
                {tool.description === null ? null : (
                  <span className="min-w-0 truncate text-muted-foreground">{tool.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailBlock>
      {error === null ? null : (
        <DetailBlock label={MCP_WORDS.error}>
          <span className="whitespace-pre-wrap break-words font-mono text-xs text-destructive-foreground">
            {error}
          </span>
        </DetailBlock>
      )}
      <DetailBlock label={row.config.kind === "command" ? MCP_WORDS.runs : MCP_WORDS.url}>
        <span className="break-all font-mono text-xs">
          {row.config.kind === "command" ? row.config.line : row.config.url}
        </span>
      </DetailBlock>

      <div className="flex min-h-7 flex-wrap items-center gap-2" data-mcp-actions>
        {armed ? (
          <>
            <span className="text-xs">{MCP_WORDS.removeAsk(row.name)}</span>
            <Button
              disabled={pending !== null}
              onClick={() => void run("remove", { kind: "remove", name: row.name })}
              size="xs"
              variant="destructive"
            >
              {pending === "remove" ? <Spinner size="xs" /> : null}
              {MCP_WORDS.remove}
            </Button>
            <Button
              disabled={pending !== null}
              onClick={() => setArmed(false)}
              size="xs"
              variant="ghost"
            >
              {MCP_WORDS.keep}
            </Button>
          </>
        ) : (
          <>
            {row.actions.reconnect ? (
              <Button
                disabled={pending !== null}
                onClick={() => void run("reconnect", { kind: "reconnect", name: row.name })}
                size="xs"
                variant="outline"
              >
                {pending === "reconnect" ? <Spinner size="xs" /> : null}
                {MCP_WORDS.reconnect}
              </Button>
            ) : null}
            {row.actions.toggle === null ? null : (
              <Button
                disabled={pending !== null}
                onClick={() =>
                  void run("toggle", {
                    kind: "setEnabled",
                    name: row.name,
                    enabled: row.actions.toggle === "on",
                  })
                }
                size="xs"
                variant="outline"
              >
                {pending === "toggle" ? <Spinner size="xs" /> : null}
                {row.actions.toggle === "on" ? MCP_WORDS.turnOn : MCP_WORDS.turnOff}
              </Button>
            )}
            {row.actions.remove ? (
              <Button
                disabled={pending !== null}
                onClick={() => setArmed(true)}
                size="xs"
                variant="ghost-destructive"
              >
                {MCP_WORDS.remove}
              </Button>
            ) : null}
            {row.origin === "repo" ? (
              <span className="text-xs text-muted-foreground">{MCP_WORDS.fromRepo}</span>
            ) : null}
          </>
        )}
      </div>
      {failure === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

const BLANK_FORM: McpAddForm = { name: "", kind: "command", commandLine: "", url: "", extra: "" };

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

function McpAddServer(props: {
  readonly existing: ReadonlyArray<string>;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
  readonly onAdded: (name: string) => void;
}) {
  const [form, setForm] = useState<McpAddForm>(BLANK_FORM);
  const [errors, setErrors] = useState<McpAddFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const edit = (patch: Partial<McpAddForm>, clears: keyof McpAddFormErrors) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      if (current[clears] === undefined) return current;
      const { [clears]: _cleared, ...rest } = current;
      return rest;
    });
  };

  const submit = async () => {
    const read = readMcpAddForm(form, props.existing);
    if (!read.ok) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setPending(true);
    const result = await props.act({ kind: "add", input: read.input });
    setPending(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setForm(BLANK_FORM);
    props.onAdded(read.input.name);
  };

  const command = form.kind === "command";
  return (
    <form
      className="mt-8 flex flex-col gap-3"
      data-mcp-add
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="font-semibold text-sm leading-5">{MCP_WORDS.addTitle}</h3>
      <FieldLine error={errors.name} label={MCP_WORDS.name}>
        <Input
          autoCapitalize="off"
          autoComplete="off"
          nativeInput
          onChange={(event) => edit({ name: event.target.value }, "name")}
          placeholder="github"
          size="sm"
          spellCheck={false}
          value={form.name}
        />
      </FieldLine>
      <ToggleGroup
        aria-label={`${MCP_WORDS.command} or ${MCP_WORDS.url2}`}
        className="self-start"
        onValueChange={(next) => {
          const kind = next[0];
          if (kind === "command" || kind === "url") edit({ kind, extra: "" }, "target");
        }}
        value={[form.kind]}
        variant="segmented"
      >
        <Toggle value="command">{MCP_WORDS.command}</Toggle>
        <Toggle value="url">{MCP_WORDS.url2}</Toggle>
      </ToggleGroup>
      <FieldLine error={errors.target} label={command ? MCP_WORDS.command : MCP_WORDS.url2}>
        <Input
          autoCapitalize="off"
          autoComplete="off"
          nativeInput
          onChange={(event) =>
            edit(
              command ? { commandLine: event.target.value } : { url: event.target.value },
              "target",
            )
          }
          placeholder={command ? MCP_WORDS.commandPlaceholder : MCP_WORDS.urlPlaceholder}
          size="sm"
          spellCheck={false}
          value={command ? form.commandLine : form.url}
        />
      </FieldLine>
      <FieldLine
        error={errors.extra}
        hint={command ? MCP_WORDS.envHint : MCP_WORDS.headersHint}
        label={command ? MCP_WORDS.env : MCP_WORDS.headers}
      >
        <Textarea
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => edit({ extra: event.target.value }, "extra")}
          rows={3}
          size="sm"
          spellCheck={false}
          value={form.extra}
        />
      </FieldLine>
      <div className="flex items-center gap-3">
        <Button disabled={pending} size="sm" type="submit">
          {pending ? <Spinner size="xs" /> : null}
          {MCP_WORDS.add}
        </Button>
        {failure === null ? null : (
          <span className="text-xs text-destructive-foreground" role="alert">
            {failure}
          </span>
        )}
      </div>
    </form>
  );
}
