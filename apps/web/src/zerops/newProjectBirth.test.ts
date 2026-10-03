import {
  birthCopyServices,
  birthRuntimesFacts,
  deriveBirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type { ProjectTagWrite } from "@t3tools/client-runtime/zerops/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isUncertainZeropsFailure } from "@t3tools/client-runtime/zerops/errors";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { arrivalSteps } from "./mateArrival";
import { useNewMate } from "./newMate";
import {
  beginNewProjectBirth,
  newProjectComing,
  newProjectHandOver,
  newProjectProgress,
  newProjectSteps,
  newProjectView,
  placedNewProjects,
  retryNewProjectBirth,
  runNewProjectBirth,
  useNewProjectBirths,
  type NewProjectAsk,
  type NewProjectBirth,
  type NewProjectPatch,
  type NewProjectPorts,
  addCreateProject,
  creationEnds,
  comingPlanned,
  dismissNewProjectBirth,
  startAddOver,
  creationManaged,
  creationRuntimes,
  creationSubsteps,
  recipeManaged,
  recipeRuntimes,
  progressNewProjectBirth,
  refinishNewProjectBirth,
  registrationUnfinished,
} from "./newProjectBirth";

/** What Create asked for: Acme CRM, and Vera in it. */
const ASK: NewProjectAsk = {
  organizationId: "org-acme",
  groupId: "g-acme",
  name: "Acme CRM",
  botName: "Vera",
  face: { tint: "rose", shape: "seal" },
  locationId: null,
  agents: [],
};

const PRESSED_AT = Date.parse("2026-09-30T10:00:00.000Z");
const NOW = PRESSED_AT + 5_000;

/** Acme CRM's creation, pressed at `PRESSED_AT`, on an account whose Git hosting stands. */
function birth(over: Partial<NewProjectBirth> = {}): NewProjectBirth {
  return {
    ...ASK,
    id: ASK.groupId,
    startedAt: PRESSED_AT,
    withGitea: false,
    giteaProjectId: "gitea-1",
    step: "registry",
    failed: null,
    projectId: null,
    progress: null,
    ...over,
  };
}

/** The same creation on an account that had no Git hosting when Create was pressed. */
const bare = (over: Partial<NewProjectBirth> = {}) =>
  birth({ withGitea: true, giteaProjectId: null, step: "gitea", ...over });

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
      case: "an account with Git hosting registers the project, under its name",
      birth: birth(),
      steps: [["registry", "Acme CRM", "active", "Registering the project"]],
    },
    {
      case: "an account without stands Git hosting up first",
      birth: bare(),
      steps: [
        ["git-hosting", "Git hosting", "active", "Setting up Git hosting"],
        ["registry", "Acme CRM", "waiting", undefined],
      ],
    },
    {
      case: "Git hosting that could not be stood up says why, and nothing after it begins",
      birth: bare({ failed: NO_ROOM }),
      steps: [
        ["git-hosting", "Git hosting", "failed", "No room in this account."],
        ["registry", "Acme CRM", "waiting", undefined],
      ],
    },
    {
      case: "a registration that stopped says why",
      birth: birth({ withGitea: true, failed: NO_ROOM }),
      steps: [
        ["git-hosting", "Git hosting", "done", undefined],
        ["registry", "Acme CRM", "failed", "No room in this account."],
      ],
    },
    {
      case: "creating the Mate's project, the project's own are done",
      birth: birth({ withGitea: true, step: "create" }),
      steps: [
        ["git-hosting", "Git hosting", "done", undefined],
        ["registry", "Acme CRM", "done", undefined],
      ],
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
      case: "and while Git hosting is stood up",
      birth: bare(),
      states: [
        "git-hosting:active",
        "registry:waiting",
        ...MATE_STEPS.map((id) => `${id}:waiting`),
      ],
      detail: "Setting up Git hosting",
    },
    {
      case: "creating its project is the Mate's own first step",
      birth: birth({ withGitea: true, step: "create" }),
      states: [
        "git-hosting:done",
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
    const progress = newProjectProgress(
      birth({ withGitea: true, step: "created", projectId: "p-vera" }),
      mate,
      NOW,
    );
    expect(states(progress.steps)).toEqual([
      "git-hosting:done",
      "registry:done",
      ...states(mate.steps),
    ]);
    expect(progress.active?.detail).toBe(mate.active?.detail);
    expect(progress.doneCount).toBe(mate.doneCount + 2);
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
    expect(newProjectView("g-acme")).toEqual({
      to: "/mate/new/$birthId",
      params: { birthId: "g-acme" },
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
    projectId: "g-acme",
    startedAt: PRESSED_AT,
    step: "tags",
    overdue: false,
    // The platform has not answered with its project: the menu takes the listed one for it.
    awaitingProject: true,
    placement: {
      groupId: "g-acme",
      groupName: "Acme CRM",
      kind: "mate",
      displayName: "Acme CRM - Vera",
      botName: "Vera",
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

const PROJECT = { id: "p-vera", name: "Acme CRM - Vera", status: "ACTIVE" } as const;
const WRITTEN: ProjectTagWrite = {
  kind: "written",
  project: { id: "gitea-1", name: "Gitea", status: "ACTIVE" },
};

type RegisterArgs = Parameters<NewProjectPorts["registerGroup"]>[0];

/** Ports that do what they are asked, each call written down in `order`. */
function ports(over: Partial<NewProjectPorts> = {}) {
  const order: Array<string> = [];
  const made: NewProjectPorts = {
    ensureGitea: vi.fn(async () => {
      order.push("gitea");
      return { projectId: "gitea-new" };
    }),
    registerGroup: vi.fn(async ({ giteaProjectId, groupId, name }: RegisterArgs) => {
      order.push(`register:${giteaProjectId}:${groupId}:${name}`);
      return WRITTEN;
    }),
    createProject: vi.fn(async () => {
      order.push("create");
      return { project: PROJECT };
    }),
    accepted: vi.fn((projectId: string, giteaProjectId: string | null) => {
      order.push(`accepted:${projectId}:${String(giteaProjectId)}`);
    }),
    ...over,
  };
  return { order, ports: made };
}

describe("runNewProjectBirth — the project, then its first Mate", () => {
  it("stands Git hosting up where the account has none, registers the project on it, then creates its Mate", async () => {
    const { order, ports: made } = ports();
    const moved: Array<NewProjectPatch> = [];
    await runNewProjectBirth(bare(), made, (patch) => moved.push(patch));
    // The registry lives on the Gitea project: the project is registered there before anything
    // is created in it.
    expect(order).toEqual([
      "gitea",
      "register:gitea-new:g-acme:Acme CRM",
      "create",
      "accepted:p-vera:gitea-new",
    ]);
    expect(moved).toEqual([
      { step: "registry", giteaProjectId: "gitea-new" },
      { step: "create" },
      { step: "created", projectId: "p-vera" },
    ]);
  });

  it("never stands a second Gitea up for an account that has one", async () => {
    const { order, ports: made } = ports();
    await runNewProjectBirth(birth(), made, () => undefined);
    expect(made.ensureGitea).not.toHaveBeenCalled();
    expect(order[0]).toBe("register:gitea-1:g-acme:Acme CRM");
  });

  it.each<{ readonly case: string; readonly ask: Partial<NewProjectAsk>; readonly args: object }>([
    {
      case: "named after its Mate, tagged into the project, with the face picked and no stand-up",
      ask: {},
      args: {
        name: "Acme CRM - Vera",
        agents: [],
        group: { groupId: "g-acme", role: "dev", label: "Acme CRM" },
        botName: "Vera",
        face: { tint: "rose", shape: "seal" },
      },
    },
    {
      case: "in the location chosen, with the agents selected",
      ask: { locationId: "prg1", agents: ["claude-code"] },
      args: {
        name: "Acme CRM - Vera",
        location: "prg1",
        agents: ["claude-code"],
        group: { groupId: "g-acme", role: "dev", label: "Acme CRM" },
        botName: "Vera",
        face: { tint: "rose", shape: "seal" },
      },
    },
    {
      case: "naming who pressed Create, whose sign-in it waits for",
      ask: { madeBy: "user-ada" },
      args: {
        name: "Acme CRM - Vera",
        agents: [],
        group: { groupId: "g-acme", role: "dev", label: "Acme CRM" },
        botName: "Vera",
        face: { tint: "rose", shape: "seal" },
        madeBy: "user-ada",
      },
    },
  ])("creates its first Mate $case", async ({ ask, args }) => {
    const { ports: made } = ports();
    await runNewProjectBirth(birth({ step: "create", ...ask }), made, () => undefined);
    expect(made.createProject).toHaveBeenCalledWith(args);
  });

  it.each<{
    readonly case: string;
    readonly birth: NewProjectBirth;
    readonly over: Partial<NewProjectPorts>;
    readonly order: ReadonlyArray<string>;
    readonly failed: NewProjectPatch["failed"];
  }>([
    {
      case: "Git hosting that cannot be stood up creates nothing",
      birth: bare(),
      over: { ensureGitea: () => Promise.reject(new Error("No room in this account.")) },
      order: [],
      failed: { reason: "No room in this account.", uncertain: false },
    },
    {
      case: "a registry write that fails creates nothing",
      birth: birth(),
      over: { registerGroup: () => Promise.reject(new Error("Only owners write tags.")) },
      order: [],
      failed: { reason: "Only owners write tags.", uncertain: false },
    },
    {
      case: "a registry that refuses the project creates nothing, and says why",
      birth: birth(),
      over: {
        registerGroup: async () => ({
          kind: "refused",
          refusal: { code: "registry-conflict", reason: "A project is already called that." },
          project: WRITTEN.project,
        }),
      },
      order: [],
      failed: { reason: "A project is already called that.", uncertain: false },
    },
    {
      case: "a creation the platform refused leaves a registered project, and no Mate",
      birth: birth(),
      over: { createProject: () => Promise.reject(new Error("Project name is taken.")) },
      order: ["register:gitea-1:g-acme:Acme CRM"],
      failed: { reason: "Project name is taken.", uncertain: false },
    },
    {
      case: "a creation the platform may have taken anyway is kept from being made twice",
      birth: birth(),
      over: {
        createProject: () =>
          Promise.reject({
            _tag: "ZeropsDataAdapterError",
            kind: "uncertain",
            message: "The project may already exist.",
          }),
      },
      order: ["register:gitea-1:g-acme:Acme CRM"],
      failed: { reason: "The project may already exist.", uncertain: true },
    },
  ])("stops where it fails: $case", async ({ birth: made, over, order: expected, failed }) => {
    const { order, ports: fake } = ports(over);
    const moved: Array<NewProjectPatch> = [];
    await runNewProjectBirth(made, fake, (patch) => moved.push(patch));
    expect(order).toEqual(expected);
    expect(moved.at(-1)).toEqual({ failed });
    expect(fake.accepted).not.toHaveBeenCalled();
  });

  it.each<{
    readonly case: string;
    readonly birth: NewProjectBirth;
    readonly order: ReadonlyArray<string>;
  }>([
    {
      case: "a registration, on the Gitea stood up before",
      birth: bare({ step: "registry", giteaProjectId: "gitea-new" }),
      order: ["register:gitea-new:g-acme:Acme CRM", "create", "accepted:p-vera:gitea-new"],
    },
    {
      case: "its Mate's creation, with nothing before it made again",
      birth: birth({ step: "create" }),
      order: ["create", "accepted:p-vera:gitea-1"],
    },
    { case: "nothing, once the platform took it", birth: birth({ step: "created" }), order: [] },
  ])("resumes from the step it stopped on: $case", async ({ birth: made, order: expected }) => {
    const { order, ports: fake } = ports();
    await runNewProjectBirth(made, fake, () => undefined);
    expect(order).toEqual(expected);
  });
});

describe("the tab holds a New project's creation until the platform takes it", () => {
  beforeEach(() => {
    openAccountLifetime("u-ada");
    useNewProjectBirths.setState({ births: {} });
  });
  afterEach(() => {
    closeAccountLifetime();
  });

  const held = () => useNewProjectBirths.getState().births["g-acme"];

  it("holds it from the press, and moves it to its Mate's project once the platform takes it", async () => {
    const { ports: fake } = ports();
    const birthId = beginNewProjectBirth({
      ask: ASK,
      gitea: undefined,
      ports: fake,
      now: PRESSED_AT,
    });
    expect(birthId).toBe("g-acme");
    expect(held()).toMatchObject({ step: "gitea", withGitea: true, startedAt: PRESSED_AT });
    await vi.waitFor(() => expect(held()?.projectId).toBe("p-vera"));
    expect(held()).toMatchObject({ step: "created", giteaProjectId: "gitea-new", failed: null });
    expect(fake.accepted).toHaveBeenCalledTimes(1);
    // Its Mate's row counts on from the press, not from when the platform answered.
    expect(fake.accepted).toHaveBeenCalledWith("p-vera", "gitea-new", PRESSED_AT);
  });

  it("resumes from the step that stopped it, with the same project, on Try again", async () => {
    let refuse = true;
    const { order, ports: fake } = ports({
      registerGroup: vi.fn(async () => {
        if (refuse) throw new Error("The registry could not be read.");
        order.push("register");
        return WRITTEN;
      }),
    });
    beginNewProjectBirth({ ask: ASK, gitea: { projectId: "gitea-1" }, ports: fake, now: 0 });
    await vi.waitFor(() => expect(held()?.failed).not.toBeNull());
    expect(held()).toMatchObject({ step: "registry", failed: { uncertain: false } });

    refuse = false;
    retryNewProjectBirth("g-acme");
    expect(held()?.failed).toBeNull();
    await vi.waitFor(() => expect(held()?.step).toBe("created"));
    expect(order).toEqual(["register", "create", "accepted:p-vera:gitea-1"]);
    expect(fake.registerGroup).toHaveBeenLastCalledWith({
      giteaProjectId: "gitea-1",
      groupId: "g-acme",
      name: "Acme CRM",
    });
  });

  it("never tries again a creation the platform may have taken", async () => {
    const { ports: fake } = ports({
      createProject: vi.fn(() =>
        Promise.reject({ _tag: "ZeropsDataAdapterError", kind: "uncertain", message: "Unsure." }),
      ),
    });
    beginNewProjectBirth({ ask: ASK, gitea: { projectId: "gitea-1" }, ports: fake, now: 0 });
    await vi.waitFor(() => expect(held()?.failed?.uncertain).toBe(true));
    retryNewProjectBirth("g-acme");
    expect(held()?.failed?.uncertain).toBe(true);
    expect(fake.createProject).toHaveBeenCalledTimes(1);
  });

  it("holds an added Mate by its own id, and its press's progress after the platform took it", async () => {
    const { ports: fake } = ports();
    const birthId = beginNewProjectBirth({
      ask: { ...ASK, botName: "Ida", adds: { displayName: "Acme CRM - Ida", registers: true } },
      id: "add-1",
      gitea: undefined,
      ports: fake,
      now: PRESSED_AT,
    });
    expect(birthId).toBe("add-1");
    const add = () => useNewProjectBirths.getState().births["add-1"];
    expect(add()).toMatchObject({ id: "add-1", step: "create", withGitea: false, progress: null });
    await vi.waitFor(() => expect(add()?.projectId).toBe("p-vera"));
    expect(fake.ensureGitea).not.toHaveBeenCalled();
    const progress = pressed(["close-off", "running"]);
    progressNewProjectBirth("add-1", progress);
    expect(add()?.progress).toEqual(progress);
    // A creation it does not hold hears nothing.
    progressNewProjectBirth("add-2", progress);
    expect(useNewProjectBirths.getState().births["add-2"]).toBeUndefined();
  });

  it("forgets every creation, and lets none land, once its account is signed out", async () => {
    let accept: (value: { readonly project: typeof PROJECT }) => void = () => undefined;
    const { ports: fake } = ports({
      createProject: vi.fn(
        () =>
          new Promise<{ readonly project: typeof PROJECT }>((resolve) => {
            accept = resolve;
          }),
      ),
    });
    beginNewProjectBirth({ ask: ASK, gitea: { projectId: "gitea-1" }, ports: fake, now: 0 });
    await vi.waitFor(() => expect(fake.createProject).toHaveBeenCalled());
    closeAccountLifetime();
    expect(useNewProjectBirths.getState().births).toEqual({});
    accept({ project: PROJECT });
    await new Promise((settled) => setTimeout(settled, 0));
    expect(fake.accepted).not.toHaveBeenCalled();
    expect(useNewProjectBirths.getState().births).toEqual({});
  });
});

type Kind =
  | "create-project"
  | "import-managed"
  | "import-container"
  | "close-off"
  | "register"
  | "share-reach";
type RunState = "queued" | "running" | "done" | "failed";

/** A press's progress: each step's kind and state, in order, with what a stop said. */
const pressed = (...entries: ReadonlyArray<readonly [Kind, RunState]>) =>
  entries.map(([kind, state]) => ({
    step:
      kind === "create-project"
        ? ({ kind, name: "Acme CRM - Ida" } as never)
        : kind === "import-managed"
          ? ({ kind, yaml: "" } as never)
          : kind === "import-container"
            ? ({ kind, agents: [] } as never)
            : ({ kind } as never),
    state,
    ...(state === "failed" ? { error: `${kind} said no.` } : {}),
  }));

/** Ida added to Acme CRM, from Add: a Mate into a project that stands. */
const added = (over: Partial<NewProjectBirth> = {}) =>
  birth({
    id: "add-1",
    botName: "Ida",
    adds: { displayName: "Acme CRM - Ida", registers: true },
    step: "create",
    ...over,
  });

/** Each sub-step as `label:state`, with why where it stopped. */
const drawnSubsteps = (made: NewProjectBirth) =>
  creationSubsteps(made).map(
    (step) => `${step.label}:${step.state}${step.why === undefined ? "" : ` (${step.why})`}`,
  );

// Run 6 (the owner, 2026-10-03: "why are these two screens separate?"): the steps this tab runs
// are the project's row's own on the Mate's page, from the press until its hand-over.
describe("creationSubsteps — a New project's steps this tab runs, under its row", () => {
  it.each([
    {
      case: "Git hosting first: nothing of the project's own begun",
      made: bare(),
      want: [
        "Registered:waiting",
        "Created:waiting",
        "Closed off:waiting",
        "Vera registered:waiting",
      ],
    },
    {
      case: "registering",
      made: birth(),
      want: [
        "Registered:active",
        "Created:waiting",
        "Closed off:waiting",
        "Vera registered:waiting",
      ],
    },
    {
      case: "a registration that stopped",
      made: birth({ failed: NO_ROOM }),
      want: [
        "Registered:failed (No room in this account.)",
        "Created:waiting",
        "Closed off:waiting",
        "Vera registered:waiting",
      ],
    },
    {
      case: "creating its Mate's project",
      made: birth({ step: "create" }),
      want: ["Registered:done", "Created:active", "Closed off:waiting", "Vera registered:waiting"],
    },
    {
      case: "taken, its Mate's press not yet heard",
      made: birth({ step: "created", projectId: "p-1" }),
      want: ["Registered:done", "Created:done", "Closed off:waiting", "Vera registered:waiting"],
    },
    {
      case: "closing off",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(
          ["close-off", "running"],
          ["register", "queued"],
          ["share-reach", "queued"],
        ),
      }),
      want: ["Registered:done", "Created:done", "Closed off:active", "Vera registered:waiting"],
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
        "Closed off:failed (close-off said no.)",
        "Vera registered:waiting",
      ],
    },
    {
      case: "a registration refused: not registered, and why",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(["close-off", "done"], ["register", "failed"], ["share-reach", "done"]),
      }),
      want: [
        "Registered:done",
        "Created:done",
        "Closed off:done",
        "Not registered:unfinished (Register said no.)",
      ],
    },
    {
      case: "through",
      made: birth({
        step: "created",
        projectId: "p-1",
        progress: pressed(["close-off", "done"], ["register", "done"], ["share-reach", "running"]),
      }),
      want: ["Registered:done", "Created:done", "Closed off:done", "Vera registered:done"],
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
      want: ["Created:active", "Container:waiting", "Closed off:waiting", "Ida registered:waiting"],
    },
    {
      case: "where its registration is nobody's here to write",
      made: added({ adds: { displayName: "Acme CRM - Ida", registers: false } }),
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
      want: ["Created:active", "Container:waiting", "Closed off:waiting", "Ida registered:waiting"],
    },
    {
      case: "refused before the platform took it",
      made: added({ failed: NO_ROOM }),
      want: [
        "Created:failed (No room in this account.)",
        "Container:waiting",
        "Closed off:waiting",
        "Ida registered:waiting",
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
      want: ["Created:done", "Container:active", "Closed off:waiting", "Ida registered:waiting"],
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
        "Container:failed (import-container said no.)",
        "Closed off:waiting",
        "Ida registered:waiting",
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
          ["share-reach", "running"],
        ),
      }),
      want: ["Created:done", "Container:done", "Closed off:done", "Ida registered:done"],
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
          ["share-reach", "done"],
        ),
      }),
      want: [
        "Created:done",
        "Container:done",
        "Closed off:done",
        "Not registered:unfinished (Register said no.)",
      ],
    },
  ])("$case", ({ made, want }) => {
    expect(drawnSubsteps(made)).toEqual(want);
  });
});

