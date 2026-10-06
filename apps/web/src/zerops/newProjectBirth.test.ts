import type { CreationRead, CreationStepRead } from "@t3tools/client-runtime/data";
import {
  birthCopyServices,
  birthRuntimesFacts,
  deriveBirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type { EnvironmentCreationStepProgress } from "@t3tools/client-runtime/zerops";
import { describe, expect, it, vi } from "vite-plus/test";

import { HQ_UNFOLLOWED } from "./accountOperations";
import { arrivalSteps } from "./mateArrival";
import { PRESS_MAY_HAVE_LANDED } from "./matePress";
import {
  creationEnds,
  comingPlanned,
  creationManaged,
  creationOf,
  creationRunId,
  creationRuntimes,
  creationSubsteps,
  recipeManaged,
  recipeRuntimes,
  newProjectComing,
  newProjectHandOver,
  newProjectProgress,
  newProjectSteps,
  newProjectView,
  placedNewProjects,
  runAdd,
  runNewProjectBirth,
  type CreationAsk,
  type NewProjectAsk,
  type NewProjectBirth,
  type NewProjectPorts,
} from "./newProjectBirth";

/** What Create asked for: Acme CRM, and Vera in it. */
const ASK: NewProjectAsk = {
  organizationId: "org-acme",
  birthId: "b-acme",
  name: "Acme CRM",
  botName: "Vera",
  face: { tint: "rose", shape: "seal" },
  locationId: null,
  agents: [],
};

const PRESSED_AT = Date.parse("2026-09-30T10:00:00.000Z");
const NOW = PRESSED_AT + 5_000;

/** The organization's HQ. */
const HQ = { projectId: "hq-1", address: "https://hq-30db-8080.prg1.zerops.app" } as const;

/** A creation as its view draws it, with — after the take — its Mate's press's progress. */
type Drawn = NewProjectBirth & {
  readonly progress?: ReadonlyArray<EnvironmentCreationStepProgress> | null;
};

/** Acme CRM's creation, pressed at `PRESSED_AT`, in an organization whose HQ stands. */
function birth(over: Partial<Drawn> = {}): Drawn {
  return {
    ...ASK,
    startedAt: PRESSED_AT,
    hq: HQ,
    appId: null,
    intent: null,
    step: "registry",
    failed: null,
    projectId: null,
    ...over,
  };
}

const NO_ROOM = { reason: "No room in this account.", uncertain: false } as const;

/** Each step as `id:state`, the way the line draws them. */
const states = (steps: ReadonlyArray<{ readonly id: string; readonly state: string }>) =>
  steps.map((step) => `${step.id}:${step.state}`);

describe("a New project's own steps, before its first Mate's", () => {
  it.each<{
    readonly case: string;
    readonly birth: NewProjectBirth;
    readonly steps: ReadonlyArray<readonly [string, string, string, string | undefined]>;
  }>([
    {
      case: "it registers the project in HQ, under its name",
      birth: birth(),
      steps: [["registry", "Acme CRM", "active", "Registering the project"]],
    },
    {
      case: "a registration that stopped says why",
      birth: birth({ failed: NO_ROOM }),
      steps: [["registry", "Acme CRM", "failed", "No room in this account."]],
    },
    {
      case: "creating the Mate's project, the project's own is done",
      birth: birth({ step: "create" }),
      steps: [["registry", "Acme CRM", "done", undefined]],
    },
    {
      case: "once the platform took it, still done",
      birth: birth({ step: "created", projectId: "p-vera" }),
      steps: [["registry", "Acme CRM", "done", undefined]],
    },
  ])("$case", ({ birth: made, steps }) => {
    expect(
      newProjectSteps(made).map((step) => [step.id, step.label, step.state, step.detail]),
    ).toEqual(steps);
  });
});

describe("how far a New project's creation has got", () => {
  const MATE_STEPS = ["project", "container", "public-access", "mate", "connect"];

  it.each<{
    readonly case: string;
    readonly birth: NewProjectBirth;
    readonly states: ReadonlyArray<string>;
    readonly detail: string | undefined;
  }>([
    {
      case: "the Mate's steps wait while its project is registered",
      birth: birth(),
      states: ["registry:active", ...MATE_STEPS.map((id) => `${id}:waiting`)],
      detail: "Registering the project",
    },
    {
      case: "creating its project is the Mate's own first step",
      birth: birth({ step: "create" }),
      states: [
        "registry:done",
        "project:active",
        ...MATE_STEPS.slice(1).map((id) => `${id}:waiting`),
      ],
      detail: "Creating the project",
    },
    {
      case: "a creation the platform refused fails the Mate's first step, with its words",
      birth: birth({ step: "create", failed: NO_ROOM }),
      states: [
        "registry:done",
        "project:failed",
        ...MATE_STEPS.slice(1).map((id) => `${id}:waiting`),
      ],
      detail: "No room in this account.",
    },
    {
      case: "a registration that stopped stops every step after it",
      birth: birth({ failed: NO_ROOM }),
      states: ["registry:failed", ...MATE_STEPS.map((id) => `${id}:waiting`)],
      detail: "No room in this account.",
    },
  ])("$case", ({ birth: made, states: expected, detail }) => {
    const progress = newProjectProgress(made, null, NOW);
    expect(states(progress.steps)).toEqual(expected);
    expect((progress.failed ?? progress.active)?.detail).toBe(detail);
    expect(progress.steps.filter((step) => step.state === "active").length).toBeLessThanOrEqual(1);
    expect(progress.total).toBe(expected.length);
    expect(progress.complete).toBe(false);
    // Its clock counts from the press.
    expect(progress.startedAt).toBe("2026-09-30T10:00:00.000Z");
  });

  it("keeps the project's steps before the Mate's own birth once the platform took it", () => {
    const mate = deriveBirthProgress(
      {
        project: { status: "ACTIVE", createdAt: "2026-09-30T10:00:04.000Z" },
        container: { serviceId: "zcp-1", status: "CREATING", hasOrigin: false },
        processes: [],
        health: undefined,
        connection: "none",
      },
      NOW,
    );
    const progress = newProjectProgress(birth({ step: "created", projectId: "p-vera" }), mate, NOW);
    expect(states(progress.steps)).toEqual(["registry:done", ...states(mate.steps)]);
    expect(progress.active?.detail).toBe(mate.active?.detail);
    expect(progress.doneCount).toBe(mate.doneCount + 1);
    // The whole creation's clock, not the Mate's project's.
    expect(progress.startedAt).toBe("2026-09-30T10:00:00.000Z");
  });
});

describe("what its view says under the headline", () => {
  it.each<{
    readonly case: string;
    readonly birth: NewProjectBirth;
    readonly coming: ReturnType<typeof newProjectComing>;
  }>([
    {
      case: "while it runs, it is coming up",
      birth: birth(),
      coming: { kind: "coming", line: "Coming up. A few minutes." },
    },
    {
      case: "a step that stopped says why, and can be tried again",
      birth: birth({ failed: NO_ROOM }),
      coming: { kind: "failed", line: "No room in this account.", verb: "try-again" },
    },
    {
      case: "a reason without words is said for it",
      birth: birth({ failed: { reason: " ", uncertain: false } }),
      coming: { kind: "failed", line: "Could not be set up.", verb: "try-again" },
    },
    {
      case: "a creation the platform may have taken anyway is never pressed twice",
      birth: birth({
        step: "create",
        failed: { reason: "the project may already exist", uncertain: true },
      }),
      coming: { kind: "failed", line: "The project may already exist.", verb: "go-to-projects" },
    },
  ])("$case", ({ birth: made, coming }) => {
    expect(newProjectComing(made)).toEqual(coming);
  });
});

describe("where Create lands", () => {
  it("is the first Mate's own view before anything is made, by the creation's id", () => {
    expect(newProjectView("b-acme")).toEqual({
      to: "/mate/new/$birthId",
      params: { birthId: "b-acme" },
    });
  });

  it.each<{
    readonly case: string;
    readonly birth: NewProjectBirth | undefined;
    readonly to: ReturnType<typeof newProjectHandOver>;
  }>([
    { case: "a creation this tab does not hold", birth: undefined, to: null },
    { case: "a creation under way", birth: birth({ step: "create" }), to: null },
    { case: "a creation that stopped", birth: birth({ failed: NO_ROOM }), to: null },
    {
      case: "a creation the platform took",
      birth: birth({ step: "created", projectId: "p-vera" }),
      to: { to: "/mate/$projectId", params: { projectId: "p-vera" }, replace: true },
    },
  ])("hands its view over for $case", ({ birth: made, to }) => {
    expect(newProjectHandOver(made)).toEqual(to);
  });
});

describe("the menu draws it from the press", () => {
  const PLACED = {
    projectId: "b-acme",
    startedAt: PRESSED_AT,
    step: "tags",
    overdue: false,
    // The platform has not answered with its project: the listing may hold it already.
    awaitingProject: true,
    placement: {
      groupId: "b-acme",
      groupName: "Acme CRM",
      kind: "mate",
      displayName: "Vera",
      face: { tint: "rose", shape: "seal" },
    },
  } as const;

  it.each<{
    readonly case: string;
    readonly births: ReadonlyArray<NewProjectBirth>;
    readonly organizationId: string | undefined;
    readonly placed: ReturnType<typeof placedNewProjects>;
  }>([
    {
      case: "a creation in the organization in view is its project, with its Mate in it",
      births: [birth()],
      organizationId: "org-acme",
      placed: [PLACED],
    },
    {
      case: "one that stopped says so",
      births: [birth({ failed: NO_ROOM })],
      organizationId: "org-acme",
      placed: [{ ...PLACED, failed: true }],
    },
    {
      case: "once HQ named its application, in that group",
      births: [birth({ step: "create", appId: "app-acme" })],
      organizationId: "org-acme",
      placed: [{ ...PLACED, placement: { ...PLACED.placement, groupId: "app-acme" } }],
    },
    {
      case: "one in another organization is not drawn here",
      births: [birth()],
      organizationId: "org-other",
      placed: [],
    },
    {
      case: "nothing is drawn before an organization is in view",
      births: [birth()],
      organizationId: undefined,
      placed: [],
    },
    {
      case: "one the platform took is its birth's to draw",
      births: [birth({ step: "created", projectId: "p-vera" })],
      organizationId: "org-acme",
      placed: [],
    },
  ])("$case", ({ births, organizationId, placed }) => {
    expect(placedNewProjects(births, organizationId)).toEqual(placed);
  });
});

const NOT_SENT: CreationStepRead = { state: "not-sent", attempt: 0 };
const DONE: CreationStepRead = { state: "done", attempt: 1 };
const RUNNING: CreationStepRead = { state: "running", attempt: 1 };
const stopped = (
  kind: string,
  reason: string | null,
  uncertain = false,
  attempt = 1,
): CreationStepRead => ({ state: "stopped", attempt, kind: kind as never, reason, uncertain });

/** Where a creation's steps stand, as its operations say. */
function read(
  over: Omit<Partial<CreationRead>, "steps"> & {
    readonly steps?: Partial<CreationRead["steps"]>;
  } = {},
): CreationRead {
  return {
    appId: null,
    birthId: null,
    projectId: null,
    ...over,
    steps: { app: NOT_SENT, birth: NOT_SENT, project: NOT_SENT, ...over.steps },
  };
}

/** The ask this tab holds of Acme CRM. */
const held = (ask: Partial<NewProjectAsk> = {}, over: Partial<CreationAsk> = {}): CreationAsk => ({
  ask: { ...ASK, ...ask },
  startedAt: PRESSED_AT,
  hq: HQ,
  presses: 1,
  refusedHere: null,
  ...over,
});

const ADDS = { appId: "app-acme", registers: true } as const;

describe("creationOf — where a creation stands, read off its steps' operations", () => {
  it.each<{
    readonly case: string;
    readonly held: CreationAsk;
    readonly read: CreationRead;
    readonly want: Partial<NewProjectBirth>;
  }>([
    {
      case: "a New project nothing of is recorded yet registers",
      held: held(),
      read: read(),
      want: { step: "registry", failed: null, appId: null, intent: null, projectId: null },
    },
    {
      case: "its application answered, HQ's navigation not showing it yet: still in its own group",
      held: held(),
      read: read({ appId: "app-acme", steps: { app: RUNNING } }),
      want: { step: "registry", appId: null, intent: null, failed: null },
    },
    {
      case: "its birth answered, HQ's navigation not showing it yet: no intent of its own yet",
      held: held(),
      read: read({ appId: "app-acme", birthId: "b-vera", steps: { app: DONE, birth: RUNNING } }),
      want: { step: "registry", appId: "app-acme", intent: null },
    },
    {
      case: "its application refused: the registration stops with HQ's words",
      held: held(),
      read: read({
        steps: { app: stopped("create-app", "An application named Acme CRM exists.") },
      }),
      want: {
        step: "registry",
        failed: { reason: "An application named Acme CRM exists.", uncertain: false },
      },
    },
    {
      case: "its birth's end out of HQ's sight: said so, and tried again as it stopped",
      held: held(),
      read: read({
        appId: "app-acme",
        steps: { app: DONE, birth: stopped("record-birth", null, true) },
      }),
      want: {
        step: "registry",
        appId: "app-acme",
        failed: { reason: HQ_UNFOLLOWED, uncertain: false },
      },
    },
    {
      case: "registered: its Mate's project is created, under its birth",
      held: held(),
      read: read({
        appId: "app-acme",
        birthId: "b-vera",
        steps: { app: DONE, birth: DONE, project: RUNNING },
      }),
      want: { step: "create", appId: "app-acme", intent: "b-vera", failed: null },
    },
    {
      case: "its project's end out of sight: it may have landed",
      held: held(),
      read: read({
        appId: "app-acme",
        birthId: "b-vera",
        steps: { app: DONE, birth: DONE, project: stopped("create-project", null, true) },
      }),
      want: { step: "create", failed: { reason: PRESS_MAY_HAVE_LANDED, uncertain: true } },
    },
    {
      case: "its project taken: created, whatever its creation's end",
      held: held(),
      read: read({
        appId: "app-acme",
        birthId: "b-vera",
        projectId: "p-vera",
        steps: { app: DONE, birth: DONE, project: RUNNING },
      }),
      want: { step: "created", projectId: "p-vera", failed: null },
    },
    {
      case: "an Add's birth refused: its copy is not created, for certain",
      held: held({ adds: ADDS }),
      read: read({ steps: { birth: stopped("record-birth", "HQ said no.", true) } }),
      want: {
        step: "create",
        appId: "app-acme",
        failed: { reason: "HQ said no.", uncertain: false },
      },
    },
    {
      case: "an Add's import out of sight: it may have landed",
      held: held({ adds: ADDS }),
      read: read({ steps: { birth: DONE, project: stopped("import-project", null, true) } }),
      want: {
        failed: {
          reason:
            "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.",
          uncertain: true,
        },
      },
    },
    {
      case: "an Add's create out of sight: it may have landed",
      held: held({ adds: ADDS }),
      read: read({ steps: { birth: DONE, project: stopped("create-project", null, true) } }),
      want: {
        failed: { reason: "Zerops did not confirm the project was created.", uncertain: true },
      },
    },
    {
      case: "an Add this tab refused before it sent anything",
      held: held({ adds: ADDS }, { refusedHere: "This project has no recipe merged yet." }),
      read: read(),
      want: { failed: { reason: "This project has no recipe merged yet.", uncertain: false } },
    },
    {
      case: "an Add's birth intent, as HQ recorded it",
      held: held({ adds: ADDS }),
      read: read({ birthId: "hq-birth", steps: { birth: DONE, project: RUNNING } }),
      want: { intent: "hq-birth", failed: null },
    },
  ])("$case", ({ held: asked, read: steps, want }) => {
    expect(creationOf(asked, steps)).toMatchObject(want);
  });

  it("names an Add's presses: its own id, then one per Try again", () => {
    expect(creationRunId(held({ adds: ADDS }))).toBe("b-acme");
    expect(creationRunId(held({ adds: ADDS }, { presses: 2 }))).toBe("b-acme#2");
    // A New project's steps take their next attempt each, under its own id.
    expect(creationRunId(held({}, { presses: 2 }))).toBe("b-acme");
  });
});

/**
 * Ports over a fake account: each step recorded as its operation would be, each call written down
 * in `order` with the request id it was sent under.
 */
function ports(start: CreationRead = read(), over: Partial<NewProjectPorts> = {}) {
  const order: Array<string> = [];
  let now = start;
  const record = (step: keyof CreationRead["steps"], patch: Partial<CreationRead>) => {
    now = { ...now, ...patch, steps: { ...now.steps, [step]: DONE } };
  };
  const made: NewProjectPorts = {
    registerGroup: vi.fn(async (requestId: string, name: string) => {
      order.push(`register ${requestId}:${name}`);
      record("app", { appId: "app-acme" });
      return { appId: "app-acme" };
    }),
    recordBirth: vi.fn(async (requestId: string, { appId, face }) => {
      order.push(`intent ${requestId}:${appId}:${face}`);
      record("birth", { birthId: "b-vera" });
      return { birthId: "b-vera" };
    }),
    createProject: vi.fn(async (requestId: string) => {
      order.push(`create ${requestId}`);
      record("project", { projectId: "p-vera" });
      return { projectId: "p-vera" };
    }),
    accepted: vi.fn((projectId, { hq, appId, intent }) => {
      order.push(`accepted:${projectId}:${hq.projectId}:${appId}:${intent}`);
    }),
    ...over,
  };
  return { order, ports: made, read: () => now };
}

describe("runNewProjectBirth — the project, then its first Mate", () => {
  it("registers the project in the organization's HQ, records its Mate's birth, then creates its Mate", async () => {
    const { order, ports: made, read: now } = ports();
    await runNewProjectBirth(held(), now, made);
    // The registry lives in HQ: the project is registered there before anything is created in it,
    // and its Mate goes into the application HQ named — each step under the creation's own id.
    expect(order).toEqual([
      "register b-acme:app:Acme CRM",
      "intent b-acme:birth:app-acme:rose:seal",
      "create b-acme:project",
      "accepted:p-vera:hq-1:app-acme:b-vera",
    ]);
  });

  it.each<{ readonly case: string; readonly ask: Partial<NewProjectAsk>; readonly args: object }>([
    {
      // The project is named in full, its application's name and its Mate's; its application and
      // face are HQ's, which the press's registration writes.
      case: "named in full under its application, under its birth intent",
      ask: {},
      args: { name: "Acme CRM - Vera", birth: "b-1" },
    },
    {
      // Its agents are its container's, which its press imports.
      case: "in the location chosen",
      ask: { locationId: "prg1", agents: ["claude-code"] },
      args: { name: "Acme CRM - Vera", location: "prg1", birth: "b-1" },
    },
  ])("creates its first Mate $case", async ({ ask, args }) => {
    const { ports: made, read: now } = ports(
      read({ appId: "app-acme", birthId: "b-1", steps: { app: DONE, birth: DONE } }),
    );
    await runNewProjectBirth(held(ask), now, made);
    expect(made.createProject).toHaveBeenCalledWith("b-acme:project", args);
  });

  it.each<{
    readonly case: string;
    readonly over: Partial<NewProjectPorts>;
    readonly order: ReadonlyArray<string>;
  }>([
    {
      case: "a registration HQ refuses creates nothing",
      over: {
        registerGroup: () => Promise.reject(new Error("An application named Acme CRM exists.")),
      },
      order: [],
    },
    {
      case: "a birth intent HQ refuses leaves a registered project, and creates no Mate project",
      over: { recordBirth: () => Promise.reject(new Error("HQ is not answering right now.")) },
      order: ["register b-acme:app:Acme CRM"],
    },
    {
      case: "a creation the platform refused leaves a registered project, and no Mate",
      over: { createProject: () => Promise.reject(new Error("Project name is taken.")) },
      order: ["register b-acme:app:Acme CRM", "intent b-acme:birth:app-acme:rose:seal"],
    },
  ])("stops where it fails: $case", async ({ over, order: expected }) => {
    const { order, ports: fake, read: now } = ports(read(), over);
    await runNewProjectBirth(held(), now, fake);
    expect(order).toEqual(expected);
    expect(fake.accepted).not.toHaveBeenCalled();
  });

  it.each<{
    readonly case: string;
    readonly read: CreationRead;
    readonly order: ReadonlyArray<string>;
  }>([
    {
      case: "a registration that stopped, under its next attempt",
      read: read({ steps: { app: stopped("create-app", "No.") } }),
      order: [
        "register b-acme:app#2:Acme CRM",
        "intent b-acme:birth:app-acme:rose:seal",
        "create b-acme:project",
        "accepted:p-vera:hq-1:app-acme:b-vera",
      ],
    },
    {
      case: "its Mate's birth intent, its application not made again",
      read: read({ appId: "app-1", steps: { app: DONE } }),
      order: [
        "intent b-acme:birth:app-1:rose:seal",
        "create b-acme:project",
        "accepted:p-vera:hq-1:app-1:b-vera",
      ],
    },
    {
      case: "its Mate's creation, with nothing before it made again",
      read: read({
        appId: "app-1",
        birthId: "b-1",
        steps: { app: DONE, birth: DONE, project: stopped("create-project", "No room.") },
      }),
      order: ["create b-acme:project#2", "accepted:p-vera:hq-1:app-1:b-1"],
    },
    {
      case: "nothing, while a step is still under way",
      read: read({ steps: { app: RUNNING } }),
      order: [],
    },
    {
      case: "nothing, once the platform took it",
      read: read({ projectId: "p-vera", steps: { app: DONE, birth: DONE, project: RUNNING } }),
      order: [],
    },
  ])("resumes from the step it stopped on: $case", async ({ read: start, order: expected }) => {
    const { order, ports: fake, read: now } = ports(start);
    await runNewProjectBirth(held(), now, fake);
    expect(order).toEqual(expected);
  });
});

// Run 6's review: an Add's port flattened its stop to a string, so one Zerops may have made
// offered Try again, which made a second; and a run that threw left Created spinning for good.
describe("runAdd — an Add's press, under its press's id", () => {
  const STEP = { kind: "create-project", name: "Ida", tagList: [] } as never;
  it.each<{
    readonly case: string;
    readonly run: () => Promise<never> | Promise<unknown>;
    readonly taken?: boolean;
    readonly refused: ReadonlyArray<string>;
  }>([
    {
      case: "taken, then through: nothing of its own to say",
      run: async () => ({ kind: "ran", outcome: { ok: true, projectId: "p-ida" } }),
      taken: true,
      refused: [],
    },
    {
      case: "stopped before the platform took it: its operation says why",
      run: async () => ({
        kind: "ran",
        outcome: { ok: false, projectId: undefined, failedStep: STEP, error: "No room." },
      }),
      refused: [],
    },
    {
      case: "refused here before anything was asked: why",
      run: async () => ({ kind: "refused", reason: "This project has no recipe merged yet." }),
      refused: ["This project has no recipe merged yet."],
    },
    {
      case: "refused here without words: said for it",
      run: async () => ({ kind: "refused", reason: null }),
      refused: ["It could not be added."],
    },
    {
      case: "a run that threw before the platform took it: why",
      run: () => Promise.reject(new Error("The press could not start.")),
      refused: ["The press could not start."],
    },
    {
      case: "a run that threw after the platform took it: its press's to say",
      run: () => Promise.reject(new Error("The press could not finish.")),
      taken: true,
      refused: [],
    },
  ])("$case", async ({ run, taken = false, refused }) => {
    const press = vi.fn((_creationId: string) => run() as never);
    const said: Array<string> = [];
    await runAdd(
      held({ adds: ADDS }, { presses: 2 }),
      () => read(taken ? { projectId: "p-ida" } : {}),
      press,
      (reason) => said.push(reason),
    );
    expect(press).toHaveBeenCalledWith("b-acme#2");
    expect(said).toEqual(refused);
  });
});

type Kind =
  | "create-project"
  | "import-managed"
  | "import-container"
  | "close-off"
  | "register"
  | "await-ready";
type RunState = "queued" | "running" | "done" | "failed";

/** A press's progress: each step's kind and state, in order, with what a stop said. */
const pressed = (...entries: ReadonlyArray<readonly [Kind, RunState]>) =>
  entries.map(([kind, state]) => ({
    step:
      kind === "create-project"
        ? ({ kind, name: "Ida" } as never)
        : kind === "import-managed"
          ? ({ kind, yaml: "" } as never)
          : kind === "import-container"
            ? ({ kind, agents: [] } as never)
            : ({ kind } as never),
    state,
    ...(state === "failed" ? { error: `${kind} said no.` } : {}),
  }));

/** Ida added to Acme CRM, from Add: a Mate into a project that stands. */
const added = (over: Partial<Drawn> = {}) =>
  birth({
    birthId: "add-1",
    appId: "app-acme",
    botName: "Ida",
    adds: { appId: "app-acme", registers: true },
    step: "create",
    ...over,
  });

/** Each sub-step as `label:state`, with why where it stopped. */
const drawnSubsteps = (made: Drawn) =>
  creationSubsteps(made, made.progress ?? null).map(
    (step) => `${step.label}:${step.state}${step.why === undefined ? "" : ` (${step.why})`}`,
  );

// Run 6 (the owner, 2026-10-03: "why are these two screens separate?"): the steps this tab runs
// are the project's row's own on the Mate's page, from the press until its hand-over.
describe("creationSubsteps — a New project's steps this tab runs, under its row", () => {
  it.each([
    {
      case: "registering",
      made: birth(),
      want: [
        "Registered:active",
        "Created:waiting",
        "Vera registered:waiting",
        "Container:waiting",
        "Closed off:waiting",
      ],
    },
    {
      case: "a registration that stopped",
      made: birth({ failed: NO_ROOM }),
      want: [
        "Registered:failed (No room in this account.)",
        "Created:waiting",
        "Vera registered:waiting",
        "Container:waiting",
        "Closed off:waiting",
      ],
    },
    {
      case: "creating its Mate's project",
      made: birth({ step: "create" }),
      want: [
        "Registered:done",
        "Created:active",
        "Vera registered:waiting",
        "Container:waiting",
        "Closed off:waiting",
      ],
    },
    {
      case: "taken, its Mate's press not yet heard",
      made: birth({ step: "created", projectId: "p-1" }),
      want: [
        "Registered:done",
        "Created:done",
        "Vera registered:waiting",
        "Container:waiting",
        "Closed off:waiting",
      ],
    },
    {
      case: "closing off",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(
          ["close-off", "running"],
          ["register", "queued"],
          ["await-ready", "queued"],
        ),
      }),
      want: [
        "Registered:done",
        "Created:done",
        "Vera registered:waiting",
        "Container:waiting",
        "Closed off:active",
      ],
    },
    {
      case: "a close-off that stopped",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(["close-off", "failed"], ["register", "queued"]),
      }),
      want: [
        "Registered:done",
        "Created:done",
        "Vera registered:waiting",
        "Container:waiting",
        "Closed off:failed (close-off said no.)",
      ],
    },
    {
      case: "a registration refused: not registered, and why",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(["close-off", "done"], ["register", "failed"], ["await-ready", "done"]),
      }),
      want: [
        "Registered:done",
        "Created:done",
        "Not registered:unfinished (Register said no.)",
        "Container:waiting",
        "Closed off:done",
      ],
    },
    {
      case: "through",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(["close-off", "done"], ["register", "done"], ["await-ready", "running"]),
      }),
      want: [
        "Registered:done",
        "Created:done",
        "Vera registered:done",
        "Container:waiting",
        "Closed off:done",
      ],
    },
  ])("$case", ({ made, want }) => {
    expect(drawnSubsteps(made)).toEqual(want);
  });
});

