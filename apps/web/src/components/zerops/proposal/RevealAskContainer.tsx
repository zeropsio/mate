/**
 * A reveal, carried out as the person: the value is found in its project's vault (read only once
 * they press) and read through the vault's own reveal with their access — Zerops' confirmation in
 * its window where it asks for one. HQ records that they revealed it (who, which key, when) before
 * it is shown; one HQ did not keep is not shown. Shown, the value lives in this component's memory
 * only, until it hides: never the store, browser storage, the conversation or the Mate, which is
 * told nothing. The first reveal is the proposal's approval in HQ's decision record, so a reload
 * and every device say to whom it was revealed and when.
 */
import {
  NOT_READ_VAULT,
  accountReadsAtom,
  initialStream,
  REVEAL_UNRECORDABLE,
  OperationStopped,
  organizationMembers,
  projectOperator,
  projectsGrants,
  vaultAtom,
  type MembersRead,
  type ProjectGrantsRead,
} from "@t3tools/client-runtime/data";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useEnvironmentTier } from "~/zerops/environmentTier";
import { useProposalDecision } from "~/zerops/proposalRecord";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useAccountDataOptional, useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { SUDO_REFUSAL, revealRefusalWords } from "../vault/vaultGroups.logic";
import { VaultStepUp } from "../vault/VaultStepUp";
import { RevealAskCard } from "./RevealAskCard";
import {
  isRoleRefusal,
  revealAskState,
  revealersOf,
  revealRecordOf,
  revealRule,
  revealTarget,
  type RevealAuthority,
  type RevealPhase,
} from "./reveal.logic";

const UNREAD_VAULT = Atom.make(NOT_READ_VAULT);
const UNDECIDED = Atom.make<boolean | undefined>(undefined);
const UNREAD_GRANTS = Atom.make<Readonly<Record<string, ProjectGrantsRead>>>({});
const UNREAD_MEMBERS = Atom.make<MembersRead>({
  fact: { kind: "unknown" },
  coverage: "unknown",
  stream: initialStream({ parent: null, mode: "sampled" }),
  link: null,
  members: [],
  status: "loading",
  settled: false,
  refused: false,
});

/** What the card says where HQ did not keep the record: nothing is shown without it. */
const NOT_RECORDED = "HQ couldn't record the reveal, so it stays hidden. Try again.";

