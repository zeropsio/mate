import { readBirthIntent } from "../../zerops/birthIntent.ts";
import { attachPermission, mateRecordPermission } from "@t3tools/shared/zeropsPermissions";
import { mateContainerOf } from "../../zerops/containerAddress.ts";
import type { HqBirth, HqBirthAttempt } from "../../zerops/hq/client.ts";
import { hqPressesScope, placementsScope } from "../families/hqNavigation.ts";
import { historyScope, runsStill, type ProcessValue } from "../families/process.ts";
import { servicesScope } from "../families/service.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { latestProjectCreation } from "./creation.ts";
import { sameValue } from "./equal.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { decided, livePermissionFacts } from "./permissionFacts.ts";
import { organizationProjects, rosterAnswered } from "./projects.ts";
import { projectServices } from "./services.ts";
import { projectProcesses } from "./processes.ts";
import { firstBuildState } from "./mateArrival.ts";

export interface BirthEvidence {
  readonly birth: HqBirth;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly projectsCurrent: boolean;
  readonly heldProjects: ReadonlySet<string>;
  readonly projectHistoryCurrent: boolean;
  readonly placement: "unplaced" | "attached" | "unknown";
  readonly createProcess?: ProcessValue;
  readonly importProcess?: ProcessValue;
  /** The bound project's retained process facts, including a service's import and first build. */
  readonly processes?: ReadonlyArray<ProcessValue>;
  /** `undefined` is unread, `null` is absent, and `several` is an ambiguous live read. */
  readonly service: { readonly id: string; readonly status: string } | "several" | null | undefined;
}

export interface BirthProgress {
  readonly phase: "creating-project" | "project-created" | "import-accepted" | "container-starting";
  readonly next:
    | { readonly kind: "create" | "import" | "unknown" | "blocked" }
    | {
        readonly kind: "wait";
        readonly attach: boolean;
        readonly for:
          | "creation"
          | "creation-history"
          | "project"
          | "service-observation"
          | "service"
          | "several-services"
          | "container"
          | "hello";
      }
    | { readonly kind: "bind"; readonly projectId: string }
    | { readonly kind: "record-import"; readonly receipt: string };
  readonly reason: string | null;
  /** HQ explicitly says the session holding this birth's press ended. */
  readonly sessionEnded?: true;
}

export interface SharedBirth {
  readonly id: string;
  readonly appId: string;
  readonly appName: string;
  readonly face: string;
  readonly projectId: string | null;
  readonly importProcessId: string | null;
  /** A registration may be skipped only after HQ proves this birth is attached. */
  readonly placement: "unplaced" | "attached" | "unknown";
  readonly intent: ReturnType<typeof readBirthIntent>;
  readonly progress: BirthProgress;
  readonly canContinue: boolean;
  /** The next registration needs a project or organization administrator. */
  readonly continueRequiresAdmin?: boolean;
  readonly canDelete: boolean;
}

export interface SharedBirthState {
  readonly open: ReadonlyArray<SharedBirth>;
  /** HQ retains a birth ID on the linked Mate after its admitted hello ends the birth. */
  readonly readyProjectIds: ReadonlyArray<string>;
}

export const sharedBirths: Projection<
  { readonly orgId: string; readonly personId: string },
  SharedBirthState