describe("creationSubsteps — an added Mate's steps this tab runs, under its copy", () => {
  it.each([
    {
      case: "pressed, its plan not yet made",
      made: added(),
      want: ["Created:active", "Ida registered:waiting", "Container:waiting", "Closed off:waiting"],
    },
    {
      case: "where its registration is nobody's here to write",
      made: added({ adds: { appId: "app-acme", registers: false } }),
      want: ["Created:active", "Container:waiting", "Closed off:waiting"],
    },
    {
      case: "creating its project",
      made: added({
        progress: pressed(
          ["create-project", "running"],
          ["import-managed", "queued"],
          ["import-container", "queued"],
          ["close-off", "queued"],
          ["register", "queued"],
        ),
      }),
      want: ["Created:active", "Ida registered:waiting", "Container:waiting", "Closed off:waiting"],
    },
    {
      case: "refused before the platform took it",
      made: added({ failed: NO_ROOM }),
      want: [
        "Created:failed (No room in this account.)",
        "Ida registered:waiting",
        "Container:waiting",
        "Closed off:waiting",
      ],
    },
    {
      case: "taken, its container coming",
      made: added({
        step: "created",
        projectId: "p-ida",
        progress: pressed(
          ["create-project", "done"],
          ["import-managed", "done"],
          ["import-container", "running"],
          ["close-off", "queued"],
          ["register", "queued"],
        ),
      }),
      want: ["Created:done", "Ida registered:waiting", "Container:active", "Closed off:waiting"],
    },
    {
      case: "a container that stopped",
      made: added({
        step: "created",
        projectId: "p-ida",
        progress: pressed(
          ["create-project", "done"],
          ["import-container", "failed"],
          ["close-off", "queued"],
          ["register", "queued"],
        ),
      }),
      want: [
        "Created:done",
        "Ida registered:waiting",
        "Container:failed (import-container said no.)",
        "Closed off:waiting",
      ],
    },
    {
      case: "through",
      made: added({
        step: "created",
        projectId: "p-ida",
        progress: pressed(
          ["create-project", "done"],
          ["import-container", "done"],
          ["close-off", "done"],
          ["register", "done"],
          ["await-ready", "running"],
        ),
      }),
      want: ["Created:done", "Ida registered:done", "Container:done", "Closed off:done"],
    },
    {
      case: "a registration refused: Ida runs on, not registered, and why",
      made: added({
        step: "created",
        projectId: "p-ida",
        progress: pressed(
          ["create-project", "done"],
          ["import-container", "done"],
          ["close-off", "done"],
          ["register", "failed"],
          ["await-ready", "done"],
        ),
      }),
      want: [
        "Created:done",
        "Not registered:unfinished (Register said no.)",
        "Container:done",
        "Closed off:done",
      ],
    },
  ])("$case", ({ made, want }) => {
    expect(drawnSubsteps(made)).toEqual(want);
  });
});

