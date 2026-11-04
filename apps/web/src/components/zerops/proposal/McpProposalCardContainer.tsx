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
import { useCallback, useEffect, useRef, useState } from "react";

import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { useProposalDecision } from "~/zerops/proposalRecord";
import { noteMcp } from "~/zerops/mcpTurnNotes";
import { useMcpServers } from "../../mcp/useMcpServers";
import { McpProposalCard } from "./McpProposalCard";
import {
  mcpAddInput,
  mcpProposalStatus,
  mcpProposalView,
  mcpTurnNote,
  type McpProposal,
  type McpSigning,
} from "./mcpProposal.logic";
import { proposalStage, type ProposalDecision } from "./proposal.logic";

const IDLE: McpSigning = { phase: "idle" };

export function McpProposalCardContainer(props: {
  readonly proposal: McpProposal;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** The conversation's agent: whose state the card carries, and who signs in. */
  readonly driver: string | null;
}) {
  const { proposal, environmentId } = props;
  const home = useZeropsEnvironmentProject(environmentId);
  const handle = useProposalDecision(proposal.id, home?.projectId, proposal.kind);
  const stage = proposalStage(handle.decision, handle.runningHere);
  const mateName = useKnownMate(environmentId)?.name ?? "Your Mate";
  // A declined card asks the Mate for nothing.
  if (stage === "declined") {
    return (
      <McpProposalCard
        view={mcpProposalView({
          proposal,
          mateName,
          status: { kind: "declined" },
          signing: IDLE,
          approveBlocked: undefined,
        })}
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
    />
  );
}

function LiveMcpProposal(props: {
  readonly proposal: McpProposal;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly driver: string | null;
  readonly handle: ReturnType<typeof useProposalDecision>;
  readonly homeKnown: boolean;
  readonly mateName: string;
  readonly stage: ReturnType<typeof proposalStage>;
}) {
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
    const mapped = mcpAddInput(proposal, values);
    if ("refused" in mapped) {
      setRefusal(mapped.refused);
      return;
    }
    setRefusal(undefined);
    setBusy(true);
    try {
      // Nothing is written before HQ kept the approval: no card anywhere offers Add twice.
      if (!(await decide({ state: "running", at: new Date().toISOString() }))) return;
      noteMcp(environmentId, { kind: "added", name });
      const result = await mcp.act({ kind: "add", input: mapped.input });
      await decide(
        result.ok
          ? { state: "done", at: new Date().toISOString() }
          : { state: "failed", at: new Date().toISOString(), message: result.message },
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

  return (
    <McpProposalCard
      busy={busy}
      onAdd={(values) => void add(values)}
      onDecline={() => void decide({ state: "declined", at: new Date().toISOString() })}
      onFinishSignIn={(landed) => void finish(landed)}
      onOpenAgain={(url) => void window.open(url, "_blank", "noopener,noreferrer")}
      onSignIn={() => void signIn()}
      refusal={refusal}
      view={mcpProposalView({ proposal, mateName, status, signing, approveBlocked })}
    />
  );
}