> = {
  name: "sharedBirths",
  keyOf: ({ orgId, personId }) => `${orgId}/${personId}`,
  derive: (read, { orgId, personId }) => {
    const navigation = hqNavigation.derive(read, orgId);
    if (navigation.structure === null) return { open: [], readyProjectIds: [] };
    const roster = organizationProjects.derive(read, orgId);
    const current = roster.complete && rosterAnswered.derive(read, orgId);
    const membership = read.fact("organizationUser", orgId);
    const roleLive = membership.kind === "known" && read.stream(membership.scope).phase === "live";
    const scope = placementsScope(orgId);
    const placements = new Set(read.members(scope).ids);
    const placementsCurrent =
      read.coverage(scope) === "complete" &&
      read.stream(scope).phase === "live" &&
      read.stream(linkKeys.hq(orgId)).phase === "live";
    const heldProjects = new Set(placements);
    for (const app of navigation.structure.apps)
      for (const birth of app.births ?? [])
        if (birth.projectId != null) heldProjects.add(birth.projectId);
    const open = navigation.structure.apps.flatMap((app) =>
      (app.births ?? []).map((birth): SharedBirth => {
        const projectId = birth.projectId ?? null;
        const creation = projectId === null ? undefined : latestProjectCreation(read, projectId);
        const createFact =
          creation === undefined ? undefined : read.fact("process", creation.processId);
        const importFact =
          birth.importProcessId === undefined
            ? undefined
            : read.fact("process", birth.importProcessId);
        const placed =
          projectId === null || !placements.has(projectId)
            ? undefined
            : read.fact("placement", projectId);
        const placement =
          !placementsCurrent || projectId === null
            ? "unknown"
            : placed === undefined
              ? "unplaced"
              : placed.kind === "known" &&
                  placed.value.appId === app.id &&
                  placed.value.mate?.birthId === birth.id
                ? "attached"
                : "unknown";
        const services =
          projectId === null ? undefined : projectServices.derive(read, { orgId, projectId });
        const processes =
          projectId === null
            ? undefined
            : projectProcesses.derive(read, { orgId, projectId }).retained;
        const container =
          services?.services === undefined ||
          !services.live ||
          read.stream(servicesScope(orgId)).phase !== "live"
            ? undefined
            : mateContainerOf(services.services);
        const service =
          container === undefined
            ? undefined
            : container.kind === "one"
              ? container.service
              : container.kind === "none"
                ? null
                : "several";
        const press = projectId === null ? undefined : navigation.presses[projectId];
        const pressScope = hqPressesScope(orgId);
        const sessionEnded =
          read.stream(linkKeys.hq(orgId)).phase === "live" &&
          read.stream(pressScope).phase === "live" &&
          read.coverage(pressScope) === "complete" &&
          press?.kind === "mate" &&
          press.appId === app.id &&
          !press.held;
        const progress = {
          ...birthProgressOf({
            birth,
            projects: roster.projects,
            projectsCurrent: current,
            heldProjects,
            placement,
            projectHistoryCurrent:
              projectId !== null && read.stream(historyScope(orgId, projectId)).phase === "live",
            ...(createFact?.kind === "known" ? { createProcess: createFact.value } : {}),
            ...(importFact?.kind === "known" ? { importProcess: importFact.value } : {}),
            ...(processes === undefined ? {} : { processes }),
            service,
          }),
          ...(sessionEnded ? { sessionEnded: true as const } : {}),
        };
        const roleCurrent = personId !== "" && navigation.live && current && roleLive;
        const authorized = roleCurrent && app.can?.add_mate?.allow === true;
        const attachProject =
          projectId ?? (progress.next.kind === "bind" ? progress.next.projectId : null);
        const appProjects = app.projects.map((project) => project.projectId);
        const attachment =
          attachProject === null || placement === "attached"
            ? true
            : placementsCurrent && (projectId === null || placement === "unplaced")
              ? decided(
                  livePermissionFacts(read, orgId),
                  [attachProject, ...appProjects],
                  (facts) =>
                    attachPermission(facts, {
                      projectId: attachProject,
                      projectIds: appProjects,
                      kind: "mate",
                      held: "none",
                      slotTaken: false,
                    }),
                )?.allow
              : undefined;
        return {
          id: birth.id,
          appId: app.id,
          appName: app.name,
          face: birth.face,
          projectId,
          importProcessId: birth.importProcessId ?? null,
          placement,
          intent: readBirthIntent(birth.intent),
          progress,
          canContinue:
            authorized &&
            (projectId !== null || birth.madeBy === personId) &&
            attachment === true &&
            progress.next.kind !== "unknown" &&
            progress.next.kind !== "blocked" &&
            (progress.next.kind !== "wait" || progress.next.attach),
          ...(authorized && attachment === false ? { continueRequiresAdmin: true } : {}),
          canDelete:
            projectId === null
              ? authorized
              : roleCurrent &&
                decided(livePermissionFacts(read, orgId), [projectId], (facts) =>
                  mateRecordPermission(facts, projectId, { create: false, held: "mate" }),
                )?.allow === true,
        };
      }),
    );
    const openIds = new Set(open.map(({ id }) => id));
    const readyProjectIds = navigation.structure.apps.flatMap((app) =>
      app.projects.flatMap((project) =>
        project.mate?.birthId != null && !openIds.has(project.mate.birthId)
          ? [project.projectId]
          : [],
      ),
    );
    return { open, readyProjectIds };
  },
  equals: sameValue,
};

type AttemptState =
  | { readonly kind: "free"; readonly reason: string | null }
  | { readonly kind: "active" | "unknown"; readonly reason: null };

/** A retained earlier refusal does not release the newer claim. */
function attemptState(attempt: HqBirthAttempt | undefined): AttemptState {
  if (attempt === undefined) return { kind: "free", reason: null };
  const outcomes = [attempt.refused, attempt.unsent].filter((outcome) => outcome !== undefined);
  if (outcomes.length === 0) return { kind: "active", reason: null };
  const claimAt = Date.parse(attempt.at);
  const timed = outcomes.map((outcome) => ({ ...outcome, time: Date.parse(outcome.at) }));
  if (
    !Number.isFinite(claimAt) ||
    timed.some(({ time }) => !Number.isFinite(time) || time === claimAt)
  )
    return { kind: "unknown", reason: null };
  const latest = timed.reduce((a, b) => (a.time > b.time ? a : b));
  return latest.time > claimAt
    ? { kind: "free", reason: latest.reason }
    : { kind: "active", reason: null };
}