describe("an added Mate held from the press", () => {
  // Its row draws the Mate's own name; its project is named in full after its application.
  it("is placed in its project by its own id, its project named as Add named it", () => {
    expect(placedNewProjects([added()], ASK.organizationId)).toEqual([
      expect.objectContaining({
        projectId: "add-1",
        awaitingProject: true,
        placement: expect.objectContaining({
          groupId: "app-acme",
          groupName: "Acme CRM",
          displayName: "Ida",
        }),
      }),
    ]);
  });

  it("brings no project steps of its own: its copy is its first row", () => {
    expect(newProjectSteps(added())).toEqual([]);
  });
});

describe("creationManaged — the managed services an added Mate's copy waits on, from the press", () => {
  const TIER =
    "services:\n  - hostname: db\n    type: postgresql@16\n  - hostname: appdev\n    type: nodejs@22\n    zeropsSetup: dev\n";
  it.each([
    { case: "a New project's first Mate: none of its own", made: birth(), want: undefined },
    {
      case: "pressed: as its recipe names them",
      made: added({
        adds: {
          appId: "app-acme",
          registers: true,
          managed: ["db"],
        },
      }),
      want: ["db"],
    },
    {
      case: "a recipe that brings none",
      made: added({ adds: { appId: "app-acme", registers: true } }),
      want: undefined,
    },
  ])("$case", ({ made, want }) => {
    expect(creationManaged(made)).toEqual(want);
  });

  it("reads a tier's managed services, never its runtimes", () => {
    expect(recipeManaged(TIER)).toEqual(["db"]);
    expect(recipeManaged("services: []\n")).toBeUndefined();
  });
});

