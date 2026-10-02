import { deriveBirthProgress } from "@t3tools/client-runtime/zerops/birthProgress";
import { HQ_BIRTH_START, type HqBirthRecord } from "@t3tools/client-runtime/zerops/hq";
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
  newProjectPressFailure,
  newProjectPressSteps,
  newProjectPressThrough,
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

/** Acme CRM's creation, pressed at `PRESSED_AT`, in an organization whose HQ stands. */
function birth(over: Partial<NewProjectBirth> = {}): NewProjectBirth {
  return {
    ...ASK,
    startedAt: PRESSED_AT,
    withHq: false,
    hqBirth: HQ_BIRTH_START,
    hq: HQ,
    appId: null,
    step: "registry",
    failed: null,
    projectId: null,
    ...over,
  };
}

/** The same creation in an organization that had no HQ when Create was pressed. */
const bare = (over: Partial<NewProjectBirth> = {}) =>
  birth({ withHq: true, hq: null, step: "hq", ...over });

/** HQ's birth at its deploy. */
const DEPLOYING: HqBirthRecord = {
  step: "deploy",
  projectId: "hq-1",
  serviceId: "svc-hq",
  address: HQ.address,
  deployProcessId: null,
};

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
      case: "an organization with HQ registers the project, under its name",
      birth: birth(),
      steps: [["registry", "Acme CRM", "active", "Registering the project"]],
    },
    {
      case: "an organization without stands HQ up first",
      birth: bare(),
      steps: [
        ["hq", "HQ", "active", "Creating HQ's project"],
        ["registry", "Acme CRM", "waiting", undefined],
      ],
    },
    {
      case: "HQ's line says which of its steps runs",
      birth: bare({ hqBirth: DEPLOYING }),
      steps: [
        ["hq", "HQ", "active", "Deploying HQ"],
        ["registry", "Acme CRM", "waiting", undefined],
      ],
    },
    {
      case: "an HQ that could not be stood up says why, and nothing after it begins",
      birth: bare({ failed: NO_ROOM }),
      steps: [
        ["hq", "HQ", "failed", "No room in this account."],
        ["registry", "Acme CRM", "waiting", undefined],
      ],
    },
    {
      case: "a registration that stopped says why",
      birth: birth({ withHq: true, failed: NO_ROOM }),
      steps: [
        ["hq", "HQ", "done", undefined],
        ["registry", "Acme CRM", "failed", "No room in this account."],
      ],
    },
    {
      case: "creating the Mate's project, the project's own are done",
      birth: birth({ withHq: true, step: "create" }),
      steps: [
        ["hq", "HQ", "done", undefined],
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
      case: "and while HQ is stood up",
      birth: bare(),
      states: ["hq:active", "registry:waiting", ...MATE_STEPS.map((id) => `${id}:waiting`)],
      detail: "Creating HQ's project",
    },
    {
      case: "creating its project is the Mate's own first step",
      birth: birth({ withHq: true, step: "create" }),
      states: [
        "hq:done",
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
      birth({ withHq: true, step: "created", projectId: "p-vera" }),
      mate,
      NOW,
    );
    expect(states(progress.steps)).toEqual(["hq:done", "registry:done", ...states(mate.steps)]);
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
    placement: {
      groupId: "b-acme",
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

const PROJECT = { id: "p-vera", name: "Acme CRM - Vera", status: "ACTIVE" } as const;
const NEW_HQ = { projectId: "hq-new", address: "https://hq-9-8080.prg1.zerops.app" } as const;

type RegisterArgs = Parameters<NewProjectPorts["registerGroup"]>[0];
type AcceptedArgs = Parameters<NewProjectPorts["accepted"]>;

/** Ports that do what they are asked, each call written down in `order`. */
function ports(over: Partial<NewProjectPorts> = {}) {
  const order: Array<string> = [];
  const made: NewProjectPorts = {
    bearHq: vi.fn(
      async (_record: HqBirthRecord, moved: (patch: Partial<HqBirthRecord>) => void) => {
        order.push("hq");
        moved({ step: "done", projectId: NEW_HQ.projectId, address: NEW_HQ.address });
        return { ok: true as const, hq: NEW_HQ };
      },
    ),
    registerGroup: vi.fn(async ({ hq, name }: RegisterArgs) => {
      order.push(`register:${hq.projectId}:${name}`);
      return { appId: "app-acme" };
    }),
    createProject: vi.fn(async () => {
      order.push("create");
      return { project: PROJECT };
    }),
    accepted: vi.fn((...[projectId, { hq, appId }]: AcceptedArgs) => {
      order.push(`accepted:${projectId}:${hq.projectId}:${appId}`);
    }),
    ...over,
  };
  return { order, ports: made };
}

describe("runNewProjectBirth — the project, then its first Mate", () => {
  it("stands HQ up where the organization has none, registers the project in it, then creates its Mate", async () => {
    const { order, ports: made } = ports();
    const moved: Array<NewProjectPatch> = [];
    await runNewProjectBirth(bare(), made, (patch) => moved.push(patch));
    // The registry lives in HQ: the project is registered there before anything is created in it,
    // and its Mate goes into the application HQ named.
    expect(order).toEqual([
      "hq",
      "register:hq-new:Acme CRM",
      "create",
      "accepted:p-vera:hq-new:app-acme",
    ]);
    expect(moved).toEqual([
      {
        hqBirth: { ...HQ_BIRTH_START, step: "done", projectId: "hq-new", address: NEW_HQ.address },
      },
      { step: "registry", hq: NEW_HQ },
      { step: "create", appId: "app-acme" },
      { step: "created", projectId: "p-vera" },
    ]);
  });

  it("never stands a second HQ up for an organization that has one", async () => {
    const { order, ports: made } = ports();
    await runNewProjectBirth(birth(), made, () => undefined);
    expect(made.bearHq).not.toHaveBeenCalled();
    expect(order[0]).toBe("register:hq-1:Acme CRM");
  });

  it.each<{ readonly case: string; readonly ask: Partial<NewProjectAsk>; readonly args: object }>([
    {
      // Its application, name and face are HQ's: the press's registration writes them.
      case: "named after its Mate, and nothing of its place on the project",
      ask: {},
      args: { name: "Acme CRM - Vera", agents: [] },
    },
    {
      case: "in the location chosen, with the agents selected",
      ask: { locationId: "prg1", agents: ["claude-code"] },
      args: {
        name: "Acme CRM - Vera",
        location: "prg1",
        agents: ["claude-code"],
      },
    },
  ])("creates its first Mate $case", async ({ ask, args }) => {
    const { ports: made } = ports();
    await runNewProjectBirth(
      birth({ step: "create", appId: "app-acme", ...ask }),
      made,
      () => undefined,
    );
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
      case: "an HQ that cannot be stood up creates nothing, and names its step",
      birth: bare(),
      over: {
        bearHq: async () => ({
          ok: false,
          step: "deploy",
          reason: "No room in this account.",
          uncertain: false,
        }),
      },
      order: [],
      failed: { reason: "Deploying HQ: No room in this account.", uncertain: false },
    },
    {
      case: "an HQ project the platform may have made anyway is kept from being made twice",
      birth: bare(),
      over: {
        bearHq: async () => ({
          ok: false,
          step: "project",
          reason: "Zerops may have accepted this operation.",
          uncertain: true,
        }),
      },
      order: [],
      failed: {
        reason: "Creating HQ's project: Zerops may have accepted this operation.",
        uncertain: true,
      },
    },
    {
      case: "a registration HQ refuses creates nothing, and says why",
      birth: birth(),
      over: {
        registerGroup: () => Promise.reject(new Error("An application named Acme CRM exists.")),
      },
      order: [],
      failed: { reason: "An application named Acme CRM exists.", uncertain: false },
    },
    {
      case: "a creation the platform refused leaves a registered project, and no Mate",
      birth: birth(),
      over: { createProject: () => Promise.reject(new Error("Project name is taken.")) },
      order: ["register:hq-1:Acme CRM"],
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
      order: ["register:hq-1:Acme CRM"],
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
      case: "HQ's birth, from what it made before",
      birth: bare({ hqBirth: DEPLOYING }),
      order: ["hq", "register:hq-new:Acme CRM", "create", "accepted:p-vera:hq-new:app-acme"],
    },
    {
      case: "a registration, in the HQ stood up before",
      birth: bare({ step: "registry", hq: NEW_HQ }),
      order: ["register:hq-new:Acme CRM", "create", "accepted:p-vera:hq-new:app-acme"],
    },
    {
      case: "its Mate's creation, with nothing before it made again",
      birth: birth({ step: "create", appId: "app-1" }),
      order: ["create", "accepted:p-vera:hq-1:app-1"],
    },
    { case: "nothing, once the platform took it", birth: birth({ step: "created" }), order: [] },
  ])("resumes from the step it stopped on: $case", async ({ birth: made, order: expected }) => {
    const { order, ports: fake } = ports();
    await runNewProjectBirth(made, fake, () => undefined);
    expect(order).toEqual(expected);
    if (made.step === "hq")
      expect(fake.bearHq).toHaveBeenCalledWith(made.hqBirth, expect.any(Function));
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

  const held = () => useNewProjectBirths.getState().births["b-acme"];

  it("holds it from the press, and moves it to its Mate's project once the platform takes it", async () => {
    const { ports: fake } = ports();
    const birthId = beginNewProjectBirth({
      ask: ASK,
      hq: undefined,
      ports: fake,
      now: PRESSED_AT,
    });
    expect(birthId).toBe("b-acme");
    expect(held()).toMatchObject({ step: "hq", withHq: true, startedAt: PRESSED_AT });
    await vi.waitFor(() => expect(held()?.projectId).toBe("p-vera"));
    expect(held()).toMatchObject({
      step: "created",
      hq: NEW_HQ,
      appId: "app-acme",
      hqBirth: { step: "done" },
      failed: null,
    });
    expect(fake.accepted).toHaveBeenCalledTimes(1);
  });

  it("resumes from the step that stopped it, with the same project, on Try again", async () => {
    let refuse = true;
    const { order, ports: fake } = ports({
      registerGroup: vi.fn(async () => {
        if (refuse) throw new Error("HQ is not answering right now.");
        order.push("register");
        return { appId: "app-acme" };
      }),
    });
    beginNewProjectBirth({ ask: ASK, hq: HQ, ports: fake, now: 0 });
    await vi.waitFor(() => expect(held()?.failed).not.toBeNull());
    expect(held()).toMatchObject({ step: "registry", failed: { uncertain: false } });

    refuse = false;
    retryNewProjectBirth("b-acme");
    expect(held()?.failed).toBeNull();
    await vi.waitFor(() => expect(held()?.step).toBe("created"));
    expect(order).toEqual(["register", "create", "accepted:p-vera:hq-1:app-acme"]);
    expect(fake.registerGroup).toHaveBeenLastCalledWith({ hq: HQ, name: "Acme CRM" });
  });

  it("never tries again a creation the platform may have taken", async () => {
    const { ports: fake } = ports({
      createProject: vi.fn(() =>
        Promise.reject({ _tag: "ZeropsDataAdapterError", kind: "uncertain", message: "Unsure." }),
      ),
    });
    beginNewProjectBirth({ ask: ASK, hq: HQ, ports: fake, now: 0 });
    await vi.waitFor(() => expect(held()?.failed?.uncertain).toBe(true));
    retryNewProjectBirth("b-acme");
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
    beginNewProjectBirth({ ask: ASK, hq: HQ, ports: fake, now: 0 });
    await vi.waitFor(() => expect(fake.createProject).toHaveBeenCalled());
    closeAccountLifetime();
    expect(useNewProjectBirths.getState().births).toEqual({});
    accept({ project: PROJECT });
    await new Promise((settled) => setTimeout(settled, 0));
    expect(fake.accepted).not.toHaveBeenCalled();
    expect(useNewProjectBirths.getState().births).toEqual({});
  });
});

// The New project dialog stays on the press until the first Mate needs no browser (2026-10-01:
// a tab closed after a dialog that had left stranded a Mate with no container).
describe("newProjectPressSteps — a New project's press, as its dialog draws it", () => {
  const press = (states: ReadonlyArray<"queued" | "running" | "done" | "failed">) =>
    (["close-off", "register", "share-reach", "await-ready"] as const).map((kind, index) => ({
      step: kind === "await-ready" ? { kind, withAgent: true } : { kind },
      state: states[index]!,
    }));
  const drawn = (made: NewProjectBirth, progress: ReturnType<typeof press> | null) =>
    newProjectPressSteps(made, progress).map((step) => `${step.label}:${step.state}`);

  it.each([
    {
      case: "HQ stood up first, where the organization has none",
      made: bare(),
      progress: null,
      want: [
        "HQ:active",
        "Project registered:waiting",
        "Creating the project:waiting",
        "Closed off:waiting",
        "Mate registered:waiting",
      ],
    },
    {
      case: "the project being created, its wait part of the press",
      made: birth({ step: "create" }),
      progress: null,
      want: [
        "Project registered:done",
        "Creating the project:active",
        "Closed off:waiting",
        "Mate registered:waiting",
      ],
    },
    {
      case: "its Mate being closed off",
      made: birth({ step: "created", projectId: "p-1" }),
      progress: press(["running", "queued", "queued", "queued"]),
      want: [
        "Project registered:done",
        "Creating the project:done",
        "Closed off:active",
        "Mate registered:waiting",
      ],
    },
    {
      case: "a creation the platform refused",
      made: birth({ step: "create", failed: NO_ROOM }),
      progress: null,
      want: [
        "Project registered:done",
        "Creating the project:failed",
        "Closed off:waiting",
        "Mate registered:waiting",
      ],
    },
  ])("draws $case", ({ made, progress, want }) => {
    expect(drawn(made, progress)).toEqual(want);
  });

  it("is through once its Mate is marked closed off and registered, and not before", () => {
    expect(newProjectPressThrough(press(["running", "queued", "queued", "queued"]))).toBe(false);
    expect(newProjectPressThrough(press(["done", "running", "queued", "queued"]))).toBe(false);
    expect(newProjectPressThrough(press(["done", "done", "running", "queued"]))).toBe(true);
    expect(newProjectPressThrough(null)).toBe(false);
  });
});

describe("newProjectPressFailure — what its dialog says when a step stops, and what Try again tries", () => {
  const UNSURE = { reason: "The platform did not answer.", uncertain: true } as const;
  const failedPress = (retryable: boolean) => ({
    kind: "failed" as const,
    reason: "Closing it off failed.",
    retryable,
  });
  it.each([
    { case: "a press under way", made: birth({ step: "create" }), press: null, want: null },
    {
      case: "a creation the platform refused: its own step again",
      made: birth({ step: "create", failed: NO_ROOM }),
      press: null,
      want: { reason: NO_ROOM.reason, tryAgain: "creation" },
    },
    {
      case: "a creation the platform may have taken: no second try",
      made: birth({ step: "create", failed: UNSURE }),
      press: null,
      want: { reason: UNSURE.reason, tryAgain: null },
    },
    {
      case: "its Mate's press stopped: the press again",
      made: birth({ step: "created", projectId: "p-1" }),
      press: failedPress(true),
      want: { reason: "Closing it off failed.", tryAgain: "press" },
    },
    {
      case: "its Mate's press stopped where trying again is not safe",
      made: birth({ step: "created", projectId: "p-1" }),
      press: failedPress(false),
      want: { reason: "Closing it off failed.", tryAgain: null },
    },
  ])("$case", ({ made, press, want }) => {
    expect(newProjectPressFailure(made, press)).toEqual(want);
  });
});
