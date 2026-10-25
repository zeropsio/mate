/**
 * A Mate's proposal, carried out as the person: an approved restart, start or stop is the
 * account's own operation at Zerops with their token, as is an approved domain — added onto the
 * service's port and put in place, then followed in the project's addresses; a value is the vault
 * panel's write; a message goes into the other Mate's conversation — an ask of the Chief into the person's own
 * Chief's — the way every hand-over to a Mate goes (`useAskMate`); an approved access change is the
 * account's own `set-project-access`, each person found among the organization's members, as an
 * application's People write it. What the person decided is kept
 * at HQ by proposal id (`proposalRecord.ts`), so a reload draws it as it was and no card offers
 * Approve twice; an approval is carried out only once HQ kept it.
 */
import { useTimelineRowReading } from "~/components/chat/timelineRowReads";
import {
  NOT_READ_PROJECTS,
  NOT_READ_VAULT,
  PROJECT_ROUTINGS_LISTING,
  addresses,
  vaultAtom,
  hqProjectPerson,
  initialStream,
  inventoryPlacementStatus,
  organizationMembers,
  organizationProjects,
  projectsGrants,
  accountReadsAtom,
  shownHqProjectPeopleAtom,
  type HqProjectPeople,
  type MembersRead,
  type PlaceAddresses,
  type ProjectGrantsRead,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { hqProjectsOf } from "@t3tools/client-runtime/zerops/hq";
import type { ZeropsOperation, ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { sendOutcomeOf } from "~/hooks/useComposerSendRequests";
import { newCommandId, newMessageId } from "~/lib/utils";
import { useAccountHq } from "~/zerops/accountHq";
import { useAskMate } from "~/zerops/useAskMate";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";
import { useKnownMate, useZeropsMateDirectory } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import { useProposalDecision } from "~/zerops/proposalRecord";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useVaultWriter } from "../vault/VaultPanelContainer";
import type { VaultWriteOutcome } from "../vault/VaultPanel";
import { ProposalCard } from "./ProposalCard";
import {
  chiefAsk,
  chiefMessageTarget,
  domainProposalAlso,
  domainProposalRecords,
  domainProposalState,
  envProposalWrite,
  handOverWords,
  proposalMessage,
  proposalRecipient,
  proposalStage,
  accessAskLines,
  accessProposalPlan,
  type ProposalDecision,
} from "./proposal.logic";

const UNKNOWN_PERSON = Atom.make<HqProjectPeople | undefined>(undefined);

const UNREAD = Atom.make(NOT_READ_VAULT);

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

const UNREAD_PROJECTS = Atom.make(NOT_READ_PROJECTS);

const UNREAD_GRANTS = Atom.make<Readonly<Record<string, ProjectGrantsRead>>>({});

const UNREAD_PLACEMENTS = Atom.make({ complete: false, live: false, reconnecting: false });

const UNREAD_ADDRESSES = Atom.make<PlaceAddresses>({
  state: "reading",
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
});

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
  // The conversation's own project: the organization every approval acts in, and where HQ keeps
  // what was decided of it.
  const home = useZeropsEnvironmentProject(environmentId);
  const { decision, known, runningHere, unreachable, record } = useProposalDecision(
    proposal.id,
    home?.projectId,
    proposal.kind,
  );
  const stage = proposalStage(decision, runningHere);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const person = useProjection(hqProjectPerson, home === undefined ? null : home, UNKNOWN_PERSON);
  const chief = chiefMessageTarget(person?.chief?.projectId);
  const readOnlyChief = proposal.kind === "chief.message" && person?.chief?.mine !== true;
  const readOnlyReason = readOnlyChief
    ? person?.chief === undefined
      ? "Finding this Mate's Chief…"
      : "Only this Mate's person can ask their Chief."
    : undefined;
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
  // A domain's project's addresses: what approving it puts in place besides it, then how far it
  // is from answering.
  const domainPlace = useMemo(
    () =>
      home === undefined || proposal.kind !== "domain.add" || stage === "declined"
        ? null
        : { orgId: home.orgId, projectId: proposal.projectId },
    [home, proposal, stage],
  );
  const place = useProjection(addresses, domainPlace, UNREAD_ADDRESSES);
  // Its records and their state come with the addresses: a conversation opening waits for them.
  useTimelineRowReading(domainPlace !== null && place.state === "reading");
  useDetailDemand(
    "publicRouting",
    PROJECT_ROUTINGS_LISTING,
    domainPlace !== null && place.readsProject ? domainPlace.projectId : null,
  );
  // An access change's people are found among the organization's members while its card offers it.
  const accessOrg =
    home === undefined || proposal.kind !== "access.set" || stage !== "open"
      ? null
      : { orgId: home.orgId, clientId: home.orgId };
  useDetailDemand("organizationMembers", undefined, accessOrg?.clientId ?? null);
  const members = useProjection(organizationMembers, accessOrg, UNREAD_MEMBERS);
  // The projects it may write — the organization's, never the Headquarters project — and whose
  // each Mate is, which HQ says once its placements are read: before that, nobody's is no answer.
  const roster = useProjection(organizationProjects, accessOrg?.orgId ?? null, UNREAD_PROJECTS);
  const placements = useProjection(
    inventoryPlacementStatus,
    accessOrg?.orgId ?? null,
    UNREAD_PLACEMENTS,
  );
  const { hq: officialHq } = useAccountHq(accessOrg?.clientId);
  // What each person reaches on its projects today: each project's own row, held while it is read.
  const accessProjectKey =
    accessOrg === null || proposal.kind !== "access.set"
      ? ""
      : proposal.params.projects.map(({ id }) => id).join(",");
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || accessProjectKey === "") return;
    const releases = accessProjectKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "project", listing: "project", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, accessProjectKey]);
  const grants = useProjection(
    projectsGrants,
    accessOrg === null || accessProjectKey === ""
      ? null
      : { orgId: accessOrg.orgId, projectIds: accessProjectKey.split(",") },
    UNREAD_GRANTS,
  );
  const projectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const accessPlan = useMemo(
    () =>
      proposal.kind !== "access.set"
        ? null
        : accessProposalPlan({
            proposal,
            members: { known: members.fact.kind === "known", list: members.members },
            owners: Object.fromEntries(
              proposal.params.projects.map(({ id }) => {
                const people = projectPeople[id];
                return [
                  id,
                  !placements.complete
                    ? undefined
                    : people?.owned === true
                      ? people.owner?.userId
                      : null,
                ];
              }),
            ),
            projects: roster.complete
              ? new Map(roster.projects.map(({ id, name }) => [id, name]))
              : undefined,
            hq: hqProjectsOf(officialHq),
            grants,
          }),
    [grants, members, officialHq, placements.complete, projectPeople, proposal, roster],
  );
  const askMate = useAskMate();
  const openMate = useOpenMate();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const envWrite = proposal.kind === "env.set" ? envProposalWrite(view, proposal) : null;
  const approveBlocked =
    home === undefined
      ? "Reading your organization…"
      : unreachable
        ? "Reaching your organization's HQ…"
        : !known
          ? "Reading what was decided…"
          : proposal.kind === "chief.message" && chief.kind === "unknown"
            ? "Finding this Mate's Chief…"
            : envWrite !== null && "refused" in envWrite
              ? envWrite.refused
              : proposal.kind === "domain.add" && place.state === "reading"
                ? "Reading the project's addresses…"
                : proposal.kind === "domain.add" && place.state === "failed"
                  ? `You can't see ${proposal.projectName ?? "this project"}'s addresses.`
                  : accessPlan?.kind === "held"
                    ? accessPlan.words
                    : undefined;

  const ended = useCallback(
    (outcome: VaultWriteOutcome) =>
      void record(
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

  /**
   * Hands words to a Mate's conversation, sent at once (`useAskMate`): it ended once that
   * conversation's composer said whether they went out, or wait there because its agent takes no
   * turn now.
   */
  const handOver = async (
    projectId: string,
    words: string,
    recipient: string,
  ): Promise<VaultWriteOutcome> => {
    const ids = { commandId: newCommandId(), messageId: newMessageId() };
    const went = sendOutcomeOf(ids.messageId);
    askMate(projectId, words, { send: true, ids });
    const notSent = handOverWords(recipient, await went);
    return notSent === null ? { ok: true } : { ok: false, code: null, message: notSent };
  };

  /** Records the person's decision at HQ: false, saying why, where HQ did not keep it. */
  const decide = async (next: ProposalDecision): Promise<boolean> => {
    setRefusal(undefined);
    const refused = await record(next);
    if (refused !== null) setRefusal(refused);
    return refused === null;
  };

  const approve = async () => {
    if (
      readOnlyChief ||
      (proposal.kind === "chief.message" && chief.kind !== "chief") ||
      busy ||
      stage !== "open" ||
      home === undefined ||
      approveBlocked !== undefined
    )
      return;
    setBusy(true);
    try {
      // Nothing runs before HQ kept the approval: no card anywhere offers it twice.
      if (!(await decide({ state: "running", at: new Date().toISOString() }))) return;
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
          ended(
            await handOver(
              proposal.params.to.projectId,
              proposalMessage(proposal.params),
              proposal.params.to.mateName,
            ),
          );
          return;
        case "domain.add":
          ended(
            await run({
              kind: "add-domain",
              orgId: home.orgId,
              projectId: proposal.projectId,
              domains: proposal.params.domains,
              serviceId: proposal.serviceId,
              port: proposal.params.port,
            }),
          );
          return;
        case "access.set":
          if (accessPlan?.kind !== "ready") {
            ended({ ok: false, code: null, message: "Nobody to give access to." });
            return;
          }
          ended(
            await run({
              kind: "set-project-access",
              orgId: home.orgId,
              changes: accessPlan.changes,
            }),
          );
          return;
        case "chief.message":
          if (chief.kind !== "chief") {
            ended({ ok: false, code: null, message: "You have no Chief to ask." });
            return;
          }
          ended(
            await handOver(
              chief.projectId,
              chiefAsk(proposal.params, {
                mateName: proposer?.name ?? "Your Mate",
                projectName: proposal.projectName ?? "its project",
              }),
              "your Chief",
            ),
          );
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
      domainAlso={proposal.kind === "domain.add" ? domainProposalAlso(place) : undefined}
      domainState={
        proposal.kind === "domain.add" ? domainProposalState(place, proposal) : undefined
      }
      domainRecords={
        proposal.kind === "domain.add" ? domainProposalRecords(place, proposal) : undefined
      }
      onOpenAddresses={
        proposal.kind === "domain.add" && domainPlace !== null
          ? () => useAddressesSheet.getState().open(domainPlace)
          : undefined
      }
      access={
        proposal.kind !== "access.set"
          ? undefined
          : accessPlan?.kind === "ready"
            ? { lines: accessPlan.lines, dropped: accessPlan.dropped }
            : { lines: accessAskLines(proposal), dropped: [] }
      }
      chiefTarget={proposal.kind === "chief.message" ? chief : undefined}
      readOnlyReason={readOnlyReason}
      failure={decision?.state === "failed" ? decision.message : undefined}
      mateName={proposer?.name ?? "Your Mate"}
      onApprove={() => void approve()}
      onDecline={() => void decide({ state: "declined", at: new Date().toISOString() })}
      onOpenRecipient={
        proposal.kind === "mate.message"
          ? () => openMate({ projectId: proposal.params.to.projectId })
          : proposal.kind === "chief.message" && chief.kind === "chief"
            ? () => openMate({ projectId: chief.projectId })
            : undefined
      }
      onSetUpChief={
        proposal.kind === "chief.message" && chief.kind === "none" && !readOnlyChief
          ? () => void navigate({ to: "/chief" })
          : undefined
      }
      proposal={proposal}
      recipient={recipient}
      refusal={refusal}
      stage={stage}
    />
  );
}
