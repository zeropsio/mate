/**
 * A Mate's proposal, carried out as the person: an approved restart, start or stop is the
 * account's own operation at Zerops with their token, as is an approved domain — added onto the
 * service's port and put in place, then followed in the project's addresses; a value is the vault
 * panel's write; a message goes into the other Mate's conversation — an ask of the Chief into the person's own
 * Chief's — the way every hand-over to a Mate goes (`useAskMate`); an approved access change is the
 * account's own `set-project-access`, each person found among the organization's members, as an
 * application's People write it. What the person decided is kept
 * at HQ by proposal id (`proposalRecord.ts`), so a reload draws it as it was and no card offers
 * Approve twice; an approval is carried out only once HQ kept it. A reveal is its own card
 * (`RevealAskContainer`), as are the two asks about production (`ProductionAskContainers`).
 */
import { useTimelineRowReading, useTimelineRowSettling } from "~/components/chat/timelineRowReads";
import {
  NOT_READ_PROJECTS,
  NOT_READ_VAULT,
  PROJECT_ROUTINGS_LISTING,
  addresses,
  vaultAtom,
  vaultRestarts,
  type VaultChange,
  type VaultRestarts,
  hqProjectPerson,
  projectOperator,
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
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ZeropsOperation, ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";

import { sendOutcomeOf } from "~/hooks/useComposerSendRequests";
import { newCommandId, newMessageId } from "~/lib/utils";
import { useAskMate } from "~/zerops/useAskMate";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";
import { useKnownMate, useZeropsMateDirectory } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import { useProposalDecision, type ProposalDecision } from "~/zerops/proposalRecord";
import { useEnvironmentTier } from "~/zerops/environmentTier";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useVaultWriter } from "../vault/VaultPanelContainer";
import type { VaultWriteOutcome } from "../vault/VaultPanel";
import {
  notRestartedWords,
  restartInTurn,
  restartLane,
  useRestartLanes,
  restartedWords,
  restartingWords,
  unrestartedWords,
  type RestartsEnded,
} from "../vault/readerRestarts";
import { McpProposalCardContainer } from "./McpProposalCardContainer";
import { ReleaseOfferAsk, ServiceCreateAsk } from "./ProductionAskContainers";
import { ProposalCard, type ProposalCardProps } from "./ProposalCard";
import { RevealAsk } from "./RevealAskContainer";
import {
  chiefAsk,
  chiefMessageTarget,
  domainProposalRecords,
  domainProposalState,
  envProposalWrite,
  handOverWords,
  proposalMessage,
  proposalRecipient,
  proposalStage,
  accessAskLines,
  accessPlanReading,
  accessProposalPlan,
  approveAuthority,
} from "./proposal.logic";

const UNKNOWN_PERSON = Atom.make<HqProjectPeople | undefined>(undefined);
const UNDECIDED = Atom.make<boolean | undefined>(undefined);

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

type PlacementsRead = ReturnType<typeof inventoryPlacementStatus.derive>;

const UNREAD_PLACEMENTS = Atom.make<PlacementsRead>({
  complete: false,
  live: false,
  reconnecting: false,
});

/** A scope's read can still answer: neither lost nor refused. */
const scopeAnswers = (scope: Pick<PlacementsRead, "downSince" | "unavailableReason">) =>
  scope.downSince === undefined && scope.unavailableReason === undefined;

const UNREAD_ADDRESSES = Atom.make<PlaceAddresses>({
  state: "reading",
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  readsProject: false,
  nothingDeployed: false,
});

const SERVICE_OPERATION = {
  "service.restart": "service-restart",
  "service.start": "start-service",
  "service.stop": "stop-service",
} as const;

/**
 * The newest release ask of the conversation the cards stand in, by its proposal id: an earlier
 * one says another took its place. `null` where the conversation holds none, or outside one.
 */
export const NewestReleaseAskContext = createContext<string | null>(null);

/** The card for an operation that proposes; nothing for any other. */
export function ProposalCardContainer({
  operation,
  environmentId,
  threadId = null,
  driver = null,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  /** The conversation the card is in: whose agent an MCP server's sign-in is. */
  readonly threadId?: ThreadId | null;
  readonly driver?: string | null;
}) {
  const proposal = operation.proposal;
  const newestReleaseAsk = use(NewestReleaseAskContext);
  if (proposal === undefined || environmentId === null) return null;
  if (proposal.kind === "mcp.add") {
    return (
      <McpProposalCardContainer
        driver={driver}
        environmentId={environmentId}
        proposal={proposal}
        threadId={threadId}
      />
    );
  }
  // A reveal approves nothing to run: the person sees a value, on their screen only.
  if (proposal.kind === "env.reveal")
    return <RevealAsk environmentId={environmentId} proposal={proposal} />;
  // What production lacks is created from HQ's plan, and followed to its end.
  if (proposal.kind === "service.create")
    return <ServiceCreateAsk environmentId={environmentId} proposal={proposal} />;
  // A release is never made from the card: it opens the review.
  if (proposal.kind === "release.offer")
    return (
      <ReleaseOfferAsk
        askedAt={operation.anchorAt}
        environmentId={environmentId}
        newerAsk={newestReleaseAsk !== null && newestReleaseAsk !== proposal.id}
        proposal={proposal}
      />
    );
  return <Proposal environmentId={environmentId} proposal={proposal} />;
}

