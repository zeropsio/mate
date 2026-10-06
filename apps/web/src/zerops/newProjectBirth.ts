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
 *   its face, before its project exists — which the project is created under (F6c).
 * - `create` — its first Mate's Zerops project, named in full under its application, tagged into the project
 *   at birth. Once the platform takes it the Mate's birth carries the rest (`zeropsBirths.ts`), and
 *   the view hands the route to the Mate's own (`/mate/$projectId`), in its place.
 *
 * Until then this tab holds the creation — how far it got, and where it stopped and why — and
 * its tab retains the non-secret context through reload, including an Add a Mate the platform has not taken
 * (`newMate.ts`). Each creation is keyed by an id made on the press. A step that stops says why on
 * the view, with *Try again*, which resumes from that step — except a creation the platform may
 * have taken anyway (`uncertain`), which a second try could make twice.
 */
import {
  appProjectName,
  formatMateFace,
  recipeTierServices,
  splitRecipeTier,
  ZeropsApiError,
  type BirthPlacement,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type RecipeRuntime,
  type ZeropsAgentType,
  type ZeropsMateFace,
  type ZeropsPlacedBirth,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import {
  birthRuntimesFacts,
  deriveBirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import {
  isUncertainZeropsFailure,
  zeropsErrorMessage,
} from "@t3tools/client-runtime/zerops/errors";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { create } from "zustand";

import type {
  BirthLineProgress,
  BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
import { COMING_UP_LINE, NOT_SET_UP_LINE } from "../components/zerops/ZeropsProjectRow.logic";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import type { ArrivalSubstep } from "./mateArrival";
import { asSentence, type MateComing } from "./mateComing";
import { newMateView, useNewMate, type NewMateAgain } from "./newMate";

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
  /**
   * Add a Mate, not a New project: the Mate goes into the project `name` that stands — no Git
   * hosting or registration of the project's own — its Zerops project named in full under it,
   * and its own registration written where `registers`.
   */
  readonly adds?:
    | {
        /** The existing application in HQ. */
        readonly appId: string;
        readonly registers: boolean;
        /** The managed services its recipe names, from the press (`recipeManaged`). */
        readonly managed?: ReadonlyArray<string> | undefined;
        /** The runtimes its workspace brings, from the press (`recipeRuntimes`). */
        readonly runtimes?: ReadonlyArray<RecipeRuntime> | undefined;
      }
    | undefined;
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
  /** Its Mate's press, each step's state as it moves; null before it is heard. */
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress> | null;
  /** Presentation retained across reload; full plans may contain private configuration. */
  readonly retainedSubsteps?: ReadonlyArray<ArrivalSubstep> | undefined;
}

export type NewProjectPatch = Partial<
  Pick<
    NewProjectBirth,
    "step" | "appId" | "intent" | "failed" | "projectId" | "progress" | "retainedSubsteps"
  >
>;

/**
 * What the first Mate's project is created with: the project alone, named in full — its
 * application's name and its Mate's — under its birth intent. Its application and face are HQ's, written by its press's registration
 * before its container (F6b) — and its intent's before that (F6c).
 */
export interface NewProjectCreation {
  readonly name: string;
  readonly location?: string;
  /** The birth intent HQ holds of its Mate. */
  readonly birth?: string;
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
   * Records the first Mate's birth intent in its application (`POST /api/births`): its face,
   * before its project exists, under HQ's id.
   */
  readonly recordBirth: (birth: {
    readonly hq: HqEndpoint;
    readonly appId: string;
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
    registration: NewProjectRegistration | null,
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
    // The group has no project of its own; its first Mate's project is named in full, the
    // application's name and the Mate's, and drawn by the Mate's own name under it.
    displayName: ask.botName,
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
            ...(birth.intent === null ? {} : { intent: birth.intent }),
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
  // An added Mate's project stands: its copy is its first row.
  if (birth.adds !== undefined) return [];
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
  // An added Mate's runtimes are named from the press, as its own view names them after.
  const runtimes = birthRuntimesFacts({ planned: creationRuntimes(birth), services: undefined });
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
        ...(runtimes === undefined ? {} : { runtimes }),
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
    ...(theirs.runtimes === undefined ? {} : { runtimes: theirs.runtimes }),
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
  // Add's press owns its HQ intent and attach, through useEnvironmentCreation. It creates
  // no application and never writes the new-project registration.
  if (birth.adds !== undefined) {
    try {
      const { project } = await ports.createProject({
        name: appProjectName(birth.name, birth.botName),
      });
      ports.accepted(project.id, null, birth.startedAt);
      moved({ step: "created", projectId: project.id });
    } catch (cause) {
      stop(zeropsErrorMessage(cause), isUncertainZeropsFailure(cause));
    }
    return;
  }
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
      intent = (await ports.recordBirth({ hq, appId, face: formatMateFace(birth.face) })).id;
    } catch (cause) {
      stop(zeropsErrorMessage(cause));
      return;
    }
    moved({ step: "create", intent });
  }

  let created: Awaited<ReturnType<NewProjectPorts["createProject"]>>;
  try {
    created = await ports.createProject({
      name: appProjectName(birth.name, birth.botName),
      ...(birth.locationId === null ? {} : { location: birth.locationId }),
      birth: intent,
    });
  } catch (cause) {
    stop(zeropsErrorMessage(cause), isUncertainZeropsFailure(cause));
    return;
  }
  const projectId = created.project.id;
  // Its birth begins, and its view moves to it, in one breath: the menu draws its row from one or
  // the other, never neither.
  ports.accepted(projectId, { hq, appId, intent }, birth.startedAt);
  moved({ step: "created", projectId });
}

/** What an Add's press answers once it is over (`useEnvironmentCreation`). */
export type AddRun =
  | { readonly kind: "refused"; readonly reason: string | null }
  | { readonly kind: "ran"; readonly outcome: EnvironmentCreationOutcome };

/**
 * An Add's press as its creation's `createProject`: taken the moment the platform takes its
 * project, the press running on after it. A stop before that rejects with why — uncertain where
 * Zerops may have made it anyway, so no *Try again* makes a second — and one after it, a throw
 * included, is its press's to say on the Mate's own view (`settled`).
 */
export function addCreateProject(input: {
  readonly run: (onAccepted: (projectId: string) => void) => Promise<AddRun>;
  readonly settled: (projectId: string, error: string) => void;
}): Promise<{ readonly project: { readonly id: string } }> {
  return new Promise((resolve, reject) => {
    let accepted: string | undefined;
    const stopped = (error: string, uncertain: boolean) => {
      if (accepted !== undefined) {
        input.settled(accepted, error);
        return;
      }
      reject(uncertain ? new ZeropsApiError(error, "uncertain") : new Error(error));
    };
    input
      .run((projectId) => {
        accepted = projectId;
        resolve({ project: { id: projectId } });
      })
      .then(
        (run) => {
          if (run.kind === "refused") {
            stopped(run.reason ?? ADD_REFUSED, false);
            return;
          }
          if (run.outcome.ok) {
            if (accepted === undefined) stopped(ADD_REFUSED, false);
            return;
          }
          stopped(run.outcome.error, run.outcome.uncertain === true);
        },
        (cause: unknown) => {
          stopped(zeropsErrorMessage(cause), isUncertainZeropsFailure(cause));
        },
      );
  });
}

const ADD_REFUSED = "It could not be added.";

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
  /** The official HQ held by the account. */
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
    appId: input.ask.adds?.appId ?? null,
    intent: null,
    step: input.ask.adds === undefined ? "registry" : "create",
    failed: null,
    projectId: null,
    progress: null,
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

/**
 * Its Mate's press moved: each step's state, kept on the creation for its view, which draws them
 * under its project's row until it hands over (`creationSubsteps`).
 */
export function progressNewProjectBirth(
  birthId: string,
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
): void {
  const creation = progress.find((entry) => entry.step.kind === "create-project");
  const intent = creation?.step.kind === "create-project" ? creation.step.birth : undefined;
  patchBirth(birthId, { progress, ...(intent === undefined ? {} : { intent }) });
}

/**
 * What ends a creation that stopped before Zerops took its project as far as this tab knows:
 * *Dismiss* takes it out of the menu — and, for an Add refused for certain (a quota, a right),
 * *Start over* asks for it again over its project, its name there to change. One Zerops may have
 * made is dismissed, never started over: a second could make it twice. Null for any other: one
 * running, one Zerops took (its press finishes it), a New project refused for certain (its own
 * *Try again*).
 */
export function creationEnds(birth: NewProjectBirth): {
  readonly startOver: { readonly groupId: string; readonly again: NewMateAgain } | null;
} | null {
  if (birth.projectId !== null || birth.failed === null) return null;
  if (birth.failed.uncertain) return { startOver: null };
  if (birth.adds === undefined) return null;
  return {
    startOver: {
      groupId: birth.adds.appId,
      again: {
        botName: birth.botName,
        tint: birth.face.tint,
        shape: birth.face.shape,
      },
    },
  };
}

/** *Dismiss*: the creation is let go of, and its row leaves the menu. */
export function dismissNewProjectBirth(birthId: string): void {
  driving.delete(birthId);
  useNewProjectBirths.setState((state) => {
    if (state.births[birthId] === undefined) return state;
    const { [birthId]: _gone, ...rest } = state.births;
    return { births: rest };
  });
}

/** *Start over*: an Add refused for certain (`creationEnds`) is let go of, and asked for again, prefilled. */
export function startAddOver(birthId: string): void {
  const birth = useNewProjectBirths.getState().births[birthId];
  const startOver = birth === undefined ? null : creationEnds(birth)?.startOver;
  if (startOver == null) return;
  dismissNewProjectBirth(birthId);
  useNewMate.getState().ask(startOver.groupId, startOver.again);
}

/** *Try again* on a creation a step stopped: it resumes from that step, with the same project. */
export function retryNewProjectBirth(birthId: string, ports?: NewProjectPorts): void {
  const birth = useNewProjectBirths.getState().births[birthId];
  if (birth === undefined || birth.failed === null || birth.failed.uncertain) return;
  if (!driving.has(birthId) && ports !== undefined) {
    driving.set(birthId, { ports, isCurrent: captureAccountLifetime(), running: false });
  }
  if (!driving.has(birthId)) return;
  patchBirth(birthId, { failed: null, retainedSubsteps: undefined });
  void drive(birthId);
}

const REGISTRATION_REFUSED = "It was refused.";

/**
 * Whether the creation this tab made of this Mate saw its registration refused, and nothing has
 * finished it since: its *Finish setup* is offered at once — this tab saw the press end, so no
 * press elsewhere is still at it.
 */
export function registrationUnfinished(
  births: Readonly<Record<string, NewProjectBirth>>,
  projectId: string,
): boolean {
  const made = newProjectBirthOf(births, projectId);
  return (
    made?.progress?.some((entry) => entry.step.kind === "register" && entry.state === "failed") ===
    true
  );
}

/**
 * *Finish setup* ran its steps on a Mate this tab made: its registration, as that press moves,
 * becomes the creation's own — its step under the project's row follows it, and once through the
 * verb is offered no more.
 */
export function refinishNewProjectBirth(
  projectId: string,
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
): void {
  const registration = progress.find((entry) => entry.step.kind === "register");
  if (registration === undefined || registration.state === "queued") return;
  const made = newProjectBirthOf(useNewProjectBirths.getState().births, projectId);
  if (made?.progress == null) return;
  patchBirth(made.birthId, {
    progress: made.progress.map((entry) => (entry.step.kind === "register" ? registration : entry)),
  });
}

/** The creation this tab made whose first Mate's project this is, while the tab holds it. */
export function newProjectBirthOf(
  births: Readonly<Record<string, NewProjectBirth>>,
  projectId: string,
): NewProjectBirth | undefined {
  return Object.values(births).find((birth) => birth.projectId === projectId);
}

// What this tab made lives in its memory alone: a reload, or another account, starts with none.
onAccountLifetimeClose(() => {
  driving.clear();
  useNewProjectBirths.setState({ births: {} });
});

/** The managed services a recipe's yaml names, in its order: none where it names none. */
export function recipeManaged(yaml: string): ReadonlyArray<string> | undefined {
  const managed = (recipeTierServices(yaml) ?? []).flatMap((service) =>
    service.role === "managed" ? [service.hostname] : [],
  );
  return managed.length === 0 ? undefined : managed;
}

/**
 * A New project's press as its dialog draws it, until the first Mate needs no browser: the
 * project's registration, the project itself — its creation's wait
 * part of the press — then its Mate's close-off and registration, from the Mate's own press
 * (`progress`, null before it begins).
 */
export function creationManaged(birth: NewProjectBirth): ReadonlyArray<string> | undefined {
  if (birth.adds === undefined) return undefined;
  const planned = birth.progress?.find(
    (entry) => entry.step.kind === "import-managed" || entry.step.kind === "import-project",
  )?.step;
  if (planned !== undefined && "yaml" in planned) return recipeManaged(planned.yaml);
  return birth.adds.managed;
}

/** The runtimes a recipe's tier brings up once its Mate is closed off: none where it names none. */
export function recipeRuntimes(yaml: string): ReadonlyArray<RecipeRuntime> | undefined {
  return splitRecipeTier(yaml)?.runtimes?.services;
}

/**
 * The runtimes an added Mate's workspace brings, named from the press so its line under the
 * workspace stands from the first frame: as its plan names them once its press is heard, as its
 * recipe did before. A New project's first Mate has none.
 */
export function creationRuntimes(birth: NewProjectBirth): ReadonlyArray<RecipeRuntime> | undefined {
  if (birth.adds === undefined) return undefined;
  for (const entry of birth.progress ?? []) {
    if (entry.step.kind === "import-container") return entry.step.runtimes?.services;
  }
  return birth.adds.runtimes;
}

/**
 * What a Mate's view names before its project lists them — its copy's managed services, its
 * workspace's runtimes: its press's while this tab holds it, then the creation's, which this tab
 * holds all session; so a press over never takes back a line its view drew (run 6's review).
 */
export function comingPlanned(
  press:
    | {
        readonly managed?: ReadonlyArray<string> | undefined;
        readonly runtimes?: ReadonlyArray<RecipeRuntime> | undefined;
      }
    | undefined,
  made: NewProjectBirth | undefined,
): {
  readonly managed?: ReadonlyArray<string>;
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
} {
  const managed = press?.managed ?? (made === undefined ? undefined : creationManaged(made));
  const runtimes = press?.runtimes ?? (made === undefined ? undefined : creationRuntimes(made));
  return {
    ...(managed === undefined ? {} : { managed }),
    ...(runtimes === undefined ? {} : { runtimes }),
  };
}

/** Each step of a press, by the runner's steps that make it. */
const PRESS_KINDS = {
  created: ["create-project", "import-project", "import-managed"],
  container: ["import-container"],
  "closed-off": ["close-off"],
  registered: ["register"],
} as const satisfies Record<string, ReadonlyArray<EnvironmentCreationStep["kind"]>>;

/** A step of the press as its entries say it: stopped, through, under way, or not begun. */
function pressedStep(
  progress: ReadonlyArray<EnvironmentCreationStepProgress> | null,
  kinds: ReadonlyArray<EnvironmentCreationStep["kind"]>,
): { readonly state: ArrivalSubstep["state"]; readonly error?: string } | null {
  const own = (progress ?? []).filter((entry) => kinds.includes(entry.step.kind));
  if (own.length === 0) return null;
  const failed = own.find((entry) => entry.state === "failed");
  if (failed !== undefined) {
    return { state: "failed", ...(failed.error === undefined ? {} : { error: failed.error }) };
  }
  if (own.every((entry) => entry.state === "done")) return { state: "done" };
  return {
    state: own.some((entry) => entry.state === "running" || entry.state === "done")
      ? "active"
      : "waiting",
  };
}

/**
 * The steps this tab runs for a creation, as its view draws them under its project's row: a New
 * project registered and created, then its Mate registered, its container imported and closed
 * off; an added Mate follows the same HQ order after its copy is created. Each step carries its
 * state and the full reason when it stops. A refused registration offers Finish setup.
 */
export function creationSubsteps(birth: NewProjectBirth): ReadonlyArray<ArrivalSubstep> {
  if (birth.progress === null && birth.retainedSubsteps !== undefined)
    return birth.retainedSubsteps;
  const said = (
    id: string,
    label: string,
    state: ArrivalSubstep["state"],
    why?: string,
  ): ArrivalSubstep => ({ id, label, state, ...(why === undefined ? {} : { why }) });
  const fromPress = (id: keyof typeof PRESS_KINDS, label: string): ArrivalSubstep => {
    const step = pressedStep(birth.progress, PRESS_KINDS[id]);
    if (step === null) return said(id, label, "waiting");
    return said(id, label, step.state, step.state === "failed" ? step.error : undefined);
  };
  // A refused registration keeps its reason until Finish setup replaces that step.
  const pressedRegistration = fromPress("registered", `${birth.botName} registered`);
  const registered =
    pressedRegistration.state === "failed"
      ? said(
          "registered",
          "Not registered",
          "unfinished",
          asSentence(pressedRegistration.why ?? "") || REGISTRATION_REFUSED,
        )
      : pressedRegistration;
  if (birth.adds === undefined) {
    const own = (id: string, label: string, step: NewProjectStep): ArrivalSubstep => {
      const state = stateOf(birth, step);
      return said(id, label, state, state === "failed" ? birth.failed?.reason : undefined);
    };
    return [
      own("registered-project", "Registered", "registry"),
      own("created", "Created", "create"),
      registered,
      fromPress("container", "Container"),
      fromPress("closed-off", "Closed off"),
    ];
  }
  // Before the platform took its project the creation says where it stands; after, its press.
  const pressedCreated = pressedStep(birth.progress, PRESS_KINDS.created);
  const created: ArrivalSubstep =
    birth.failed !== null
      ? said("created", "Created", "failed", birth.failed.reason)
      : birth.projectId === null
        ? said("created", "Created", "active")
        : pressedCreated === null
          ? said("created", "Created", "done")
          : said(
              "created",
              "Created",
              pressedCreated.state,
              pressedCreated.state === "failed" ? pressedCreated.error : undefined,
            );
  return [
    created,
    ...(birth.adds.registers ? [registered] : []),
    fromPress("container", "Container"),
    fromPress("closed-off", "Closed off"),
  ];
}
