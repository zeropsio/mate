import { deriveBirthProgress } from "@t3tools/client-runtime/zerops/birthProgress";
import type { ProjectTagWrite } from "@t3tools/client-runtime/zerops/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
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
    startedAt: PRESSED_AT,
    withGitea: false,
    giteaProjectId: "gitea-1",
    step: "registry",
    failed: null,
    projectId: null,
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
  const MATE_STEPS = ["project", "container", "public-access", "hardening", "mate", "connect"];

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
        provisioningPhase: null,
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
      coming: { kind: "coming", line: "Coming up. A few minutes.", verb: undefined },
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
    accepted: vi.fn((projectId: string, giteaProjectId: string) => {
      order.push(`accepted:${projectId}:${giteaProjectId}`);
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
