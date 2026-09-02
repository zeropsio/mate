import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ZeropsAgentAuth, ZeropsAgentId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, ExternalLinkIcon, TerminalSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ClaudeAI, OpenAI } from "~/components/Icons";
import { TerminalViewport } from "~/components/ThreadTerminalDrawer";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { ProcessSteps } from "./primitives";
import {
  resolveAgentAuthorizationDialog,
  ZEROPS_AGENT_NAMES,
} from "./ZeropsAgentAuthorizationDialog.logic";

const AGENT_LOGIN_CWD = "/var/www";
const COPY_FEEDBACK_DURATION_MS = 2_000;
const NOOP = () => {};

interface ZeropsAgentAuthorizationDialogSurfaceProps {
  readonly agent: ZeropsAgentAuth;
  readonly projectName?: string | null | undefined;
  readonly terminal: ReactNode;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly onClose: () => void;
  readonly onStart: (agentId: ZeropsAgentId) => void;
}

export function ZeropsAgentAuthorizationDialogSurface({
  agent,
  projectName,
  terminal,
  onCancel,
  onClose,
  onStart,
}: ZeropsAgentAuthorizationDialogSurfaceProps) {
  const view = resolveAgentAuthorizationDialog(agent);
  const login = agent.login;

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1.2fr)_minmax(220px,0.8fr)] lg:grid-cols-[minmax(340px,0.36fr)_minmax(0,0.64fr)] lg:grid-rows-1"
      data-agent-id={agent.agentId}
      data-agent-login-phase={login?.phase ?? "idle"}
      data-zerops-agent-authorization-dialog
    >
      <section className="flex min-h-0 flex-col border-b border-border/70 bg-card lg:border-b-0 lg:border-r">
        <header className="shrink-0 border-b border-border/60 px-5 py-5 pr-12">
          <h2 className="text-lg font-semibold leading-snug text-foreground">
            Authorize {view.agentName}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Inside</span>
            {projectName ? <ContextChip>{projectName}</ContextChip> : null}
            {projectName ? <span>/</span> : null}
            <ContextChip>zcp</ContextChip>
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <AgentIdentity agentId={agent.agentId} name={view.agentName} />
          <ProcessSteps aria-label="Authorization progress" className="mt-6" steps={view.steps} />

          <div aria-live="polite" className="mt-6 space-y-3">
            <p
              className={
                login?.phase === "failed"
                  ? "text-sm leading-6 text-[var(--zerops-status-failed-text,var(--foreground))]"
                  : "text-sm leading-6 text-muted-foreground"
              }
            >
              {view.description}
            </p>
            {login?.phase === "awaiting-browser" ? (
              <BrowserAuthorizationCard agent={agent} />
            ) : null}
          </div>
        </div>

        <AuthorizationFooter
          agent={agent}
          action={view.action}
          onCancel={onCancel}
          onClose={onClose}
          onStart={onStart}
        />
      </section>

      <section
        aria-label={`${view.agentName} authorization terminal`}
        className="relative min-h-0 overflow-hidden bg-[var(--zerops-auth-terminal-surface)] text-[var(--zerops-auth-terminal-text)] [--terminal-background:var(--zerops-auth-terminal-surface)] [--terminal-cursor:var(--zerops-auth-terminal-text)] [--terminal-foreground:var(--zerops-auth-terminal-text)] [--terminal-selection-background:color-mix(in_srgb,var(--zerops-auth-terminal-text)_24%,transparent)]"
        data-zerops-agent-authorization-terminal
      >
        <div className="flex h-9 items-center gap-2 border-b border-[var(--zerops-auth-terminal-border)] bg-[var(--zerops-auth-terminal-header)] px-3 text-xs text-[var(--zerops-auth-terminal-muted)]">
          <TerminalSquareIcon className="size-3.5" />
          <span>{view.agentName} authorization terminal</span>
        </div>
        <div className="h-[calc(100%-2.25rem)]">{terminal}</div>
      </section>
    </div>
  );
}

export function ZeropsAgentAuthorizationDialog({
  agent,
  open,
  projectName,
  threadRef,
  onCancel,
  onOpenChange,
  onStart,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly open: boolean;
  readonly projectName?: string | null | undefined;
  readonly threadRef: ScopedThreadRef | null;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStart: (agentId: ZeropsAgentId) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        aria-label={`Authorize ${ZEROPS_AGENT_NAMES[agent.agentId]}`}
        bottomStickOnMobile={false}
        className="h-[min(1080px,calc(100dvh-3rem))] max-w-[min(1720px,calc(100vw-3rem))] overflow-hidden p-0"
      >
        <ZeropsAgentAuthorizationDialogSurface
          agent={agent}
          projectName={projectName}
          terminal={<AgentAuthorizationTerminal agent={agent} threadRef={threadRef} />}
          onCancel={onCancel}
          onClose={() => {
            onOpenChange(false);
          }}
          onStart={onStart}
        />
      </DialogPopup>
    </Dialog>
  );
}

