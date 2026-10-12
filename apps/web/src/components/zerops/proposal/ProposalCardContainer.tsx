/**
 * A proposal of the organization's Mate, carried out as the person: an approved restart, start or
 * stop is the account's own operation at Zerops with their token; a value is the vault panel's
 * write; a message goes into the other Mate's conversation the way every hand-over to a Mate goes
 * (`useAskMate`). What the person decided is kept by proposal id (`proposalDecisions.ts`), so a
 * reload draws it as it was and no card offers Approve twice.
 */
import { NOT_READ_VAULT, vaultAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsOperation, ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";

import { useAskMate } from "~/zerops/useAskMate";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useKnownMate, useZeropsMateDirectory } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import { useProposalDecision } from "~/zerops/proposalDecisions";
import { useVaultWriter } from "../vault/VaultPanelContainer";
import type { VaultWriteOutcome } from "../vault/VaultPanel";
import { ProposalCard } from "./ProposalCard";
import {
  envProposalWrite,
  proposalMessage,
  proposalRecipient,
  proposalStage,
} from "./proposal.logic";

const UNREAD = Atom.make(NOT_READ_VAULT);

const SERVICE_OPERATION = {
  "service.restart": "service-restart",
  "service.start": "start-service",
  "service.stop": "stop-service",
} as const;

/** The card for an operation that proposes; nothing for any other. */
export function ProposalCardContainer({
  operation,
  environmentId,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
}) {
  const proposal = operation.proposal;
  if (proposal === undefined || environmentId === null) return null;
  return <Proposal environmentId={environmentId} proposal={proposal} />;
}

function Proposal({
  proposal,
  environmentId,
}: {
  readonly proposal: ZeropsProposal;
  readonly environmentId: EnvironmentId;
}) {
  const { decision, runningHere, record } = useProposalDecision(proposal.id);
  const stage = proposalStage(decision, runningHere);
  // The organization's Mate's own project names the organization every approval acts in.
  const home = useZeropsEnvironmentProject(environmentId);
  const proposer = useKnownMate(environmentId);
  const directory = useZeropsMateDirectory();
  const recipient = useMemo(
    () =>
      proposal.kind === "mate.message"
        ? proposalRecipient(directory.values(), proposal.params.to)
        : undefined,
    [directory, proposal],
  );
  // A value's vault is read while the card offers to write it, and while the write waits to show.
  const vaultProjectId =
    proposal.kind === "env.set" && (stage === "open" || stage === "running")
      ? proposal.projectId
      : null;
  useDetailDemand("projectVariables", undefined, vaultProjectId);
  useDetailDemand("serviceVariable", undefined, vaultProjectId);
  useDetailDemand("process", "history", vaultProjectId);
  const view = useAtomValue(proposal.kind === "env.set" ? vaultAtom(proposal.projectId) : UNREAD);
  const vaultProject = useMemo(
    () =>
      home === undefined || proposal.kind !== "env.set"
        ? undefined
        : { orgId: home.orgId, projectId: proposal.projectId },
    [home, proposal],
  );
  const { run, write } = useVaultWriter(vaultProject, view);
  const askMate = useAskMate();
  const openMate = useOpenMate();
  const [busy, setBusy] = useState(false);

  const envWrite = proposal.kind === "env.set" ? envProposalWrite(view, proposal) : null;
  const approveBlocked =
    home === undefined
      ? "Reading your organization…"
      : envWrite !== null && "refused" in envWrite
        ? envWrite.refused
        : undefined;

  const ended = useCallback(
    (outcome: VaultWriteOutcome) =>
      record(
        outcome.ok
          ? { state: "done", at: new Date().toISOString() }
          : {
              state: "failed",
              at: new Date().toISOString(),
              message: outcome.message ?? "Zerops did not do it.",
            },
      ),
    [record],
  );

  const approve = async () => {
    if (busy || stage !== "open" || home === undefined) return;
    setBusy(true);
    record({ state: "running", at: new Date().toISOString() });
    try {
      switch (proposal.kind) {
        case "service.restart":
        case "service.start":
        case "service.stop":
          ended(
            await run({
              kind: SERVICE_OPERATION[proposal.kind],
              orgId: home.orgId,
              projectId: proposal.projectId,
              serviceId: proposal.serviceId,
            }),
          );
          return;
        case "env.set": {
          if (envWrite === null || "refused" in envWrite) {
            ended({ ok: false, code: null, message: envWrite?.refused ?? "Nothing to write." });
            return;
          }
          const { outcome, change } = await write(envWrite.scope, envWrite.write);
          // The project's own Mate hears of it with its next message, as of a write in its panel.
          if (change !== null) recordVaultWrite(proposal.projectId, change);
          ended(outcome);
          return;
        }
        case "mate.message":
          askMate(proposal.params.to.projectId, proposalMessage(proposal.params), { send: true });
          ended({ ok: true });
          return;
      }
    } catch (cause) {
      ended({
        ok: false,
        code: null,
        message: cause instanceof Error ? cause.message : "It could not be carried out.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProposalCard
      approveBlocked={approveBlocked}
      failure={decision?.state === "failed" ? decision.message : undefined}
      mateName={proposer?.name ?? "Your Mate"}
      onApprove={() => void approve()}
      onDecline={() => record({ state: "declined", at: new Date().toISOString() })}
      onOpenRecipient={
        proposal.kind === "mate.message"
          ? () => openMate({ projectId: proposal.params.to.projectId })
          : undefined
      }
      proposal={proposal}
      recipient={recipient}
      stage={stage}
    />
  );
}