// Run 6's review: an Add's runtimes line was drawn on its Mate's view from its press alone — none
// on `/mate/new`, then the press's, then none again once the press was over, until the container
// answered: the rows moved down, up and down.
describe("creationRuntimes — the runtimes an added Mate's workspace brings, from the press", () => {
  const TIER =
    "services:\n  - hostname: db\n    type: postgresql@16\n  - hostname: appdev\n    type: nodejs@22\n    zeropsSetup: dev\n";
  const APP = [{ hostname: "appdev", role: "dev" }] as const;
  it.each([
    { case: "a New project's first Mate brings none", made: birth(), want: undefined },
    {
      case: "pressed: as its recipe names them",
      made: added({
        adds: { appId: "app-acme", registers: true, runtimes: APP },
      }),
      want: APP,
    },
  ])("$case", ({ made, want }) => {
    expect(creationRuntimes(made)).toEqual(want);
  });

  it("reads a tier's runtimes, never its managed services", () => {
    expect(recipeRuntimes(TIER)).toEqual(APP);
    expect(
      recipeRuntimes("services:\n  - hostname: db\n    type: postgresql@16\n"),
    ).toBeUndefined();
  });
});

describe("comingPlanned — what a Mate's view names before its project lists it", () => {
  const made = added({
    step: "created",
    projectId: "p-ida",
    adds: {
      appId: "app-acme",
      registers: true,
      managed: ["db"],
      runtimes: [{ hostname: "appdev", role: "dev" }],
    },
  });
  // The press's plan names what the recipe read at the press did not: the press's comes first.
  const press = {
    managed: ["db", "cache"],
    runtimes: [
      { hostname: "appdev", role: "dev" as const },
      { hostname: "workerdev", role: "dev" as const },
    ],
  };
  const creation = { managed: ["db"], runtimes: [{ hostname: "appdev", role: "dev" as const }] };
  it.each([
    { case: "its press held: the press's, over the creation's", press, made, want: press },
    {
      case: "its press over, its creation held: the creation's",
      press: undefined,
      made,
      want: creation,
    },
    { case: "held by neither", press: undefined, made: undefined, want: {} },
  ])("$case", ({ press: held, made: holding, want }) => {
    expect(comingPlanned(held, holding)).toEqual(want);
  });

  it("keeps an added Mate's rows and their lines from the press through the hand-over and the press's end", () => {
    const pressedAdd = added({
      adds: {
        appId: "app-acme",
        registers: true,
        managed: ["db"],
        runtimes: [{ hostname: "appdev", role: "dev" }],
      },
    });
    /** Each row with what its line names: `id[name, …]`. */
    const rows = (progress: Parameters<typeof arrivalSteps>[0]) =>
      arrivalSteps(progress, { name: "Ida", project: "Acme CRM" }, NOW).map(
        (step) => `${step.id}[${(step.services ?? []).map((service) => service.name).join(",")}]`,
      );
    const managedOf = (planned: ReadonlyArray<string> | undefined) =>
      birthCopyServices({ planned, services: undefined });
    // On `/mate/new`, from the press.
    const before = rows({
      ...newProjectProgress(pressedAdd, null, NOW),
      managed: managedOf(creationManaged(pressedAdd)),
    });
    // On `/mate/$projectId`, its press held, then over.
    const mateView = (held: typeof press | undefined) => {
      const planned = comingPlanned(held, { ...pressedAdd, step: "created", projectId: "p-ida" });
      return rows({
        ...deriveBirthProgress(
          {
            project: { status: "ACTIVE" },
            container: undefined,
            processes: [],
            health: undefined,
            connection: "none",
            runtimes: birthRuntimesFacts({ planned: planned.runtimes, services: undefined }),
          },
          NOW,
        ),
        managed: managedOf(planned.managed),
      });
    };
    expect(before).toEqual(["copy[db]", "workspace[appdev]", "you[]"]);
    expect(mateView(creation)).toEqual(before);
    expect(mateView(undefined)).toEqual(before);
  });
});

