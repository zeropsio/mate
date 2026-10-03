/**
 * *New project*, from the press of Create: the project and its first Mate in one step, drawn at
 * once where the Mate will live — its own view (`/mate/new/$birthId`) and its row in the left menu
 * — before the platform has made anything (the owner, 2026-09-30: "you should add the project and
 * the first mate in the same step, then you should go to the mate detail and the only diff would
 * be the progress").
 *
 * A New project's creation takes, in order:
 * - `gitea` — the account's Git hosting, where it has none: the registry lives on it. A reconcile
 *   (`createToolProject`): a second try picks up where the first stopped.
 * - `registry` — the project's registry entry (`mate:gn:{groupId}:{slug}`), which is what makes
 *   the project exist. Written again for the same group, it reads its own write back and changes
 *   nothing.
 * - `create` — its first Mate's Zerops project, tagged into the project at birth. Once the platform
 *   takes it the Mate's birth carries the rest (`zeropsBirths.ts`), and the view hands the route to
 *   the Mate's own (`/mate/$projectId`), in its place.
 *
 * Until then this tab holds the creation — how far it got, and where it stopped and why — and
 * nothing else does: a reload forgets it, as it forgets an Add a Mate the platform has not taken
 * (`newMate.ts`). Each creation is keyed by the project's group, made on the press. A step that
 * stops says why on the view, with *Try again*, which resumes from that step with the same group —
 * except a creation the platform may have taken anyway (`uncertain`), which a second try could
 * make twice.
 */