function Proposal({
  proposal,
  environmentId,
}: {
  readonly proposal: Exclude<
    ZeropsProposal,
    { readonly kind: "mcp.add" | "service.create" | "release.offer" }
  >;
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
  // Where it acts, and who decided it when: the card's chip and its settled line.
  const tier = useEnvironmentTier(proposal.projectId);
  const nameOf = usePersonNames(home?.orgId);
  const viewer = useZeropsSessionOptional()?.user?.id;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const person = useProjection(hqProjectPerson, home === undefined ? null : home, UNKNOWN_PERSON);
  const chief = chiefMessageTarget(person?.chief?.projectId);
  const readOnlyChief = proposal.kind === "chief.message" && person?.chief?.mine !== true;
  // The card's own project, where an approval runs as the person who approves it.
  const target = useMemo(
    () =>
      home === undefined || proposal.projectId === undefined
        ? null
        : { orgId: home.orgId, projectId: proposal.projectId },
    [home, proposal.projectId],
  );
  const operatesHome = useProjection(projectOperator, home ?? null, UNDECIDED);
  const operatesTarget = useProjection(projectOperator, target, UNDECIDED);
  const readOnlyReason = readOnlyChief
    ? person?.chief === undefined
      ? "Finding this Mate's Chief…"
      : "Only this Mate's person can ask their Chief."
    : approveAuthority(proposal, operatesHome, operatesTarget);
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
    proposal.kind === "env.set" && (stage === "open" || stage === "running" || stage === "unseen")
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
  const runOperation = run;
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
            grants,
          }),
    [grants, members, placements.complete, projectPeople, proposal, roster],
  );
  // Its lines come with what it reads of the organization: a conversation opening waits for them,
  // briefly, while its card offers it and the read it is held for is under way. A card decided
  // reads nothing, and held every open of its conversation for the whole wait.
  useTimelineRowSettling(
    accessOrg !== null &&
      accessPlanReading(accessPlan, {
        members: members.status === "loading",
        projects: roster.read === "reading" && scopeAnswers(roster),
        owners: !placements.complete && scopeAnswers(placements),
      }),
  );
  const askMate = useAskMate();
  const openMate = useOpenMate();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const envWrite = proposal.kind === "env.set" ? envProposalWrite(view, proposal) : null;
  // What setting it restarts, read off the vault before the write: the running services that read
  // it and the ones zcp named, once each; the readers that run nothing now are named instead.
  // zcp's names (running then or not) are held to each service's status now.
  const envRestarts = useMemo((): VaultRestarts | null => {
    if (proposal.kind !== "env.set" || envWrite === null || "refused" in envWrite) return null;
    const named = [
      ...(proposal.params.restart ?? []),
      ...(proposal.params.notRunning ?? []).map((hostname) => ({
        serviceId: view.scopes.find((scope) => scope.hostname === hostname)?.id ?? hostname,
        hostname,
      })),
    ];
    return vaultRestarts(view, [envWrite], named);
  }, [envWrite, proposal, view]);
  useRestartLanes();
  // An approved value's restarts, from the write on: the plan it was approved with, the vault
  // change the Mate hears of, those restarted and how the last attempt ended.
  const [restartRun, setRestartRun] = useState<{
    readonly plan: VaultRestarts;
    readonly change: VaultChange | null;
    readonly ended: RestartsEnded | null;
  } | null>(null);
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

  /** A decision made here, recorded as the person's. */
  const mine = useCallback(
    (next: ProposalDecision): ProposalDecision =>
      viewer === undefined ? next : { ...next, by: viewer },
    [viewer],
  );
  const ended = useCallback(
    (outcome: VaultWriteOutcome & { readonly words?: string | undefined }) =>
      void record(
        mine(
          outcome.ok
            ? {
                state: "done",
                at: new Date().toISOString(),
                ...(outcome.words === undefined ? {} : { words: outcome.words }),
              }
            : {
                state: "failed",
                at: new Date().toISOString(),
                message: outcome.message ?? "Zerops did not do it.",
              },
        ),
      ),
    [mine, record],
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

  /**
   * Restarts an approved value's readers in turn, after earlier attempts: done once each restarted,
   * saying so (and naming what runs nothing); else the failed one, for Try again or finishing
   * without it. The Mate's note says which restarted.
   */
  const restartReaders = async (
    run: NonNullable<typeof restartRun>,
    services: VaultRestarts["restart"],
  ) => {
    if (vaultProject === undefined || proposal.kind !== "env.set") return;
    const before = run.ended?.restarted ?? [];
    setRestartRun({ ...run, ended: { restarted: before, failed: null } });
    const now = await restartInTurn(runOperation, vaultProject, services);
    const restarted = [...before, ...now.restarted];
    if (run.change !== null && restarted.length > 0)
      recordVaultWrite(proposal.projectId, { ...run.change, restarted });
    if (now.failed !== null) {
      setRestartRun({ ...run, ended: { restarted, failed: now.failed } });
      return;
    }
    // The card says restarting until the decision it records arrives: no frame says it is writing.
    ended({
      ok: true,
      words: restartedWords(restarted, run.plan.notRunning, run.plan.deploying) ?? undefined,
    });
  };
  const finishUnrestarted = (
    run: NonNullable<typeof restartRun>,
    left: VaultRestarts["restart"],
  ) => {
    ended({
      ok: true,
      words: [
        restartedWords(run.ended?.restarted ?? [], run.plan.notRunning, run.plan.deploying),
        unrestartedWords(left),
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
    });
  };

  /**
   * An approved value's restarts as the card says them: from this card's own run, else — drawn
   * again, or after a reload — read off the vault and this tab's restarts: the value is there and
   * its readers restarting here, or still on the previous value (with how a restart here failed),
   * offering Try again and Finish without restart.
   */
  const envRestartPhase = (): ProposalCardProps["restartPhase"] => {
    if (proposal.kind !== "env.set" || vaultProject === undefined) return undefined;
    const key = proposal.params.key;
    const plan = restartRun?.plan ?? envRestarts;
    if (plan === null) return undefined;
    const done = restartRun?.ended?.restarted ?? [];
    const failed = restartRun?.ended?.failed;
    if (restartRun !== null && failed == null)
      return {
        kind: "restarting",
        words: restartingWords(
          plan.restart.filter((each) => !done.some((one) => one.serviceId === each.serviceId)),
        ),
      };
    if (restartRun !== null && failed != null)
      return {
        kind: "failed",
        words: `${key} is in the vault, but ${notRestartedWords(failed)}`,
        onTryAgain: () => void restartReaders(restartRun, failed.left),
        onFinish: () => finishUnrestarted(restartRun, failed.left),
      };
    if (stage !== "running" && stage !== "unseen") return undefined;
    const scopeId = proposal.params.scope === "project" ? "shared" : proposal.serviceId;
    const held = view.scopes
      .find((scope) => scope.id === scopeId)
      ?.values.find((value) => value.key === key);
    if (held === undefined || (!proposal.params.secret && held.value !== proposal.params.value))
      return undefined;
    const left = plan.restart.filter((service) =>
      held.readers.some(
        (reader) => reader.serviceId === service.serviceId && reader.state !== "live",
      ),
    );
    if (left.length === 0) return undefined;
    const lanes = left.map((service) => restartLane(vaultProject.projectId, service.serviceId));
    if (lanes.some((lane) => lane.restarting))
      return { kind: "restarting", words: restartingWords(left) };
    const failure = lanes.find((lane) => lane.failure !== null)?.failure ?? null;
    const run = { plan: { ...plan, restart: left }, change: null, ended: null };
    return {
      kind: "failed",
      words: `${key} is in the vault, but ${failure === null ? unrestartedWords(left) : notRestartedWords(failure)}`,
      onTryAgain: () => void restartReaders(run, left),
      onFinish: () => finishUnrestarted(run, left),
    };
  };

  /** Records the person's decision at HQ: false, saying why, where HQ did not keep it. */
  const decide = async (next: ProposalDecision): Promise<boolean> => {
    setRefusal(undefined);
    const refused = await record(mine(next));
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
          const plan = envRestarts ?? { restart: [], notRunning: [], deploying: [] };
          const { outcome, change } = await write(envWrite.scope, envWrite.write);
          // The project's own Mate hears of it with its next message, as of a write in its panel.
          if (change !== null) recordVaultWrite(proposal.projectId, change);
          if (!outcome.ok || plan.restart.length === 0) {
            ended(
              outcome.ok
                ? {
                    ...outcome,
                    words: restartedWords([], plan.notRunning, plan.deploying) ?? undefined,
                  }
                : outcome,
            );
            return;
          }
          await restartReaders({ plan, change, ended: null }, plan.restart);
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

  const restartPhase = envRestartPhase();
  return (
    <ProposalCard
      approveBlocked={approveBlocked}
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
      decidedAt={
        decision === undefined ? null : formatDayAwareTimestamp(decision.at, timestampFormat)
      }
      decidedBy={decision?.by === undefined ? null : (nameOf(decision.by) ?? null)}
      doneWords={decision?.state === "done" ? decision.words : undefined}
      restarts={
        envRestarts === null
          ? undefined
          : {
              restart: envRestarts.restart.map((each) => each.hostname),
              notRunning: envRestarts.notRunning.map((each) => each.hostname),
            }
      }
      restartPhase={restartPhase}
      homeProjectId={home?.projectId ?? null}
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
      tier={tier}
    />
  );
}