// Run 6's review: an Add refused before Zerops took anything (quota, rights) stood in the menu all
// session, failed, its one way on Try again with the same name.
describe("creationEnds — a creation that stopped can end", () => {
  const refused = added({ failed: { reason: "No room.", uncertain: false } });
  it.each([
    {
      case: "an Add refused for certain: dismissed, or started over with its name to change",
      made: refused,
      want: {
        startOver: {
          groupId: "app-acme",
          again: { botName: "Ida", tint: "rose", shape: "seal" },
        },
      },
    },
    // Run 6's second review: the menu showed the listed Ida beside a failed Ida all session.
    {
      case: "an Add Zerops may have made: dismissed, never started over",
      made: added({ failed: { reason: "Lost.", uncertain: true } }),
      want: { startOver: null },
    },
    {
      case: "a New project Zerops may have made: dismissed",
      made: birth({ step: "create", failed: { reason: "Lost.", uncertain: true } }),
      want: { startOver: null },
    },
    { case: "running: neither", made: added(), want: null },
    {
      case: "taken by Zerops: its press's to finish",
      made: added({ step: "created", projectId: "p-ida" }),
      want: null,
    },
    {
      case: "a New project refused for certain: its own Try again",
      made: birth({ failed: { reason: "No room.", uncertain: false } }),
      want: null,
    },
  ])("$case", ({ made, want }) => {
    expect(creationEnds(made)).toEqual(want);
  });
});