import {
  recipeTierServices,
  splitRecipeTier,
  ZeropsApiError,
  type BirthPlacement,
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
import type { ProjectTagWrite } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { create } from "zustand";

import type {
  BirthLineProgress,
  BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
import { COMING_UP_LINE, NOT_SET_UP_LINE } from "../components/zerops/ZeropsProjectRow.logic";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import type { ArrivalSubstep } from "./mateArrival";
import { asSentence, type MateComing } from "./mateComing";
import { newMateView } from "./newMate";

/** A step of a New project's creation, before the platform has taken its first Mate's project. */
export type NewProjectStep = "gitea" | "registry" | "create";

/** What Create asked for: the project, its first Mate, and where. */
export interface NewProjectAsk {
  readonly organizationId: string;
  /** The project's group, made on the press: the creation's own id too. */
  readonly groupId: string;
  /** The project's name. */
  readonly name: string;
  /** Its first Mate's name. */
  readonly botName: string;
  readonly face: ZeropsMateFace;
  readonly locationId: string | null;
  /** Empty for every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`). */
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  /** Who pressed Create: the person whose sign-in its first Mate waits for (`mate:by:`). */
  readonly madeBy?: string | undefined;
  /**
   * Add a Mate, not a New project: the Mate goes into the project `name` that stands — no Git
   * hosting or registration of the project's own — its environment called `displayName`, and
   * its own registration written where `registers`.
   */
  readonly adds?:
    | {
        readonly displayName: string;
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
  /** The creation's own id, its view's (`newProjectView`): a New project's group, an Add's own. */
  readonly id: string;
  /** When Create was pressed, wall ms: the view's clock counts from here. */
  readonly startedAt: number;
  /** The account had no Git hosting when Create was pressed: standing it up is a step. */
  readonly withGitea: boolean;
  /** The account's Gitea project, where the registry lives, once it stands. */
  readonly giteaProjectId: string | null;
  /** The step running, or — `failed` — the one that stopped it; `created` once the platform took the Mate's project. */
  readonly step: NewProjectStep | "created";
  readonly failed: NewProjectFailure | null;
  /** The first Mate's Zerops project, once the platform took it. */
  readonly projectId: string | null;
  /** Its Mate's press, each step's state as it moves; null before it is heard. */
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress> | null;
}

export type NewProjectPatch = Partial<
  Pick<NewProjectBirth, "step" | "giteaProjectId" | "failed" | "projectId" | "progress">
>;

/** What the first Mate's project is created with (`createProjectWithMate`). */
export interface NewProjectCreation {
  readonly name: string;
  readonly location?: string;
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  readonly group: { readonly groupId: string; readonly role: "dev"; readonly label: string };
  readonly botName: string;
  readonly face: ZeropsMateFace;
  /** Who made it (`mate:by:`). */
  readonly madeBy?: string;
}

/** What a New project's creation acts through: the platform, and the birth it hands over to. */
export interface NewProjectPorts {
  /** Stands the account's Gitea up. */
  readonly ensureGitea: () => Promise<{ readonly projectId: string }>;
  /**
   * Writes `mate:gn:{groupId}:{slug}` on the account's Gitea project: a patch the TagWriter
   * applies to its tags as they are — the fresh project's `mate:tool:gitea` kept.
   */
  readonly registerGroup: (registration: {
    readonly giteaProjectId: string;
    readonly groupId: string;
    readonly name: string;
  }) => Promise<ProjectTagWrite>;
  readonly createProject: (
    creation: NewProjectCreation,
  ) => Promise<{ readonly project: Pick<ZeropsProject, "id"> }>;
  /**
   * The platform took the first Mate's project: its birth begins (`creationAccepted`), on the
   * creation's own clock — `startedAt` is the press's, so its row counts on, never from 0:00.
   */
  readonly accepted: (projectId: string, giteaProjectId: string | null, startedAt: number) => void;
}

// ── What its surfaces draw ───────────────────────────────────────────────────────────────────

/**
 * Where the project and its first Mate stand in the account's projects, as the creation knows
 * them: its row in the menu from the press, and its birth's from the moment the platform takes it.
 */
export function newProjectPlacement(ask: NewProjectAsk): BirthPlacement {
  return {
    groupId: ask.groupId,
    groupName: ask.name,
    kind: "mate",
    // The group has no project of its own; its first Mate is named after its bot, the way every
    // Mate added afterwards is — "Acme CRM - Vera"; an added one as Add named it.
    displayName: ask.adds?.displayName ?? `${ask.name} - ${ask.botName}`,
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
            projectId: birth.id,
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

const ORDER: ReadonlyArray<NewProjectBirth["step"]> = ["gitea", "registry", "create", "created"];

/** A step's state: done once the creation is past it, and the running one active or failed. */
function stateOf(birth: NewProjectBirth, own: NewProjectStep): BirthLineStep["state"] {
  const at = ORDER.indexOf(birth.step);
  const mine = ORDER.indexOf(own);
  if (mine < at) return "done";
  if (mine > at) return "waiting";
  return birth.failed === null ? "active" : "failed";
}

/**
 * The project's own steps, before its first Mate's: Git hosting where the account had none, then
 * the project's registration, under the project's name.
 */
export function newProjectSteps(birth: NewProjectBirth): ReadonlyArray<BirthLineStep> {
  // An added Mate's project stands: its copy is its first row.
  if (birth.adds !== undefined) return [];
  const step = (id: string, label: string, own: NewProjectStep, doing: string): BirthLineStep => {
    const state = stateOf(birth, own);
    const detail =
      state === "active" ? doing : state === "failed" ? birth.failed?.reason : undefined;
    return { id, label, state, ...(detail === undefined ? {} : { detail }) };
  };
  return [
    ...(birth.withGitea
      ? [step("git-hosting", "Git hosting", "gitea", "Setting up Git hosting")]
      : []),
    step("registry", birth.name, "registry", "Registering the project"),
  ];
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
 * The order is the point: the registry lives on the Gitea project, so an account without one gets
 * it first (the first project brings Git hosting along; nobody is told to add it); the registry
 * entry is what makes the project exist, and a Mate created before it would be a Mate in a project
 * nobody has heard of. Git hosting that cannot be stood up creates nothing; a registry write that
 * fails creates nothing; a Mate's creation that fails leaves a registered project with no Mate in
 * it, which is one the person can add a Mate to, not a mess to clean up.
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

  let giteaProjectId = birth.giteaProjectId;
  if (birth.step === "gitea") {
    try {
      giteaProjectId = (await ports.ensureGitea()).projectId;
    } catch (cause) {
      stop(zeropsErrorMessage(cause));
      return;
    }
    moved({ step: "registry", giteaProjectId });
  }

  if (birth.step !== "create") {
    if (giteaProjectId === null) {
      stop("Git hosting is not set up.");
      return;
    }
    try {
      const registered = await ports.registerGroup({
        giteaProjectId,
        groupId: birth.groupId,
        name: birth.name,
      });
      if (registered.kind === "refused") {
        stop(registered.refusal.reason);
        return;
      }
    } catch (cause) {
      stop(zeropsErrorMessage(cause));
      return;
    }
    moved({ step: "create" });
  }

  let projectId: string;
  try {
    const created = await ports.createProject({
      name: newProjectPlacement(birth).displayName,
      ...(birth.locationId === null ? {} : { location: birth.locationId }),
      agents: birth.agents,
      group: { groupId: birth.groupId, role: "dev", label: birth.name },
      botName: birth.botName,
      face: birth.face,
      ...(birth.madeBy === undefined ? {} : { madeBy: birth.madeBy }),
    });
    projectId = created.project.id;
  } catch (cause) {
    stop(zeropsErrorMessage(cause), isUncertain(cause));
    return;
  }
  // Its birth begins, and its view moves to it, in one breath: the menu draws its row from one or
  // the other, never neither.
  ports.accepted(projectId, giteaProjectId, birth.startedAt);
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
        accepted: (projectId, giteaProjectId, startedAt) => {
          if (held.isCurrent()) held.ports.accepted(projectId, giteaProjectId, startedAt);
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
 * Create was pressed: the creation is held from now, and runs. Its id — its project's group — is
 * where its first Mate's view is (`newProjectView`).
 */
export function beginNewProjectBirth(input: {
  readonly ask: NewProjectAsk;
  /** The account's Gitea, as the inventory names it — or none yet. */
  readonly gitea: { readonly projectId: string } | undefined;
  readonly ports: NewProjectPorts;
  /** Wall ms. */
  readonly now: number;
  /** An Add's own id; a New project's is its group's. */
  readonly id?: string;
}): string {
  const birthId = input.id ?? input.ask.groupId;
  const adds = input.ask.adds !== undefined;
  const birth: NewProjectBirth = {
    ...input.ask,
    id: birthId,
    startedAt: input.now,
    withGitea: !adds && input.gitea === undefined,
    giteaProjectId: input.gitea?.projectId ?? null,
    step: adds ? "create" : input.gitea === undefined ? "gitea" : "registry",
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
  patchBirth(birthId, { progress });
}

/** *Try again* on a creation a step stopped: it resumes from that step, with the same project. */
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

/** The managed services a recipe's yaml names, in its order: none where it names none. */
export function recipeManaged(yaml: string): ReadonlyArray<string> | undefined {
  const managed = (recipeTierServices(yaml) ?? []).flatMap((service) =>
    service.role === "managed" ? [service.hostname] : [],
  );
  return managed.length === 0 ? undefined : managed;
}

/**
 * The managed services an added Mate's copy waits on, named from the press so its line under the
 * copy stands from the first frame: as its plan names them once its press is heard, as its recipe
 * did before. A New project's first Mate has none of its own.
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
 * project registered and created, then its Mate closed off and registered; an added Mate's copy
 * created, its container, closed off and registered. Each in its state, and one that stopped with
 * why — a registration refused left to an owner, with who finishes it, never a stop.
 */
export function creationSubsteps(birth: NewProjectBirth): ReadonlyArray<ArrivalSubstep> {
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
  // A Mate's registration comes after its close-off, and the press goes on past a refusal: the
  // Mate runs, and an owner registers it (*Finish setup*). Nothing stopped.
  const leftToOwner = (step: ArrivalSubstep, who: string): ArrivalSubstep =>
    step.state === "failed" ? said(step.id, step.label, "owner", who) : step;
  const registered = leftToOwner(
    fromPress("registered", `${birth.botName} registered`),
    `An owner registers ${birth.botName} for Git.`,
  );
  if (birth.adds === undefined) {
    const own = (id: string, label: string, step: NewProjectStep): ArrivalSubstep => {
      const state = birth.step === "gitea" ? "waiting" : stateOf(birth, step);
      return said(id, label, state, state === "failed" ? birth.failed?.reason : undefined);
    };
    return [
      own("registered-project", "Registered", "registry"),
      own("created", "Created", "create"),
      fromPress("closed-off", "Closed off"),
      registered,
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
    fromPress("container", "Container"),
    fromPress("closed-off", "Closed off"),
    ...(birth.adds.registers ? [registered] : []),
  ];
}