const failureOf = (process: ProcessValue | undefined): string | null | undefined => {
  if (process?.status !== "FAILED" && process?.status !== "CANCELED") return undefined;
  return process.failReason ?? process.error?.message ?? null;
};

/** A verdict uses only HQ's record and facts read from Zerops, never local elapsed time. */
export function birthProgressOf(evidence: BirthEvidence): BirthProgress {
  const { birth, projects } = evidence;
  const service = evidence.service === "several" ? undefined : evidence.service;
  const unknown = (phase: BirthProgress["phase"]): BirthProgress => ({
    phase,
    next: { kind: "unknown" },
    reason: null,
  });
  const plan = readBirthIntent(birth.intent);
  const attempts = birth.attempts;
  if (birth.projectId == null) {
    if (plan === undefined || attempts === undefined) return unknown("creating-project");
    const create = attemptState(attempts.create);
    if (create.kind === "free")
      return { phase: "creating-project", next: { kind: "create" }, reason: create.reason };
    if (create.kind !== "active" || !evidence.projectsCurrent) return unknown("creating-project");
    const matches = projects.filter(
      (project) => project.name === plan.projectName && !evidence.heldProjects.has(project.id),
    );
    return matches.length === 1
      ? {
          phase: "creating-project",
          next: { kind: "bind", projectId: matches[0]!.id },
          reason: null,
        }
      : unknown("creating-project");
  }

  const projectId = birth.projectId;
  const creation =
    evidence.createProcess?.projectId === projectId ? evidence.createProcess : undefined;
  const creationFailure = failureOf(creation);
  if (creationFailure !== undefined)
    return { phase: "creating-project", next: { kind: "blocked" }, reason: creationFailure };
  const made =
    projects.some((project) => project.id === projectId) || creation?.status === "FINISHED";
  const matchingImports =
    service == null
      ? []
      : (evidence.processes ?? []).filter(
          (process) =>
            process.projectId === projectId &&
            process.actionName === "stack.create" &&
            process.serviceStackIds.includes(service.id),
        );
  const correlatedImport = matchingImports.length === 1 ? matchingImports[0] : undefined;
  const importProcess =
    evidence.importProcess?.projectId === projectId &&
    evidence.importProcess.id === birth.importProcessId
      ? evidence.importProcess
      : birth.importProcessId !== undefined &&
          (birth.importProcessId === service?.id || birth.importProcessId === correlatedImport?.id)
        ? correlatedImport
        : undefined;
  const importFailure = failureOf(importProcess);
  const imported = birth.importProcessId !== undefined;
  const phase =
    service != null
      ? "container-starting"
      : imported
        ? "import-accepted"
        : made
          ? "project-created"
          : "creating-project";
  if (importFailure !== undefined)
    return { phase, next: { kind: "blocked" }, reason: importFailure };
  const build = firstBuildState(evidence.processes, service?.id);
  const containerReason =
    build?.kind === "failed"
      ? build.why
      : service?.status.endsWith("FAILED") === true
        ? "Container failed."
        : service?.status === "STOPPED"
          ? "Container stopped."
          : null;
  if (imported)
    return {
      phase,
      next: {
        kind: "wait",
        attach: evidence.placement === "unplaced",
        for:
          evidence.service === "several"
            ? "several-services"
            : service === undefined
              ? "service-observation"
              : service === null
                ? "service"
                : service.status === "ACTIVE"
                  ? "hello"
                  : "container",
      },
      reason: containerReason,
    };
  if (creation !== undefined && runsStill(creation.status))
    return { phase, next: { kind: "wait", for: "creation", attach: false }, reason: null };
  if (creation === undefined && !evidence.projectHistoryCurrent)
    return { phase, next: { kind: "wait", for: "creation-history", attach: false }, reason: null };
  if (!made) return { phase, next: { kind: "wait", for: "project", attach: false }, reason: null };
  if (plan === undefined || attempts === undefined) return unknown(phase);
  const importing = attemptState(attempts.import);
  if (importing.kind === "active" && service != null)
    return {
      phase,
      next: { kind: "record-import", receipt: correlatedImport?.id ?? service.id },
      reason: containerReason,
    };
  if (importing.kind !== "free" || service != null || evidence.service === "several")
    return unknown(phase);
  return { phase, next: { kind: "import" }, reason: importing.reason };
}