describe("an added Mate held from the press", () => {
  it("is placed in its project by its own id, its environment named as Add named it", () => {
    expect(placedNewProjects([added()], ASK.organizationId)).toEqual([
      expect.objectContaining({
        projectId: "add-1",
        awaitingProject: true,
        placement: expect.objectContaining({
          groupId: ASK.groupId,
          groupName: "Acme CRM",
          displayName: "Acme CRM - Ida",
          botName: "Ida",
        }),
      }),
    ]);
  });

  it("brings no project steps of its own: its copy is its first row", () => {
    expect(newProjectSteps(added())).toEqual([]);
  });

  it("creates its Mate without Git hosting or a registration of its own", async () => {
    const calls: Array<string> = [];
    const patches: Array<NewProjectPatch> = [];
    await runNewProjectBirth(
      added({ giteaProjectId: null }),
      {
        ensureGitea: async () => {
          calls.push("gitea");
          return { projectId: "gitea-new" };
        },
        registerGroup: async () => {
          calls.push("registry");
          throw new Error("not asked");
        },
        createProject: async () => {
          calls.push("create");
          return { project: { id: "p-ida" } };
        },
        accepted: (projectId) => {
          calls.push(`accepted:${projectId}`);
        },
      },
      (patch) => patches.push(patch),
    );
    expect(calls).toEqual(["create", "accepted:p-ida"]);
    expect(patches).toEqual([{ step: "created", projectId: "p-ida" }]);
  });
});