// Run 6's second review: an owner whose broker grant timed out read "An owner registers Ida for
// Git." with a hollow mark, never why. The step keeps why while its press is held, and follows
// Finish setup's own press.
describe("a registration not finished, and Finish setup's own steps", () => {
  const made = added({ step: "created", projectId: "p-ida" });
  it.each([
    {
      case: "refused by its press: not registered, and why",
      progress: pressed(
        ["create-project", "done"],
        ["import-container", "done"],
        ["close-off", "done"],
        ["register", "failed"],
        ["await-ready", "done"],
      ),
      want: "Not registered:unfinished (Register said no.)",
    },
    {
      case: "Finish setup registering",
      progress: pressed(["close-off", "done"], ["register", "running"]),
      want: "Ida registered:active",
    },
    {
      case: "Finish setup registered",
      progress: pressed(["close-off", "done"], ["register", "done"]),
      want: "Ida registered:done",
    },
    {
      case: "Finish setup refused again: the new reason",
      progress: [
        { step: { kind: "close-off" } as never, state: "done" as const },
        {
          step: { kind: "register" } as never,
          state: "failed" as const,
          error: "Still no grant.",
        },
      ],
      want: "Not registered:unfinished (Still no grant.)",
    },
  ])("draws its registration: $case", ({ progress, want }) => {
    expect(
      drawnSubsteps({ ...made, progress }).find(
        (step) => step.startsWith("Ida registered:") || step.startsWith("Not registered:"),
      ),
    ).toBe(want);
  });
});
