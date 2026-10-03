/**
 * *New project*, from the press of Create: the project and its first Mate in one step, drawn at
 * once where the Mate will live — its own view (`/mate/new/$birthId`) and its row in the left menu
 * — before the platform has made anything (the owner, 2026-09-30: "you should add the project and
 * the first mate in the same step, then you should go to the mate detail and the only diff would
 * be the progress").
 *
 * A New project's creation takes, in order — over the organization's HQ, which stands before
 * any project does (ADR 0001):
 * - `registry` — the project's application in HQ, which is what makes the project exist. HQ names
 *   it: its id is the project's group from then on. Then its first Mate's birth intent there —
 *   its name and face, before its project exists — which the project is created under (F6c).
 * - `create` — its first Mate's Zerops project, tagged into the project at birth. Once the platform
 *   takes it the Mate's birth carries the rest (`zeropsBirths.ts`), and the view hands the route to
 *   the Mate's own (`/mate/$projectId`), in its place.
 *
 * Until then this tab holds the creation — how far it got, and where it stopped and why — and
 * nothing else does: a reload forgets it, as it forgets an Add a Mate the platform has not taken
 * (`newMate.ts`). Each creation is keyed by an id made on the press. A step that stops says why on
 * the view, with *Try again*, which resumes from that step — except a creation the platform may
 * have taken anyway (`uncertain`), which a second try could make twice.
 */
