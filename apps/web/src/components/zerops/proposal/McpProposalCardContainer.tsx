/**
 * A Mate's proposal to connect an MCP server, carried out as the person: Add writes it for every
 * agent the Mate runs through the Mate's own `mcp.servers.add` (the MCP tab's operation), with the
 * keys the person typed on the card — they go to the Mate, never into the conversation. Then the
 * conversation's agent signs in where the server waits for it, as the MCP tab signs in. What the
 * person decided is kept at HQ by proposal id (`proposalRecord.ts`); how the server stands comes
 * from the Mate's server list, so a reload draws it as it stands. Once added from here, the Mate's
 * next message tells its agent which agents have it (`mcpTurnNotes.ts`).
 */
import { isProviderDriverKind, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { useProposalDecision } from "~/zerops/proposalRecord";
import { noteMcp } from "~/zerops/mcpTurnNotes";
import { useMcpServers } from "../../mcp/useMcpServers";
import { dockAsk, showAskInConversation, undockAsk } from "../../ask/askReveal";
import type { AskDensity } from "../../ask/AskCard";
import { ComposerAskFace } from "../../chat/ComposerAsk";
import { McpProposalCard } from "./McpProposalCard";
import {
  mcpAddInput,
  mcpAskFace,
  mcpProgress,
  mcpProposalStatus,
  mcpProposalView,
  mcpTurnNote,
  type McpProposal,
  type McpSigning,
} from "./mcpProposal.logic";
import { proposalStage, type ProposalDecision } from "./proposal.logic";

const IDLE: McpSigning = { phase: "idle" };

export interface McpProposalHomeProps {
  readonly proposal: McpProposal;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** The conversation's agent: whose state the card carries, and who signs in. */
  readonly driver: string | null;
  /** `full` where the Mate proposed it; `compact` above the composer while it waits on it. */
  readonly density?: AskDensity;
}

/** The conversation's key the card docks its ask under; `null` outside a conversation. */
const threadKeyOf = (environmentId: EnvironmentId, threadId: ThreadId | null): string | null =>
  threadId === null ? null : scopedThreadKey(scopeThreadRef(environmentId, threadId));

export function McpProposalCardContainer(props: McpProposalHomeProps) {
  const { proposal, environmentId } = props;
  const home = useZeropsEnvironmentProject(environmentId);
  const handle = useProposalDecision(proposal.id, home?.projectId, proposal.kind);
  const stage = proposalStage(handle.decision, handle.runningHere);
  const mateName = useKnownMate(environmentId)?.name ?? "Your Mate";
  const nameOf = usePersonNames(home?.orgId);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const threadKey = threadKeyOf(environmentId, props.threadId);
  const declined = stage === "declined";
  useEffect(() => {
    if (declined && threadKey !== null) undockAsk(threadKey, proposal.id);
  }, [declined, proposal.id, threadKey]);
  // A declined card asks the Mate for nothing.
  if (declined) {
    if (props.density === "compact") return null;
    const view = mcpProposalView({
      proposal,
      mateName,
      status: { kind: "declined" },
      signing: IDLE,
      approveBlocked: undefined,
      agents: [],
    });
    const decision = handle.decision;
    return (
      <McpProposalCard
        askId={proposal.id}
        face={mcpAskFace({
          view,
          status: { kind: "declined" },
          signing: IDLE,
          busy: false,
          title: proposal.params.server.title,
          signsIn: false,
          by: decision?.by === undefined ? null : (nameOf(decision.by) ?? null),
          at: decision === undefined ? null : formatDayAwareTimestamp(decision.at, timestampFormat),
        })}
        view={view}
      />
    );
  }
  return (
    <LiveMcpProposal
      {...props}
      handle={handle}
      homeKnown={home !== undefined}
      mateName={mateName}
      stage={stage}
      threadKey={threadKey}
    />
  );
}

function LiveMcpProposal(
  props: McpProposalHomeProps & {
    readonly threadKey: string | null;
    readonly handle: ReturnType<typeof useProposalDecision>;
    readonly homeKnown: boolean;
    readonly mateName: string;
    readonly stage: ReturnType<typeof proposalStage>;
  },
) {
  const { proposal, environmentId, handle, stage, mateName } = props;
  const name = proposal.params.server.name;
  const mcp = useMcpServers({ environmentId, threadId: props.threadId ?? undefined });
  const { list, error } = mcp.state;
  const status = mcpProposalStatus({
    proposal,
    stage,
    failure: handle.decision?.state === "failed" ? handle.decision.message : undefined,
    list,
    driver: isProviderDriverKind(props.driver) ? props.driver : null,
  });
  const [signing, setSigning] = useState<McpSigning>(IDLE);
  const flow = useRef<string | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // How it stands now, for the agent's next message: told only of a server added from here.
  useEffect(() => {
    if (list === null) return;
    const line = mcpTurnNote(proposal, list);
    if (line !== null) noteMcp(environmentId, { kind: "seen", name, line });
  }, [environmentId, list, name, proposal]);

  const approveBlocked = !props.homeKnown
    ? "Reading your organization…"
    : handle.unreachable
      ? "Reaching your organization's HQ…"
      : !handle.known
        ? "Reading what was decided…"
        : list === null
          ? (error ?? `Reading ${mateName}'s MCP servers…`)
          : undefined;

  const viewer = useZeropsSessionOptional()?.user?.id;
  /** A decision made here, recorded as the person's. */
  const mine = (next: ProposalDecision): ProposalDecision =>
    viewer === undefined ? next : { ...next, by: viewer };

  const decide = useCallback(
    async (next: ProposalDecision): Promise<boolean> => {
      const refused = await handle.record(next);
      if (refused !== null) setRefusal(refused);
      return refused === null;
    },
    [handle],
  );

  const add = async (values: Readonly<Record<string, string>>) => {
    if (busy || stage !== "open" || approveBlocked !== undefined) return;
    const mapped = mcpAddInput(proposal, values, list?.agents ?? []);
    if ("refused" in mapped) {
      setRefusal(mapped.refused);
      return;
    }
    setRefusal(undefined);
    setBusy(true);
    try {
      // Nothing is written before HQ kept the approval: no card anywhere offers Add twice.
      if (!(await decide(mine({ state: "running", at: new Date().toISOString() })))) return;
      noteMcp(environmentId, { kind: "added", name });
      const result = await mcp.act({ kind: "add", input: mapped.input });
      await decide(
        mine(
          result.ok
            ? { state: "done", at: new Date().toISOString() }
            : { state: "failed", at: new Date().toISOString(), message: result.message },
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    // Opened in the press itself, so no popup blocker stands in the way; pointed at the
    // provider's page once the Mate answers, with no way back to this window.
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    setRefusal(undefined);
    setSigning({ phase: "starting" });
    const result = await mcp.signIn(name);
    if (!result.ok || result.signIn.kind === "signed-in") {
      tab?.close();
      setSigning(IDLE);
      if (result.ok) mcp.refresh();
      else setRefusal(result.message);
      return;
    }
    const { url, landing } = result.signIn;
    flow.current = result.signIn.flow;
    if (tab !== null) tab.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    setSigning(
      landing === "mate" ? { phase: "mate", url } : { phase: "paste", url, finishing: false },
    );
  };

  const finish = async (landed: string) => {
    if (signing.phase !== "paste" || flow.current === null) return;
    setRefusal(undefined);
    setSigning({ ...signing, finishing: true });
    const result = await mcp.act({ kind: "finishSignIn", name, flow: flow.current, landed });
    if (result.ok) {
      flow.current = null;
      setSigning(IDLE);
    } else {
      setRefusal(result.message);
      setSigning({ ...signing, finishing: false });
    }
  };

  const view = mcpProposalView({
    proposal,
    mateName,
    status,
    signing,
    approveBlocked,
    agents: list?.agents ?? [],
  });
  const face = mcpAskFace({
    view,
    status,
    signing,
    busy,
    title: proposal.params.server.title,
    signsIn:
      proposal.params.server.auth.kind === "oauth" ||
      proposal.params.server.auth.kind === "oauth-app",
    by: null,
    at: null,
  });
  // It waits on the person while undecided, or while its agent waits for a sign-in: then it
  // stands above the composer too, once its card is out of view.
  const waits = status.kind === "proposed" || status.kind === "needs-sign-in";
  const compact = props.density === "compact";
  const { threadKey } = props;
  useEffect(() => {
    if (threadKey === null) return;
    if (!waits) {
      undockAsk(threadKey, proposal.id);
      return;
    }
    if (compact) return;
    dockAsk(threadKey, {
      askId: proposal.id,
      render: () => (
        <McpProposalCardContainer
          density="compact"
          driver={props.driver}
          environmentId={environmentId}
          proposal={proposal}
          threadId={props.threadId}
        />
      ),
    });
  }, [compact, environmentId, props.driver, props.threadId, proposal, threadKey, waits]);
  if (compact && !waits) return null;

  return (
    <McpProposalCard
      askId={proposal.id}
      density={compact ? "compact" : "full"}
      face={face}
      mateFace={compact ? <ComposerAskFace environmentId={environmentId} /> : undefined}
      onAdd={(values) => void add(values)}
      onDecline={() => void decide(mine({ state: "declined", at: new Date().toISOString() }))}
      onFinishSignIn={(landed) => void finish(landed)}
      onOpenAgain={(url) => void window.open(url, "_blank", "noopener,noreferrer")}
      onShowInConversation={
        compact
          ? () =>
              showAskInConversation({
                askId: proposal.id,
                holds: (row) =>
                  (row as { readonly operation?: { readonly proposal?: { readonly id?: string } } })
                    .operation?.proposal?.id === proposal.id,
              })
          : undefined
      }
      onSignIn={() => void signIn()}
      progress={mcpProgress(
        proposal,
        status,
        status.kind === "needs-sign-in" ? status.agent : null,
      )}
      refusal={refusal}
      signing={signing}
      view={view}
    />
  );
}