function ContextChip({ children }: { readonly children: ReactNode }) {
  return (
    <span className="max-w-44 truncate rounded-md bg-[var(--zerops-mint-surface)] px-1.5 py-0.5 font-medium text-foreground">
      {children}
    </span>
  );
}

function AgentIdentity({
  agentId,
  name,
}: {
  readonly agentId: ZeropsAgentId;
  readonly name: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background shadow-xs"
      >
        {agentId === "claude-code" ? (
          <ClaudeAI className="size-6" />
        ) : (
          <OpenAI className="size-6" />
        )}
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">Secure provider login</p>
      </div>
    </div>
  );
}

function BrowserAuthorizationCard({ agent }: { readonly agent: ZeropsAgentAuth }) {
  const login = agent.login;
  if (login?.phase !== "awaiting-browser") return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-[var(--zerops-status-attention-surface)] p-3.5">
      {agent.agentId === "codex" && login.code !== undefined ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2.5">
          <div className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Device code
            </span>
            <code className="mt-0.5 block select-all break-all font-mono text-base font-semibold tracking-wide text-foreground">
              {login.code}
            </code>
          </div>
          <CopyButton label="Copy code" value={login.code} />
        </div>
      ) : null}

      {login.url !== undefined ? (
        <div className="space-y-2">
          <code className="block max-h-14 select-all overflow-hidden break-all font-mono text-[11px] leading-4 text-muted-foreground">
            {login.url}
          </code>
          <CopyButton label="Copy link" value={login.url} />
        </div>
      ) : null}

      <p className="text-center text-[11px] italic text-muted-foreground">
        Waiting for browser confirmation…
      </p>
    </div>
  );
}

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      className="shrink-0"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => {
              setCopied(false);
            }, COPY_FEEDBACK_DURATION_MS);
          })
          .catch(NOOP);
      }}
      size="compact"
      variant="outline"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function AuthorizationFooter({
  action,
  agent,
  onCancel,
  onClose,
  onStart,
}: {
  readonly action: ReturnType<typeof resolveAgentAuthorizationDialog>["action"];
  readonly agent: ZeropsAgentAuth;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly onClose: () => void;
  readonly onStart: (agentId: ZeropsAgentId) => void;
}) {
  const url = agent.login?.url;

  return (
    <footer className="shrink-0 space-y-2 border-t border-border/60 px-5 py-4">
      {action === "start" || action === "retry" ? (
        <Button
          className="w-full"
          data-zerops-agent-authorization-primary
          onClick={() => {
            onStart(agent.agentId);
          }}
          size="lg"
          variant="pill"
        >
          {action === "retry" ? "Retry Authorization" : "Start Authorization"}
        </Button>
      ) : null}

      {action === "open-browser" && url !== undefined ? (
        <Button
          className="w-full"
          data-zerops-agent-authorization-primary
          render={<a href={url} rel="noopener noreferrer" target="_blank" />}
          size="lg"
          variant="pill"
        >
          <ExternalLinkIcon />
          Open authorization page
        </Button>
      ) : null}

      {action === "close" ? (
        <Button
          className="w-full"
          data-zerops-agent-authorization-primary
          onClick={onClose}
          size="lg"
          variant="pill"
        >
          Done
        </Button>
      ) : null}

      {action === "cancel" || action === "open-browser" || action === "paste-code" ? (
        <Button
          className="w-full"
          onClick={() => {
            onCancel(agent.agentId);
          }}
          size="default"
          variant="ghost"
        >
          Cancel
        </Button>
      ) : null}

      {action === "start" || action === "retry" ? (
        <Button className="w-full" onClick={onClose} size="default" variant="ghost">
          Dismiss
        </Button>
      ) : null}
    </footer>
  );
}

function AgentAuthorizationTerminal({
  agent,
  threadRef,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const login = agent.login;

  if (threadRef === null || login === undefined) {
    return (
      <div className="flex h-full flex-col justify-between p-5 font-mono text-xs leading-5 text-[var(--zerops-auth-terminal-muted)]">
        <div>
          <p className="text-[var(--zerops-auth-terminal-text)]">
            Zerops Mate authorization terminal
          </p>
          <p className="mt-2 max-w-md">
            The dedicated terminal session will appear here after authorization starts.
          </p>
        </div>
        <span className="text-[var(--zerops-auth-terminal-faint)]">zcp:/var/www $</span>
      </div>
    );
  }

  return (
    <TerminalViewport
      advancedTypography={false}
      autoFocus={login.phase === "awaiting-code"}
      cwd={AGENT_LOGIN_CWD}
      drawerHeight={640}
      focusRequestId={0}
      key={login.terminalId}
      keybindings={keybindings}
      onAddTerminalContext={NOOP}
      onSessionExited={NOOP}
      resizeEpoch={0}
      terminalId={login.terminalId}
      terminalLabel={`${ZEROPS_AGENT_NAMES[agent.agentId]} authorization`}
      threadId={threadRef.threadId}
      threadRef={threadRef}
    />
  );
}