import {
  formatMateFace,
  ZeropsApiError,
  type BirthPlacement,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type ZeropsAgentType,
  type ZeropsMateFace,
  type ZeropsPlacedBirth,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import { deriveBirthProgress } from "@t3tools/client-runtime/zerops/birthProgress";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { create } from "zustand";

import type {
  BirthLineProgress,
  BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
import {
  pressThrough,
  type PressStepView,
} from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { COMING_UP_LINE, NOT_SET_UP_LINE } from "../components/zerops/ZeropsProjectRow.logic";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { asSentence, type MateComing } from "./mateComing";
import { newMateView } from "./newMate";

/** A step of a New project's creation, before the platform has taken its first Mate's project. */
export type NewProjectStep = "registry" | "create";

/** What Create asked for: the project, its first Mate, and where. */
export interface NewProjectAsk {
  readonly organizationId: string;
  /** The creation's own id, made on the press: where its view is, and its group until HQ names one. */
  readonly birthId: string;
  /** The project's name. */
  readonly name: string;
  /** Its first Mate's name. */
  readonly botName: string;
  readonly face: ZeropsMateFace;
  readonly locationId: string | null;
  /** Empty for every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`). */
  readonly agents: ReadonlyArray<ZeropsAgentType>;
}

export interface NewProjectFailure {
  readonly reason: string;
  /** The platform may have taken the creation anyway: trying again could make it twice. */
  readonly uncertain: boolean;
}

/** A New project's creation as this tab holds it. */
export interface NewProjectBirth extends NewProjectAsk {
  /** When Create was pressed, wall ms: the view's clock counts from here. */
  readonly startedAt: number;
  /** The organization's HQ, where the registry lives. */
  readonly hq: HqEndpoint;
  /** The project's application in HQ — its group — once registered. */
  readonly appId: string | null;
  /** Its first Mate's birth intent in that application, once HQ recorded it (`recordBirth`). */
  readonly intent: string | null;
  /** The step running, or — `failed` — the one that stopped it; `created` once the platform took the Mate's project. */
  readonly step: NewProjectStep | "created";
  readonly failed: NewProjectFailure | null;
  /** The first Mate's Zerops project, once the platform took it. */
  readonly projectId: string | null;
}

export type NewProjectPatch = Partial<
  Pick<NewProjectBirth, "step" | "appId" | "intent" | "failed" | "projectId">
>;

/**
 * What the first Mate's project is created with: the project alone, under its birth intent. Its
 * application, name and face are HQ's, written by its press's registration before its container
 * (F6b) — and its intent's before that (F6c).
 */
export interface NewProjectCreation {
  readonly name: string;
  readonly location?: string;
  /** The birth intent HQ holds of its Mate: the project is tagged with it (`mateBirthTag`). */
  readonly birth: string;
}

/**
 * Where the project stands once registered: its organization's HQ, its application in it, and its
 * first Mate's birth intent there, which the Mate's attach closes.
 */
export interface NewProjectRegistration {
  readonly hq: HqEndpoint;
  readonly appId: string;
  readonly intent: string;
}

/** What a New project's creation acts through: the platform, HQ, and the birth it hands over to. */
export interface NewProjectPorts {
  /** Creates the project's application in HQ (`POST /api/apps`). */
  readonly registerGroup: (registration: {
    readonly hq: HqEndpoint;
    readonly name: string;
  }) => Promise<{ readonly appId: string }>;
  /**
   * Records the first Mate's birth intent in its application (`POST /api/births`): its name and
   * face, before its project exists, under HQ's id.
   */
  readonly recordBirth: (birth: {
    readonly hq: HqEndpoint;
    readonly appId: string;
    readonly name: string;
    readonly face: string;
  }) => Promise<{ readonly id: string }>;
  /**
   * Creates the first Mate's project, alone: its press attaches it to its application, then
   * imports its container (F6b).
   */
  readonly createProject: (creation: NewProjectCreation) => Promise<{
    readonly project: Pick<ZeropsProject, "id">;
  }>;
  /**
   * The platform took the first Mate's project: its birth begins, on the creation's own clock —
   * `startedAt` is the press's, so its row counts on, never from 0:00 — and its press attaches it,
   * then imports its container.
   */
  readonly accepted: (
    projectId: string,
    registration: NewProjectRegistration,
    startedAt: number,
  ) => void;
}

// ── What its surfaces draw ───────────────────────────────────────────────────────────────────

/**
 * Where the project and its first Mate stand in the account's projects, as the creation knows
 * them: its row in the menu from the press, and its birth's from the moment the platform takes it
 * — in the group HQ named, once it named one.
 */
export function newProjectPlacement(
  ask: NewProjectAsk & { readonly appId?: string | null },
): BirthPlacement {
  return {
    groupId: ask.appId ?? ask.birthId,
    groupName: ask.name,
    kind: "mate",
    // The group has no project of its own; its first Mate is named after its bot, the way every
    // Mate added afterwards is — "Acme CRM - Vera".
    displayName: `${ask.name} - ${ask.botName}`,
    botName: ask.botName,
    face: ask.face,
  };
}

/**
 * The creations the platform has not taken yet in the organization in view, placed as the birth
 * store's are (`placedBirthsIn`): the project, and its Mate in it, drawn from the press — by the
 * creation's id, which its own view is at. One the platform took is its birth's to draw.
 */
export function placedNewProjects(
  births: ReadonlyArray<NewProjectBirth>,
  organizationId: string | undefined,
): ReadonlyArray<ZeropsPlacedBirth> {
  return births.flatMap((birth) =>
    birth.projectId !== null || birth.organizationId !== organizationId
      ? []
      : [
          {
            projectId: birth.birthId,
            startedAt: birth.startedAt,
            placement: newProjectPlacement(birth),
            // The first thing its Mate's birth will owe.
            step: "tags" as const,
            overdue: false,
            awaitingProject: true,
            ...(birth.failed === null ? {} : { failed: true }),
          },
        ],
  );
}

const ORDER: ReadonlyArray<NewProjectBirth["step"]> = ["registry", "create", "created"];

/** A step's state: done once the creation is past it, and the running one active or failed. */
function stateOf(birth: NewProjectBirth, own: NewProjectStep): BirthLineStep["state"] {
  const at = ORDER.indexOf(birth.step);
  const mine = ORDER.indexOf(own);
  if (mine < at) return "done";
  if (mine > at) return "waiting";
  return birth.failed === null ? "active" : "failed";
}

/** The project's own step, before its first Mate's: its registration, under the project's name. */
export function newProjectSteps(birth: NewProjectBirth): ReadonlyArray<BirthLineStep> {
  const step = (id: string, label: string, own: NewProjectStep, doing: string): BirthLineStep => {
    const state = stateOf(birth, own);
    const detail =
      state === "active" ? doing : state === "failed" ? birth.failed?.reason : undefined;
    return { id, label, state, ...(detail === undefined ? {} : { detail }) };
  };
  return [step("registry", birth.name, "registry", "Registering the project")];
}

/**
 * How far a New project's creation has got, as its first Mate's view draws it: the project's own
 * steps, then the Mate's six (`deriveBirthProgress`) — its birth's, once the platform took its
 * project, and read off the creation itself before that. The Mate's steps wait while the
 * project's run: none of them begins before the project stands. One clock, from the press.
 */
export function newProjectProgress(
  birth: NewProjectBirth,
  /** The Mate's birth as its view reads it, once the platform took its project; null before. */
  mate: BirthLineProgress | null,
  nowMs: number,
): BirthLineProgress {
  const own = newProjectSteps(birth);
  const theirs =
    mate ??
    deriveBirthProgress(
      {
        project: undefined,
        ...(birth.step === "create" && birth.failed !== null
          ? { creationFailed: { message: birth.failed.reason } }
          : {}),
        container: undefined,
        processes: [],
        health: undefined,
        connection: "none",
      },
      nowMs,
    );
  const stands = own.every((step) => step.state === "done");
  const steps: ReadonlyArray<BirthLineStep> = [
    ...own,
    ...(stands
      ? theirs.steps
      : theirs.steps.map(({ id, label }) => ({ id, label, state: "waiting" as const }))),
  ];
  return {
    steps,
    active: steps.find((step) => step.state === "active") ?? null,
    failed: steps.find((step) => step.state === "failed") ?? null,
    doneCount: steps.filter((step) => step.state === "done").length,
    total: steps.length,
    complete: steps.at(-1)?.state === "done",
    startedAt: new Date(birth.startedAt).toISOString(),
  };
}

/**
 * What its view says under the headline (`MateComing`): coming up while it runs; where it stopped,
 * why, with *Try again* — or, where the platform may have taken it anyway, the way to the projects,
 * where it would be listed.
 */
export function newProjectComing(birth: NewProjectBirth): MateComing {
  if (birth.failed === null) return { kind: "coming", line: COMING_UP_LINE };
  const why = asSentence(birth.failed.reason);
  return {
    kind: "failed",
    line: why.length === 0 ? NOT_SET_UP_LINE : why,
    verb: birth.failed.uncertain ? "go-to-projects" : "try-again",
  };
}

/** Where Create lands: the first Mate's own view, before the platform has made anything. */
export function newProjectView(birthId: string): {
  readonly to: "/mate/new/$birthId";
  readonly params: { readonly birthId: string };
} {
  return { to: "/mate/new/$birthId", params: { birthId } };
}

/**
 * Where its view goes once the platform took its first Mate's project: that Mate's own view, in
 * place of this one — the route replaced, so going back never lands on a creation that is over.
 */
export function newProjectHandOver(
  birth: NewProjectBirth | undefined,
): (ReturnType<typeof newMateView> & { readonly replace: true }) | null {
  if (birth?.projectId == null) return null;
  return { ...newMateView(birth.projectId), replace: true };
}

// ── Running it ───────────────────────────────────────────────────────────────────────────────

function isUncertain(cause: unknown): boolean {
  if (cause instanceof ZeropsApiError) return cause.kind === "uncertain";
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ZeropsDataAdapterError" &&
    "kind" in cause &&
    cause.kind === "uncertain"
  );
}

/**
 * Runs a New project's creation from the step it stands on until the platform takes its first
 * Mate's project, or until a step stops it — telling `moved` of each step it reaches.
 *
 * The order is the point: the application is what makes the project exist, and a Mate created
 * before it would be a Mate in a project nobody has heard of. A registration that fails creates
 * nothing; a Mate's creation that fails leaves a registered project with no Mate in it, which is
 * one the person can add a Mate to, not a mess to clean up.
 */
export async function runNewProjectBirth(
  birth: NewProjectBirth,
  ports: NewProjectPorts,
  moved: (patch: NewProjectPatch) => void,
): Promise<void> {
  if (birth.step === "created") return;
  const stop = (reason: string, uncertain = false) => {
    moved({ failed: { reason, uncertain } });
  };

  const { hq } = birth;
  let appId = birth.appId;
  if (appId === null) {
    try {
      appId = (await ports.registerGroup({ hq, name: birth.name })).appId;
    } catch (cause) {
      stop(zeropsErrorMessage(cause));
      return;
    }
    moved({ appId });
  }
  // Recorded once: a creation tried again goes on under the intent it holds.
  let intent = birth.intent;
  if (intent === null) {
    try {
      intent = (
        await ports.recordBirth({
          hq,
          appId,
          name: birth.botName,
          face: formatMateFace(birth.face),
        })
      ).id;
    } catch (cause) {
      stop(zeropsErrorMessage(cause));
      return;
    }
    moved({ step: "create", intent });
  }

  let created: Awaited<ReturnType<NewProjectPorts["createProject"]>>;
  try {
    created = await ports.createProject({
      name: newProjectPlacement(birth).displayName,
      ...(birth.locationId === null ? {} : { location: birth.locationId }),
      birth: intent,
    });
  } catch (cause) {
    stop(zeropsErrorMessage(cause), isUncertain(cause));
    return;
  }
  const projectId = created.project.id;
  // Its birth begins, and its view moves to it, in one breath: the menu draws its row from one or
  // the other, never neither.
  ports.accepted(projectId, { hq, appId, intent }, birth.startedAt);
  moved({ step: "created", projectId });
}

// ── The creations this tab holds ─────────────────────────────────────────────────────────────

interface NewProjectBirthsState {
  /** By the creation's id: its project's group. */
  readonly births: Readonly<Record<string, NewProjectBirth>>;
}

export const useNewProjectBirths = create<NewProjectBirthsState>(() => ({ births: {} }));

/** What drives each creation: its ports, the account it was made for, and whether a run is on. */
const driving = new Map<
  string,
  { readonly ports: NewProjectPorts; readonly isCurrent: () => boolean; running: boolean }
>();

function patchBirth(birthId: string, patch: NewProjectPatch): void {
  useNewProjectBirths.setState((state) => {
    const birth = state.births[birthId];
    if (birth === undefined) return state;
    return { births: { ...state.births, [birthId]: { ...birth, ...patch } } };
  });
}

async function drive(birthId: string): Promise<void> {
  const held = driving.get(birthId);
  const birth = useNewProjectBirths.getState().births[birthId];
  if (held === undefined || birth === undefined || held.running) return;
  held.running = true;
  try {
    // A step still running when the person signs out lands nowhere: neither this account's
    // creations nor the next one's births hear of it.
    await runNewProjectBirth(
      birth,
      {
        ...held.ports,
        accepted: (projectId, registration, startedAt) => {
          if (held.isCurrent()) held.ports.accepted(projectId, registration, startedAt);
        },
      },
      (patch) => {
        if (held.isCurrent()) patchBirth(birthId, patch);
      },
    );
  } finally {
    held.running = false;
  }
}

/**
 * Create was pressed: the creation is held from now, and runs. Its id is where its first Mate's
 * view is (`newProjectView`).
 */
export function beginNewProjectBirth(input: {
  readonly ask: NewProjectAsk;
  /** The organization's HQ, as its member list names it. */
  readonly hq: HqEndpoint;
  readonly ports: NewProjectPorts;
  /** Wall ms. */
  readonly now: number;
}): string {
  const birthId = input.ask.birthId;
  const birth: NewProjectBirth = {
    ...input.ask,
    startedAt: input.now,
    hq: input.hq,
    appId: null,
    intent: null,
    step: "registry",
    failed: null,
    projectId: null,
  };
  useNewProjectBirths.setState((state) => ({ births: { ...state.births, [birthId]: birth } }));
  driving.set(birthId, {
    ports: input.ports,
    isCurrent: captureAccountLifetime(),
    running: false,
  });
  void drive(birthId);
  return birthId;
}

/** *Try again* on a creation a step stopped: it resumes from that step. */
export function retryNewProjectBirth(birthId: string): void {
  const birth = useNewProjectBirths.getState().births[birthId];
  if (birth === undefined || birth.failed === null || birth.failed.uncertain) return;
  patchBirth(birthId, { failed: null });
  void drive(birthId);
}

/** The creation this tab made whose first Mate's project this is, while the tab holds it. */
export function newProjectBirthOf(
  births: Readonly<Record<string, NewProjectBirth>>,
  projectId: string,
): NewProjectBirth | undefined {
  return Object.values(births).find((birth) => birth.projectId === projectId);
}

onAccountLifetimeClose(() => {
  driving.clear();
  useNewProjectBirths.setState({ births: {} });
});

/**
 * A New project's press as its dialog draws it, until the first Mate needs no browser: the
 * project's registration, the project itself — its creation's wait
 * part of the press — then its Mate's close-off and registration, from the Mate's own press
 * (`progress`, null before it begins).
 */
export function newProjectPressSteps(
  birth: NewProjectBirth,
  progress: ReadonlyArray<EnvironmentCreationStepProgress> | null,
): ReadonlyArray<PressStepView> {
  const own = (label: string, step: NewProjectStep): PressStepView => ({
    label,
    state: stateOf(birth, step),
  });
  const mate = (label: string, kind: EnvironmentCreationStep["kind"]): PressStepView => {
    const entry = progress?.find((candidate) => candidate.step.kind === kind);
    const state: PressStepView["state"] =
      entry === undefined
        ? "waiting"
        : entry.state === "queued"
          ? "waiting"
          : entry.state === "running"
            ? "active"
            : entry.state;
    return { label, state };
  };
  return [
    own("Project registered", "registry"),
    own("Creating the project", "create"),
    // In the order its press runs: its record in its application before its close-off (F6b).
    mate("Mate registered", "register"),
    mate("Closed off", "close-off"),
  ];
}

/** The first Mate is marked closed off: it needs no browser, and the dialog may go. */
export function newProjectPressThrough(
  progress: ReadonlyArray<EnvironmentCreationStepProgress> | null,
): boolean {
  return progress !== null && pressThrough(progress);
}

/** A press's stop as its dialog reads it: why, and whether Try again may run it again. */
export interface NewProjectPressStop {
  readonly kind: "failed";
  readonly reason: string;
  readonly retryable: boolean;
}

/**
 * Why a New project's press stopped, and what *Try again* resumes: its own step (`creation`),
 * its Mate's press (`press`), or nothing where the platform may have taken the creation anyway.
 * Null while it runs.
 */
export function newProjectPressFailure(
  birth: NewProjectBirth,
  press: NewProjectPressStop | null,
): { readonly reason: string; readonly tryAgain: "creation" | "press" | null } | null {
  if (birth.failed !== null) {
    return { reason: birth.failed.reason, tryAgain: birth.failed.uncertain ? null : "creation" };
  }
  if (press === null) return null;
  return { reason: press.reason, tryAgain: press.retryable ? "press" : null };
}
