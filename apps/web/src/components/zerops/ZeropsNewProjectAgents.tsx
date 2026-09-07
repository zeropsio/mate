/**
 * "New project" step 3: pick which coding agents the container comes up
 * with. Purely presentational — the wizard step around it owns the
 * provisioning call and turns the selection into the
 * `ZCP_AGENT_AUTH_TYPE_<SUFFIX>` secrets `buildZcpServiceImportYaml` stages.
 *
 * A row installs nothing: `zcp init` only configures agent binaries the `zcp@1`
 * image already carries (its adapters gate on `LookPath`). What the selection
 * decides is which agents the container OFFERS — it becomes `ZCP_AGENTS`, the
 * presentation policy the container's bootstrap reads. Picking none is not the
 * same as picking all: the import omits the key entirely, and an absent key is
 * what means "offer everything".
 *
 * Of the offered agents, only those in `ZeropsAgentId` can be authorized from
 * inside Zerops Mate; the rest are a normal, supported choice, signed into from
 * the container's terminal instead.
 */

import type { ZeropsAgentId } from "@t3tools/contracts";
import { ZeropsAgentId as ZeropsAgentIdSchema } from "@t3tools/contracts";
import {
  ZEROPS_AGENT_TYPE_CANONICAL_ORDER,
  type ZeropsAgentType,
} from "@t3tools/client-runtime/zerops";
import { CheckIcon } from "lucide-react";

import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  OpenAI,
  type Icon,
} from "~/components/Icons";
import { cn } from "~/lib/utils";
import { MicroLabel } from "./primitives";

/** Alone, in the wizard's initial state — the platform's own default. */
export const ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION: ReadonlyArray<ZeropsAgentType> = [
  "claude-code",
];

const AGENT_NAMES: Record<ZeropsAgentType, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  grok: "Grok",
  cursor: "Cursor",
};

const AGENT_LOGOS: Record<ZeropsAgentType, Icon> = {
  "claude-code": ClaudeAI,
  codex: OpenAI,
  antigravity: AntigravityIcon,
  grok: GrokIcon,
  cursor: CursorIcon,
};

/** The two agents `ZeropsAgentId` covers — never a second hardcoded list. */
const MATE_AUTHORIZABLE_AGENTS: ReadonlySet<ZeropsAgentType> = new Set(
  ZeropsAgentIdSchema.literals as ReadonlyArray<ZeropsAgentId>,
);

function toggle(
  selected: ReadonlyArray<ZeropsAgentType>,
  agentType: ZeropsAgentType,
): ReadonlyArray<ZeropsAgentType> {
  return selected.includes(agentType)
    ? selected.filter((candidate) => candidate !== agentType)
    : [...selected, agentType];
}

function AgentRow({
  agentType,
  isSelected,
  disabled,
  onToggle,
}: {
  readonly agentType: ZeropsAgentType;
  readonly isSelected: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const Logo = AGENT_LOGOS[agentType];
  const authorizableInMate = MATE_AUTHORIZABLE_AGENTS.has(agentType);

  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-[var(--zerops-card-radius)] border px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64",
        isSelected ? "border-primary bg-primary/5" : "border-border/60 bg-background",
      )}
      data-zerops-agent-row={agentType}
      data-zerops-agent-selected={isSelected}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background shadow-xs"
      >
        <Logo className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{AGENT_NAMES[agentType]}</span>
        {authorizableInMate ? null : (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            Sign in from the container&apos;s terminal.
          </span>
        )}
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border/60",
        )}
      >
        {isSelected ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
      </span>
    </button>
  );
}

export function ZeropsNewProjectAgents({
  selected,
  onChange,
  disabled = false,
}: {
  readonly selected: ReadonlyArray<ZeropsAgentType>;
  readonly onChange: (next: ReadonlyArray<ZeropsAgentType>) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="space-y-3" data-zerops-new-project-agents>
      <MicroLabel className="text-muted-foreground">Coding agents</MicroLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ZEROPS_AGENT_TYPE_CANONICAL_ORDER.map((agentType) => (
          <AgentRow
            key={agentType}
            agentType={agentType}
            disabled={disabled}
            isSelected={selected.includes(agentType)}
            onToggle={() => {
              onChange(toggle(selected, agentType));
            }}
          />
        ))}
      </div>
    </div>
  );
}