export function RevealAsk({
  proposal,
  environmentId,
}: {
  readonly proposal: Extract<ZeropsProposal, { kind: "env.reveal" }>;
  readonly environmentId: EnvironmentId;
}) {
  // The conversation's own project: the organization it reveals in, and where HQ keeps the record.
  const home = useZeropsEnvironmentProject(environmentId);
  const { decision, known, unreachable, record } = useProposalDecision(
    proposal.id,
    home?.projectId,
    proposal.kind,
  );
  const tier = useEnvironmentTier(proposal.projectId);
  const nameOf = usePersonNames(home?.orgId);
  const viewer = useZeropsSessionOptional()?.user?.id;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const proposer = useKnownMate(environmentId);
  const reveal = useAccountDataOptional()?.reveal;
  const operations = useAccountOperationsOptional();

  const [phase, setPhase] = useState<RevealPhase>({ kind: "idle" });
  const [value, setValue] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // The project's vault is read once the person presses, and released once the value is out.
  const reading = phase.kind === "revealing" ? proposal.projectId : null;
  useDetailDemand("projectVariables", undefined, reading);
  useDetailDemand("serviceVariable", undefined, reading);
  const view = useAtomValue(reading === null ? UNREAD_VAULT : vaultAtom(reading));

  // Whether the viewer works in this project, from their own Zerops evidence.
  const target = useMemo(
    () => (home === undefined ? null : { orgId: home.orgId, projectId: proposal.projectId }),
    [home, proposal.projectId],
  );
  const operates = useProjection(projectOperator, target, UNDECIDED);
  // Someone else's to reveal: the viewer cannot work there, or Zerops refused their role.
  const others =
    target !== null && (operates === false || phase.kind === "refused") ? target : null;
  useDetailDemand("organizationMembers", undefined, others?.orgId ?? null);
  const members = useProjection(
    organizationMembers,
    others === null ? null : { orgId: others.orgId, clientId: others.orgId },
    UNREAD_MEMBERS,
  );
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || others === null) return;
    return demandDetail({ family: "project", listing: "project", ownerId: others.projectId });
  }, [demandDetail, others]);
  const grants = useProjection(
    projectsGrants,
    others === null ? null : { orgId: others.orgId, projectIds: [others.projectId] },
    UNREAD_GRANTS,
  );
  const authority = useMemo<RevealAuthority>(
    () =>
      others === null
        ? { kind: "may" }
        : {
            kind: "others",
            rule: revealRule(proposal, tier),
            names: revealersOf(members.members, grants[others.projectId], viewer),
          },
    [grants, members.members, others, proposal, tier, viewer],
  );

  const blocked =
    home === undefined || reveal === undefined
      ? "Reading your organization…"
      : unreachable || operations === null
        ? "Reaching your organization's HQ…"
        : !known
          ? "Reading what was decided…"
          : operates === undefined
            ? "Reading your project access…"
            : undefined;

  // Once the vault answered: the value revealed with the person's access, recorded, then shown.
  const going = useRef(false);
  useEffect(() => {
    if (phase.kind !== "revealing" || going.current) return;
    if (home === undefined || reveal === undefined || operations === null) return;
    const found = revealTarget(view, proposal);
    if (found.kind === "reading") return;
    if (found.kind === "missing") {
      setPhase({ kind: "failed", words: found.words });
      return;
    }
    going.current = true;
    const firstReveal = decision === undefined;
    void (async () => {
      let shown = found.plain;
      if (shown === null) {
        const answer = await reveal.reveal(found.scope, found.id);
        if (!answer.ok) {
          setPhase(
            answer.code === SUDO_REFUSAL
              ? { kind: "confirming" }
              : isRoleRefusal(answer.code)
                ? { kind: "refused", words: revealRefusalWords(answer.code) }
                : { kind: "failed", words: revealRefusalWords(answer.code) },
          );
          return;
        }
        shown = answer.value;
      }
      try {
        await operations.run(
          { kind: "record-reveal", orgId: home.orgId, reveal: revealRecordOf(proposal) },
          { orgId: home.orgId, unobserved: HQ_UNFOLLOWED },
        );
      } catch (error) {
        setPhase(
          error instanceof OperationStopped && error.code === REVEAL_UNRECORDABLE
            ? { kind: "stuck", words: error.message }
            : { kind: "failed", words: NOT_RECORDED },
        );
        return;
      }
      // The first reveal is the proposal's approval: a reload says to whom and when.
      if (firstReveal) {
        void record({
          state: "running",
          at: new Date().toISOString(),
          ...(viewer === undefined ? {} : { by: viewer }),
        });
      }
      setValue(shown);
      setPhase({ kind: "shown" });
    })().finally(() => {
      going.current = false;
    });
  }, [decision, home, operations, phase.kind, proposal, record, reveal, view, viewer]);

  const hide = () => {
    setValue(null);
    setPhase({ kind: "idle" });
  };
  const state = revealAskState({
    phase,
    decision,
    by: decision?.by === undefined ? null : (nameOf(decision.by) ?? null),
    at: decision === undefined ? null : formatDayAwareTimestamp(decision.at, timestampFormat),
    authority,
  });
  return (
    <RevealAskCard
      blocked={blocked}
      confirm={
        <VaultStepUp
          onConfirmed={() => {
            setPhase({ kind: "revealing" });
          }}
        />
      }
      homeProjectId={home?.projectId ?? null}
      mateName={proposer?.name ?? "Your Mate"}
      mayReveal={authority.kind === "may"}
      mayRetry={phase.kind !== "stuck"}
      onHide={hide}
      onNotNow={() => {
        setRefusal(undefined);
        void record({
          state: "declined",
          at: new Date().toISOString(),
          ...(viewer === undefined ? {} : { by: viewer }),
        }).then((refused) => {
          if (refused !== null) setRefusal(refused);
        });
      }}
      onReveal={() => {
        if (blocked !== undefined || phase.kind === "revealing" || authority.kind !== "may") return;
        setRefusal(undefined);
        setPhase({ kind: "revealing" });
      }}
      proposal={proposal}
      refusal={refusal}
      state={state}
      tier={tier}
      value={value}
    />
  );
}