describe("creationManaged — the managed services an added Mate's copy waits on, from the press", () => {
  const TIER =
    "services:\n  - hostname: db\n    type: postgresql@16\n  - hostname: appdev\n    type: nodejs@22\n    zeropsSetup: dev\n";
  const PLANNED =
    "services:\n  - hostname: db\n    type: postgresql@16\n  - hostname: cache\n    type: valkey@7.2\n";
  it.each([
    { case: "a New project's first Mate: none of its own", made: birth(), want: undefined },
    {
      case: "pressed: as its recipe names them",
      made: added({ adds: { displayName: "Acme CRM - Ida", registers: true, managed: ["db"] } }),
      want: ["db"],
    },
    {
      case: "planned: as its plan names them",
      made: added({
        adds: { displayName: "Acme CRM - Ida", registers: true, managed: ["db"] },
        progress: [{ step: { kind: "import-managed", yaml: PLANNED }, state: "queued" }],
      }),
      want: ["db", "cache"],
    },
    {
      case: "a recipe that brings none",
      made: added({ adds: { displayName: "Acme CRM - Ida", registers: true } }),
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
      made: added({ adds: { displayName: "Acme CRM - Ida", registers: true, runtimes: APP } }),
      want: APP,
    },
    {
      case: "planned: as its plan names them",
      made: added({
        adds: { displayName: "Acme CRM - Ida", registers: true },
        progress: [
          {
            step: {
              kind: "import-container",
              agents: [],
              runtimes: { yaml: "", services: [{ hostname: "apidev", role: "dev" }] },
            },
            state: "queued",
          },
        ],
      }),
      want: [{ hostname: "apidev", role: "dev" }],
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
      displayName: "Acme CRM - Ida",
      registers: true,
      managed: ["db"],
      runtimes: [{ hostname: "appdev", role: "dev" }],
    },
  });
  const press = { managed: ["db"], runtimes: [{ hostname: "appdev", role: "dev" as const }] };
  it.each([
    { case: "its press held: the press's", press, made, want: press },
    {
      case: "its press over, its creation held: the creation's",
      press: undefined,
      made,
      want: press,
    },
    { case: "held by neither", press: undefined, made: undefined, want: {} },
  ])("$case", ({ press: held, made: holding, want }) => {
    expect(comingPlanned(held, holding)).toEqual(want);
  });

  it("keeps an added Mate's rows and their lines from the press through the hand-over and the press's end", () => {
    const pressedAdd = added({
      adds: {
        displayName: "Acme CRM - Ida",
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
    expect(mateView(press)).toEqual(before);
    expect(mateView(undefined)).toEqual(before);
  });
});

// Run 6's review: an Add's port flattened its stop to a string, so one Zerops may have made
// offered Try again, which made a second; and a run that threw left Created spinning for good.
describe("addCreateProject — an Add's press as its creation's port", () => {
  const STEP = { kind: "create-project", name: "Acme CRM - Ida", tagList: [] } as never;
  type Script = (onAccepted: (projectId: string) => void) => Promise<never> | Promise<unknown>;
  const portOf = (script: Script) => {
    const settled = vi.fn();
    const created = addCreateProject({
      run: (onAccepted) => script(onAccepted) as never,
      settled,
    }).then(
      (made) => ({ resolved: made.project.id }),
      (cause: unknown) => ({
        rejected: (cause as Error).message,
        uncertain: isUncertainZeropsFailure(cause),
      }),
    );
    return { created, settled };
  };

  it.each<{
    readonly case: string;
    readonly script: Script;
    readonly want: object;
    readonly settled?: ReadonlyArray<string>;
  }>([
    {
      case: "taken, then through: its project",
      script: async (accepted) => {
        accepted("p-ida");
        return { kind: "ran", outcome: { ok: true, projectId: "p-ida" } };
      },
      want: { resolved: "p-ida" },
    },
    {
      case: "taken, then stopped: its project, and the stop is its press's to say",
      script: async (accepted) => {
        accepted("p-ida");
        return {
          kind: "ran",
          outcome: { ok: false, projectId: "p-ida", failedStep: STEP, error: "Not closed off." },
        };
      },
      want: { resolved: "p-ida" },
      settled: ["p-ida", "Not closed off."],
    },
    {
      case: "refused before anything was asked: why, certain",
      script: async () => ({ kind: "refused", reason: "This project has no recipe merged yet." }),
      want: { rejected: "This project has no recipe merged yet.", uncertain: false },
    },
    {
      case: "stopped before the platform took it: why, certain",
      script: async () => ({
        kind: "ran",
        outcome: { ok: false, projectId: undefined, failedStep: STEP, error: "No room." },
      }),
      want: { rejected: "No room.", uncertain: false },
    },
    {
      case: "stopped where Zerops may have made it: why, uncertain",
      script: async () => ({
        kind: "ran",
        outcome: {
          ok: false,
          projectId: undefined,
          failedStep: STEP,
          error: "Zerops may have created it.",
          uncertain: true,
        },
      }),
      want: { rejected: "Zerops may have created it.", uncertain: true },
    },
    {
      case: "a run that threw before the platform took it: why",
      script: () => Promise.reject(new Error("The press could not start.")),
      want: { rejected: "The press could not start.", uncertain: false },
    },
    {
      case: "a run that threw after: its project, and the stop is its press's to say",
      script: (accepted) => {
        accepted("p-ida");
        return Promise.reject(new Error("The press could not finish."));
      },
      want: { resolved: "p-ida" },
      settled: ["p-ida", "The press could not finish."],
    },
  ])("$case", async ({ script, want, settled: stop }) => {
    const { created, settled } = portOf(script);
    expect(await created).toEqual(want);
    if (stop === undefined) expect(settled).not.toHaveBeenCalled();
    else expect(settled).toHaveBeenCalledWith(...stop);
  });

  it("never offers Try again on an added Mate Zerops may have made", async () => {
    openAccountLifetime("u-ada");
    useNewProjectBirths.setState({ births: {} });
    const run = vi.fn(async () => ({
      kind: "ran" as const,
      outcome: {
        ok: false as const,
        projectId: undefined,
        failedStep: STEP,
        error: "Zerops may have created it.",
        uncertain: true as const,
      },
    }));
    beginNewProjectBirth({
      id: "add-1",
      ask: { ...ASK, botName: "Ida", adds: { displayName: "Acme CRM - Ida", registers: true } },
      gitea: { projectId: "gitea-1" },
      now: 0,
      ports: {
        ensureGitea: () => Promise.reject(new Error("not asked")),
        registerGroup: () => Promise.reject(new Error("not asked")),
        createProject: () => addCreateProject({ run, settled: () => undefined }),
        accepted: () => undefined,
      },
    });
    const held = () => useNewProjectBirths.getState().births["add-1"];
    await vi.waitFor(() => expect(held()?.failed).not.toBeNull());
    expect(held()?.failed).toEqual({ reason: "Zerops may have created it.", uncertain: true });
    expect(newProjectComing(held()!)).toMatchObject({ kind: "failed", verb: "go-to-projects" });
    retryNewProjectBirth("add-1");
    expect(run).toHaveBeenCalledTimes(1);
    closeAccountLifetime();
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
          groupId: "g-acme",
          again: { botName: "Ida", name: "Acme CRM - Ida", tint: "rose", shape: "seal" },
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

  describe("on the page and from the row", () => {
    beforeEach(() => {
      openAccountLifetime("u-ada");
      useNewProjectBirths.setState({ births: { "add-1": refused } });
      useNewMate.setState({ asked: null });
    });
    afterEach(() => {
      closeAccountLifetime();
      useNewMate.setState({ asked: null });
    });

    it("Dismiss takes it out of the menu, and asks for nothing", () => {
      dismissNewProjectBirth("add-1");
      expect(useNewProjectBirths.getState().births["add-1"]).toBeUndefined();
      const held = Object.values(useNewProjectBirths.getState().births);
      expect(placedNewProjects(held, ASK.organizationId)).toEqual([]);
      expect(useNewMate.getState().asked).toBeNull();
    });

    it("Start over takes it out and opens Add over its project, its name there to change", () => {
      startAddOver("add-1");
      expect(useNewProjectBirths.getState().births["add-1"]).toBeUndefined();
      expect(useNewMate.getState().asked).toMatchObject({
        groupId: "g-acme",
        again: { botName: "Ida", name: "Acme CRM - Ida", tint: "rose", shape: "seal" },
      });
    });

    it("never starts over one Zerops may have made: it could make it twice", () => {
      useNewProjectBirths.setState({
        births: { "add-1": added({ failed: { reason: "Lost.", uncertain: true } }) },
      });
      startAddOver("add-1");
      expect(useNewProjectBirths.getState().births["add-1"]).toBeDefined();
      expect(useNewMate.getState().asked).toBeNull();
    });

    it("leaves one still running alone", () => {
      useNewProjectBirths.setState({ births: { "add-1": added() } });
      startAddOver("add-1");
      expect(useNewProjectBirths.getState().births["add-1"]).toBeDefined();
      expect(useNewMate.getState().asked).toBeNull();
    });
  });
});

// Run 6's second review: an owner whose broker grant timed out read "An owner registers Ida for
// Git." with a hollow mark, never why, and Finish setup came two minutes on, or never where the
// registry write had landed. The step keeps why, and Finish setup is theirs at once.
describe("a registration not finished — Finish setup at once, and its step following it", () => {
  const refused = added({
    step: "created",
    projectId: "p-ida",
    progress: pressed(
      ["create-project", "done"],
      ["import-container", "done"],
      ["close-off", "done"],
      ["register", "failed"],
      ["share-reach", "done"],
    ),
  });
  const through = added({
    step: "created",
    projectId: "p-ida",
    progress: pressed(["close-off", "done"], ["register", "done"]),
  });

  it.each([
    { case: "refused here: Finish setup at once", births: { "add-1": refused }, want: true },
    { case: "registered", births: { "add-1": through }, want: false },
    {
      case: "another Mate's",
      births: { "add-2": { ...refused, projectId: "p-other" } },
      want: false,
    },
    { case: "nothing made here", births: {}, want: false },
  ])("$case", ({ births, want }) => {
    expect(registrationUnfinished(births, "p-ida")).toBe(want);
  });

  describe("Finish setup's own steps", () => {
    beforeEach(() => {
      openAccountLifetime("u-ada");
      useNewProjectBirths.setState({ births: { "add-1": refused } });
    });
    afterEach(() => closeAccountLifetime());

    it.each([
      {
        case: "registering",
        finish: pressed(["close-off", "done"], ["register", "running"]),
        want: "Ida registered:active",
      },
      {
        case: "registered",
        finish: pressed(["close-off", "done"], ["register", "done"]),
        want: "Ida registered:done",
      },
      {
        case: "refused again: the new reason",
        finish: [
          { step: { kind: "close-off" } as never, state: "done" as const },
          {
            step: { kind: "register" } as never,
            state: "failed" as const,
            error: "Still no grant.",
          },
        ],
        want: "Not registered:unfinished (Still no grant.)",
      },
      {
        case: "not at its registration yet",
        finish: pressed(["close-off", "running"]),
        want: "Not registered:unfinished (Register said no.)",
      },
    ])("draw its registration: $case", ({ finish, want }) => {
      refinishNewProjectBirth("p-ida", finish);
      const made = useNewProjectBirths.getState().births["add-1"]!;
      expect(drawnSubsteps(made).at(-1)).toBe(want);
    });

    it("once through, offers it no more", () => {
      refinishNewProjectBirth("p-ida", pressed(["register", "done"]));
      expect(registrationUnfinished(useNewProjectBirths.getState().births, "p-ida")).toBe(false);
    });
  });
});
