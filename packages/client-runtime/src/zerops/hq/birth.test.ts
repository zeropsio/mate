import { describe, expect, it } from "@effect/vitest";

import {
  ZeropsApiError,
  type ZeropsOrganizationMember,
  type ZeropsProject,
  type ZeropsService,
} from "../api.ts";
import type { HqHealth } from "./client.ts";
import {
  HQ_BIRTH_START,
  runHqBirth,
  type HqBirthDeps,
  type HqBirthPlatform,
  type HqBirthRecord,
} from "./birth.ts";

const ORG = "org-1";
/** The HQ project's own domain, as the platform names it. */
const PUBLIC_ZONE = "qapsmj4u3rd3n03jj4au6r13i40.prg1-zerops.zone";
const ADDRESS = `https://${PUBLIC_ZONE}`;

interface Token {
  readonly id: string;
  readonly name: string;
  readonly roleCode: string;
  readonly projects: ReadonlyArray<unknown>;
  value: string;
}

/**
 * Zerops as a birth meets it: an import that makes the three services, which come up after a
 * few reads; a routing of the project's domain whose certificate turns active a few reads after
 * its sync; tokens that show in the member list; a deploy whose process finishes after a few
 * reads. `fail` makes one call throw once.
 */
function fakeZerops(
  options: {
    readonly members?: ReadonlyArray<ZeropsOrganizationMember>;
    /** The domain's certificate never turns active, the platform saying why. */
    readonly sslError?: string;
    /** Core was deployed before the birth reads anything. */
    readonly coreDeployed?: boolean;
    /** The organization's projects before the birth reads anything. */
    readonly projects?: ReadonlyArray<ZeropsProject>;
    /** The import is carried out, and its answer never reaches the birth: this is thrown instead. */
    readonly importAnswerLost?: unknown;
    /** How many builds Zerops refuses while the service's variables still sync. */
    readonly variablesSyncing?: number;
    /** How many variable writes Zerops refuses while the import's variables still sync. */
    readonly importVariablesSyncing?: number;
  } = {},
) {
  const calls: string[] = [];
  const projects: ZeropsProject[] = [...(options.projects ?? [])];
  const tokens: Token[] = [];
  const env = new Map<string, string>();
  const imports: string[] = [];
  const projectEnv = new Map<string, string>();
  /** What an import makes: a project's three services, coming up. */
  const imported = (): ZeropsService[] => [
    { id: "svc-db", name: "db", status: "CREATING" },
    { id: "svc-vol", name: "vol", status: "CREATING" },
    { id: "svc-hq", name: "hq", status: "CREATING" },
  ];
  // A project that stands already has its services, though no answer said so.
  let services: ZeropsService[] = projects.length > 0 ? imported() : [];
  let reads = 0;
  let processReads = 0;
  /** Core is deployed: `hq` has its HTTP port, and a routing may name it. */
  let deployed = options.coreDeployed === true;
  let minted = 0;
  let versions = 0;
  let syncing = options.variablesSyncing ?? 0;
  let importSyncing = options.importVariablesSyncing ?? 0;
  let routing: {
    id: string;
    isSynced: boolean;
    domain: string;
    sslStatus: string;
    reads: number;
  } | null = null;
  const failures = new Map<string, unknown>();
  const step = (name: string) => {
    calls.push(name);
    const failure = failures.get(name);
    if (failure !== undefined) {
      failures.delete(name);
      throw failure;
    }
  };
  const tokenMember = (token: Token): ZeropsOrganizationMember => ({
    id: `member-${token.id}`,
    roleCode: token.roleCode,
    status: "ACTIVE",
    user: { fullName: token.name, email: `token-${token.id}@zerops.io` },
  });
  const platform: HqBirthPlatform = {
    readProjectBirthEnv: async () => new Map(projectEnv),
    createProjectEnv: async (_projectId, key, content) => {
      if (projectEnv.has(key))
        throw new ZeropsApiError(
          "Project environment variable key is not unique (case insensitive).",
          "invalid-input",
          400,
        );
      projectEnv.set(key, content);
      return { processId: `env-${projectEnv.size}` };
    },
    listClientProjects: async (clientId) => {
      step("projects");
      expect(clientId).toBe(ORG);
      return projects;
    },
    listOrganizationMembers: async () => {
      step("members");
      return [...(options.members ?? []), ...tokens.map(tokenMember)];
    },
    listIntegrationTokens: async () => {
      step("tokens");
      return tokens.map(({ id, name, roleCode, projects }) => ({
        id,
        name,
        roleCode,
        projects: projects as never,
      }));
    },
    importProject: async (clientId, yaml) => {
      step("import");
      expect(clientId).toBe(ORG);
      imports.push(yaml);
      services = imported();
      // The direct read lists a project before its import has answered.
      const tagList = [...yaml.matchAll(/^    - "(.+)"$/gmu)].map((tag) => tag[1]!);
      projects.push({ id: "hq1", name: "Headquarters", status: "ACTIVE", tagList });
      for (const entry of yaml.matchAll(/^    (MATE_HQ_BIRTH_RECORD_0): (.+)$/gmu)) {
        projectEnv.set(entry[1]!, JSON.parse(entry[2]!) as string);
      }
      if (options.importAnswerLost !== undefined) throw options.importAnswerLost;
      return { projectId: "hq1" };
    },
    readProjectCreation: async () => ({
      processId: "process-import",
      status: "FINISHED",
      error: null,
    }),
    listProjectServices: async () => {
      step("services");
      reads += 1;
      if (reads >= 2) services = services.map((service) => ({ ...service, status: "ACTIVE" }));
      return services;
    },
    fetchProject: async (projectId) => {
      step("project");
      return {
        id: projectId,
        name: "Headquarters",
        status: "ACTIVE",
        publicZone: PUBLIC_ZONE,
      };
    },
    mintIntegrationToken: async (input) => {
      step(`mint ${input.name} ${input.roleCode}`);
      expect(input.projects).toEqual([]);
      const token = {
        id: `t${++minted}`,
        name: input.name,
        roleCode: input.roleCode,
        projects: [],
        value: `value-${minted}`,
      };
      tokens.push(token);
      return { id: token.id, token: token.value };
    },
    regenerateIntegrationToken: async ({ tokenId }) => {
      step(`regenerate ${tokenId}`);
      const token = tokens.find((entry) => entry.id === tokenId)!;
      token.value = `${token.value}-again`;
      return token.value;
    },
    hasServiceVariable: async ({ key }) => {
      step("env");
      return env.has(key);
    },
    writeServiceSecret: async ({ serviceId, key, content }) => {
      step(`secret ${serviceId} ${key}`);
      if (importSyncing > 0) {
        importSyncing -= 1;
        throw new ZeropsApiError(
          "Service environment variable synchronization is already running.",
          "invalid-input",
          400,
          "userDataSyncRunning",
        );
      }
      env.set(key, content);
    },
    createAppVersion: async (serviceId) => {
      step(`app-version ${serviceId}`);
      return { id: `av-${String(++versions)}` };
    },
    uploadAppVersionArchive: async (id, archive) => {
      step(`upload ${id} ${archive.byteLength}`);
    },
    buildAndDeployAppVersion: async (id, input) => {
      step(`deploy ${id} ${input.setup}`);
      if (syncing > 0) {
        syncing -= 1;
        // Measured in Mate s.r.o., 2026-10-03: the build right after HQ_ORG_TOKEN was written.
        throw new ZeropsApiError(
          "Service environment variable synchronization is already running.",
          "invalid-input",
          400,
          "userDataSyncRunning",
        );
      }
      processReads = 0;
      return { processId: "process-1" };
    },
    readProcessStatus: async (processId) => {
      if (processId.startsWith("env-") || processId === "process-import") return "FINISHED";
      step(`process ${processId}`);
      if (processId === "process-sync") return "FINISHED";
      processReads += 1;
      deployed = deployed || processReads >= 2;
      return processReads >= 2 ? "FINISHED" : "RUNNING";
    },
    listPublicHttpRoutings: async () => {
      step("routings");
      if (routing === null) return [];
      if (routing.isSynced) routing.reads += 1;
      if (routing.isSynced && routing.reads >= 2 && options.sslError === undefined) {
        routing.sslStatus = "ACTIVE";
      }
      return [
        {
          id: routing.id,
          isSynced: routing.isSynced,
          domains: [
            {
              domainName: routing.domain,
              sslStatus: routing.sslStatus,
              sslError: options.sslError,
            },
          ],
        },
      ];
    },
    createPublicHttpRouting: async (_projectId, input) => {
      const location = input.locations[0]!;
      if (!deployed) {
        // Measured in KRLS, 2026-10-02: a fresh import's `hq` has no HTTP port before Core's deploy.
        throw new ZeropsApiError("ServiceStack must supported http protocol", "invalid-input", 400);
      }
      step(
        `route ${input.domains.join(",")} -> ${location.serviceStackId}:${location.port}${location.path}`,
      );
      routing = {
        id: "routing-1",
        isSynced: false,
        domain: input.domains[0]!,
        sslStatus: "WAITING_FOR_DNS",
        reads: 0,
      };
    },
    syncPublicHttpRouting: async () => {
      step("sync");
      if (routing !== null) routing.isSynced = true;
      return { processId: "process-sync" };
    },
  };
  return {
    platform,
    calls,
    tokens,
    env,
    imports,
    projectEnv,
    failOnce: (call: string, cause: unknown) => failures.set(call, cause),
  };
}

function deps(
  zerops: ReturnType<typeof fakeZerops>,
  health: () => HqHealth = () => ({ kind: "healthy", build: "b1", parts: { quarantined: [] } }),
): HqBirthDeps {
  let now = 0;
  return {
    platform: zerops.platform,
    core: async () => ({
      build: "20261004T100000Z.0123456789ab",
      archive: new Uint8Array(7),
      zeropsYaml: "zerops:\n  - setup: hq\n",
    }),
    health: async (address) => {
      expect(address).toBe(ADDRESS);
      return health();
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
    newBirthId: () => "b1",
    randomBytes: (array) => array.map((_, index) => index + 1),
  };
}

/** What `deps` draws for HQ's key: bytes 1…32, in base64. */
const KEY_SECRET = btoa(
  String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 1)),
);

const INPUT = {
  clientId: ORG,
  zeropsApi: "https://api.app-prg1.zerops.io/api/rest/public",
};

async function birth(
  record: HqBirthRecord,
  zerops: ReturnType<typeof fakeZerops>,
  d = deps(zerops),
  again = false,
) {
  if (record.projectId !== null && zerops.projectEnv.size === 0) {
    zerops.projectEnv.set("MATE_HQ_BIRTH_RECORD_0", JSON.stringify({ version: 1, record }));
  }
  const patches: Array<Partial<HqBirthRecord>> = [];
  let held = record;
  const outcome = await runHqBirth({
    ...INPUT,
    record,
    deps: d,
    again,
    moved: (patch) => {
      patches.push(patch);
      held = { ...held, ...patch };
    },
  });
  return { outcome, patches, record: held };
}

describe("runHqBirth", () => {
  it("names Core's app version after the Core it deploys", async () => {
    const zerops = fakeZerops();
    const names: Array<string> = [];
    const named = {
      ...zerops,
      platform: {
        ...zerops.platform,
        createAppVersion: async (serviceId: string, name: string) => {
          names.push(name);
          return zerops.platform.createAppVersion(serviceId, name);
        },
      },
    };
    const result = await birth(HQ_BIRTH_START, named, deps(named));
    expect(result.outcome).toMatchObject({ ok: true });
    expect(names).toEqual(["hq-core.20261004T100000Z.0123456789ab"]);
  });

  it("stands HQ up from nothing: import, services, access, Core, its domain, anchor, official", async () => {
    const zerops = fakeZerops();
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);

    expect(outcome).toEqual({ ok: true, hq: { projectId: "hq1", address: ADDRESS } });
    expect(record).toMatchObject({
      step: "done",
      importId: "b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      appVersionId: "av-1",
      deployProcessId: "process-1",
    });
    expect(zerops.calls.filter((call) => !call.startsWith("process env-"))).toEqual([
      "members",
      "projects",
      "import",
      "services",
      "services",
      "services",
      // Core gets its access and is deployed first: it starts as a standby, its anchor missing.
      // Each of its variables is asked after by its own key, never the service's every one.
      "env",
      "tokens",
      "mint mate-hq-org:hq1 READ_ONLY",
      "secret svc-hq HQ_ORG_TOKEN",
      "env",
      "secret svc-hq HQ_KEY_SECRET",
      "app-version svc-hq",
      "upload av-1 7",
      "deploy av-1 hq",
      "process process-1",
      "process process-1",
      // Its HTTP port open, HQ's address is its project's own domain, routed to Core with SSL…
      "project",
      "routings",
      `route ${PUBLIC_ZONE} -> svc-hq:8080/`,
      "routings",
      "sync",
      "process process-sync",
      "routings",
      "routings",
      // …and only an address that serves is named as the organization's HQ.
      "members",
      "tokens",
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
    ]);
    // The anchor's value is dropped; the working token's, and HQ's key, are HQ's own secrets and
    // nothing else's.
    expect([...zerops.env]).toEqual([
      ["HQ_ORG_TOKEN", "value-1"],
      ["HQ_KEY_SECRET", KEY_SECRET],
    ]);
    const yaml = zerops.imports[0]!;
    expect(yaml).toContain("name: Headquarters");
    expect(yaml).not.toContain("  tags:");
    expect(yaml).toMatch(/hostname: hq\n/u);
    expect(yaml).not.toMatch(/hostname: core\b/u);
    expect(yaml).not.toContain("enableSubdomainAccess");
    // HQ answers any origin (bearer only), so a birth names none.
    expect(yaml).not.toContain("HQ_CLIENT_ORIGINS");
    expect(yaml).toContain('HQ_ZEROPS_API: "https://api.app-prg1.zerops.io/api/rest/public"');
    // Backup sets go to a private bucket of HQ's own, which Core reaches by the service's variables.
    expect(yaml).toContain(
      "  - hostname: backup\n    type: objectstorage\n    objectStorageSize: 80\n    objectStoragePolicy: private\n",
    );
    for (const [name, variable] of [
      ["URL", "apiUrl"],
      ["KEY_ID", "accessKeyId"],
      ["SECRET", "secretAccessKey"],
      ["BUCKET", "bucketName"],
      ["QUOTA_GB", "quotaGBytes"],
    ]) {
      expect(yaml).toContain(`      HQ_BACKUP_${name}: \${backup_${variable}}\n`);
    }
  });

  it("names the step that stopped, and Try again resumes there without making anything twice", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("deploy av-1 hq", new ZeropsApiError("Build refused", "invalid-input", 400));
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "deploy",
      reason: "Build refused",
      uncertain: false,
    });
    expect(first.record.step).toBe("deploy");

    zerops.calls.length = 0;
    const again = await birth(first.record, zerops, deps(zerops), true);
    expect(again.outcome).toMatchObject({ ok: true });
    // Nothing before the deploy is made again; the anchor comes after it, once.
    expect(zerops.calls.filter((call) => /^(import|mint|secret)/u.test(call))).toEqual([
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
    ]);
    // The version it uploaded is built: none is made and left behind.
    expect(zerops.calls[1]).toBe("deploy av-1 hq");
    expect(zerops.calls.filter((call) => /^(app-version|upload)/u.test(call))).toEqual([]);
  });

  it.each<[string, ReadonlyArray<ZeropsOrganizationMember>]>([
    [
      "an official HQ",
      [
        {
          id: "m1",
          roleCode: "ADMIN",
          status: "ACTIVE",
          user: { fullName: `mate-hq:other:${ADDRESS}`, email: "token-x@zerops.io" },
        },
      ],
    ],
    [
      "an anchor not active yet",
      [
        {
          id: "m1",
          roleCode: "ADMIN",
          status: "PENDING",
          user: { fullName: `mate-hq:other:${ADDRESS}`, email: "token-x@zerops.io" },
        },
      ],
    ],
  ])("is never born over %s the member list names", async (_name, members) => {
    const zerops = fakeZerops({ members });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason: "This organization has an HQ already.",
      uncertain: false,
    });
    expect(zerops.calls).toEqual(["members"]);
  });

  it("stops uncertain for any unanswered write, including a credential write", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "import",
      new ZeropsApiError("Zerops may have accepted this operation.", "uncertain"),
    );
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: false, step: "project", uncertain: true });

    // Every later step reads before it writes: its lost answer is one Try again settles.
    const later = fakeZerops();
    later.failOnce(
      "secret svc-hq HQ_ORG_TOKEN",
      new ZeropsApiError("Zerops may have accepted this operation.", "uncertain"),
    );
    expect((await birth(HQ_BIRTH_START, later)).outcome).toMatchObject({
      ok: false,
      step: "credential",
      uncertain: true,
    });
  });

  it.each<[string, ReadonlyArray<string>]>([
    // KRLS, 2026-10-02 05:40: a page imported, its kept record went, and the next page imported a
    // second Headquarters 2 s after the first.
    ["by a build before birth tags", ["mate:hq"]],
    ["by another birth", ["mate:hq", "another"]],
  ])(
    "imports nothing while a Headquarters made %s stands without an anchor",
    async (_n, tagList) => {
      const zerops = fakeZerops({
        projects: [
          { id: "CYJDpyAOQf6CCe6l9qDxkA", name: "Headquarters", status: "ACTIVE", tagList },
        ],
      });
      const { outcome } = await birth(HQ_BIRTH_START, zerops);
      expect(outcome).toEqual({
        ok: false,
        step: "project",
        reason:
          "Headquarters has no readable setup record. Ask an organization admin to inspect its project env in Zerops.",
        uncertain: false,
      });
      expect(zerops.imports).toEqual([]);
    },
  );

  /** A birth whose import was sent with its tag, the answer never read. */
  const SENT: HqBirthRecord = { ...HQ_BIRTH_START, importId: "b0" };
  const listed = (over: Partial<ZeropsProject> = {}): ZeropsProject => ({
    id: "hq1",
    name: "Headquarters",
    status: "ACTIVE",
    tagList: ["mate:hq", "b0"],
    ...over,
  });

  it("takes up the one project its birth's tag names, and imports nothing", async () => {
    const zerops = fakeZerops({ projects: [listed()] });
    zerops.projectEnv.set(
      "MATE_HQ_BIRTH_RECORD_0",
      JSON.stringify({ version: 1, record: { ...SENT, step: "services" } }),
    );
    const { outcome, record } = await birth(SENT, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
    expect(record).toMatchObject({ projectId: "hq1", importId: "b0" });
    expect(zerops.imports).toEqual([]);
  });

  it.each<[string, ReadonlyArray<ZeropsProject>]>([
    ["none listed yet", []],
    ["another birth's", [listed({ tagList: ["mate:hq", "other"] })]],
    ["one going away", [listed({ status: "DELETING" })]],
    ["one no longer tagged mate:hq", [listed({ tagList: ["b0"] })]],
    ["one of two", [listed(), listed({ id: "hq2" })]],
  ])("never imports again over a sent import, nor takes up %s", async (_name, projects) => {
    const zerops = fakeZerops({ projects });
    const { outcome, record } = await birth(SENT, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason:
        "Zerops did not confirm HQ's project. Press Again to find this setup's project; check Headquarters in Zerops before taking further action.",
      uncertain: true,
    });
    expect(record).toMatchObject(SENT);
    expect(zerops.imports).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["lost", new ZeropsApiError("Zerops may have accepted this operation.", "uncertain")],
    // The client drops an answer that comes back after its session moved on.
    [
      "dropped as the session moved",
      new ZeropsApiError("This account session has ended.", "expired-session", 401),
    ],
    ["unreadable", new SyntaxError("Unexpected end of JSON input")],
  ])(
    "takes up the project its import made where the answer was %s, and sends it once",
    async (_name, answer) => {
      const zerops = fakeZerops({ importAnswerLost: answer });
      const { outcome } = await birth(HQ_BIRTH_START, zerops);
      expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
      expect(zerops.imports).toHaveLength(1);
    },
  );

  it.each<[string, ZeropsApiError]>([
    ["invalid", new ZeropsApiError("Insufficient credit.", "invalid-input", 400)],
    ["forbidden", new ZeropsApiError("Not allowed.", "forbidden", 403)],
  ])("knows an import Zerops refused (%s) made nothing: Try again imports", async (_n, refusal) => {
    const zerops = fakeZerops();
    zerops.failOnce("import", refusal);
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "project",
      reason: /credit/iu.test(refusal.message)
        ? `${refusal.message}. Ask an organization owner to add credit in Zerops, then press Again.`
        : `${refusal.message}. Ask an organization owner to restore your access in Zerops, then press Again.`,
      uncertain: false,
    });
    expect(first.record).toMatchObject(HQ_BIRTH_START);
    expect((await birth(first.record, zerops, deps(zerops), true)).outcome).toMatchObject({
      ok: true,
    });
    expect(zerops.imports).toHaveLength(1);
  });

  it("keeps its birth's tag before the import is sent, and the import carries it", async () => {
    const zerops = fakeZerops();
    const kept: Array<readonly [Partial<HqBirthRecord>, number]> = [];
    await runHqBirth({
      ...INPUT,
      record: HQ_BIRTH_START,
      deps: deps(zerops),
      moved: (patch) => kept.push([patch, zerops.imports.length]),
    });
    expect(kept.slice(0, 2)).toEqual([
      [{ importId: "b1" }, 0],
      [{ step: "services", projectId: "hq1" }, 1],
    ]);
    expect(zerops.imports[0]).not.toContain("  tags:");
  });

  it("regenerates a working token whose variable is missing, and leaves a written one alone", async () => {
    const atCredential: HqBirthRecord = {
      step: "credential",
      importId: "b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      appVersionId: null,
      deployProcessId: null,
    };
    const zerops = fakeZerops();
    await zerops.platform.mintIntegrationToken({
      clientId: ORG,
      name: "mate-hq-org:hq1",
      roleCode: "READ_ONLY",
      projects: [],
    });
    zerops.calls.length = 0;
    const lost = await birth(atCredential, zerops);
    expect(lost.outcome).toMatchObject({ ok: true });
    expect(zerops.calls.slice(1, 5)).toEqual([
      "env",
      "tokens",
      "regenerate t1",
      "secret svc-hq HQ_ORG_TOKEN",
    ]);
    expect(zerops.env.get("HQ_ORG_TOKEN")).toBe("value-1-again");

    zerops.calls.length = 0;
    await birth(atCredential, zerops);
    expect(zerops.calls).toEqual(["members"]);
  });

  // Core seals its environments' deploy tokens under HQ_KEY_SECRET (`apps/hq/src/deployKeys.ts`):
  // written beside its token from the browser's own randomness, and never again once there — a key
  // written anew would leave every token sealed under the first opening nowhere.
  it.each<[string, ReadonlyArray<string>, ReadonlyArray<string>]>([
    ["neither", [], ["secret svc-hq HQ_ORG_TOKEN", "secret svc-hq HQ_KEY_SECRET"]],
    ["its token alone", ["HQ_ORG_TOKEN"], ["secret svc-hq HQ_KEY_SECRET"]],
    ["both", ["HQ_ORG_TOKEN", "HQ_KEY_SECRET"], []],
  ])(
    "gives Core its key, 32 random bytes in base64, where %s of its variables is there",
    async (_n, there, written) => {
      const zerops = fakeZerops();
      for (const name of there) zerops.env.set(name, `kept ${name}`);
      const { outcome } = await birth(
        {
          step: "credential",
          importId: "b1",
          projectId: "hq1",
          serviceId: "svc-hq",
          address: null,
          appVersionId: null,
          deployProcessId: null,
        },
        zerops,
      );
      expect(outcome).toMatchObject({ ok: true });
      expect(zerops.calls.filter((call) => call.startsWith("secret "))).toEqual(written);
      expect(zerops.env.get("HQ_KEY_SECRET")).toBe(
        there.includes("HQ_KEY_SECRET") ? "kept HQ_KEY_SECRET" : KEY_SECRET,
      );
    },
  );

  // Mate s.r.o., 2026-10-03: the build right after Core's token was written was refused, 400
  // userDataSyncRunning, while the service's variables synced.
  it("stops at once, in Zerops' words, where its build is refused for anything else", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "deploy av-1 hq",
      new ZeropsApiError(
        "Invalid zerops.yml: setup hq not found.",
        "invalid-input",
        400,
        "zeropsYamlInvalidParameter",
      ),
    );
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "deploy",
      reason: "Invalid zerops.yml: setup hq not found.",
      uncertain: false,
    });
    expect(zerops.calls.filter((call) => call.startsWith("deploy "))).toEqual(["deploy av-1 hq"]);
    expect(record.appVersionId).toBe("av-1");
  });

  it("deploys anew on Try again after a deploy that failed", async () => {
    const zerops = fakeZerops();
    const atDeploy: HqBirthRecord = {
      step: "deploy",
      importId: "b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      appVersionId: null,
      deployProcessId: null,
    };
    const failing = {
      ...zerops.platform,
      readProcessStatus: async (id: string) => (id.startsWith("env-") ? "FINISHED" : "FAILED"),
    };
    const first = await birth(atDeploy, zerops, { ...deps(zerops), platform: failing });
    expect(first.outcome).toMatchObject({ ok: false, step: "deploy" });
    expect(first.record.deployProcessId).toBeNull();
    expect(first.record.appVersionId).toBe("av-1");

    zerops.calls.length = 0;
    await birth(first.record, zerops, deps(zerops), true);
    expect(zerops.calls.filter((call) => /^(app-version|upload|deploy)/u.test(call))).toEqual([
      "deploy av-1 hq",
    ]);
  });

  it("stops at ready when HQ never answers as the official one", async () => {
    const zerops = fakeZerops();
    const { outcome } = await birth(
      HQ_BIRTH_START,
      zerops,
      deps(zerops, () => ({ kind: "not-ready", state: "standby", official: "anchor_missing" })),
    );
    expect(outcome).toEqual({
      ok: false,
      step: "ready",
      reason: "HQ answering as this organization's HQ took too long.",
      uncertain: false,
    });
  });

  /** A birth whose services are up: what it does for HQ's domain. */
  const AT_DOMAIN: HqBirthRecord = {
    ...HQ_BIRTH_START,
    step: "domain",
    deployProcessId: "process-1",
    projectId: "hq1",
    serviceId: "svc-hq",
  };

  it("deploys Core first where a birth stopped at the domain with no Core deployed behind it", async () => {
    // Headquarters in KRLS, 2026-10-02: a build that routed the domain before Core's deploy stopped
    // there with 400 "ServiceStack must supported http protocol".
    const zerops = fakeZerops();
    const { outcome } = await birth({ ...AT_DOMAIN, deployProcessId: null }, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { address: ADDRESS } });
    const order = zerops.calls.filter((call) => /^(secret|deploy|route|mint mate-hq:)/u.test(call));
    expect(order).toEqual([
      "secret svc-hq HQ_ORG_TOKEN",
      "secret svc-hq HQ_KEY_SECRET",
      "deploy av-1 hq",
      `route ${PUBLIC_ZONE} -> svc-hq:8080/`,
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
    ]);
  });

  it("makes no second routing and syncs no more where the domain is routed and in place", async () => {
    const zerops = fakeZerops({ coreDeployed: true });
    await zerops.platform.createPublicHttpRouting("hq1", {
      domains: [PUBLIC_ZONE],
      locations: [{ path: "/", port: 8080, serviceStackId: "svc-hq" }],
    });
    await zerops.platform.syncPublicHttpRouting("hq1");
    zerops.calls.length = 0;
    const { outcome, record } = await birth(AT_DOMAIN, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { address: ADDRESS } });
    expect(record.address).toBe(ADDRESS);
    expect(zerops.calls.filter((call) => /^(route|sync)/u.test(call))).toEqual([]);
  });

  it("stops at the domain, saying why its certificate is not ready, where it never turns active", async () => {
    const zerops = fakeZerops({
      sslError: "DNS for the domain does not resolve yet.",
      coreDeployed: true,
    });
    const { outcome, record } = await birth(AT_DOMAIN, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "domain",
      reason: `HQ's certificate for ${PUBLIC_ZONE} is not ready: DNS for the domain does not resolve yet.`,
      uncertain: false,
    });
    expect(record.address).toBeNull();
  });
});

describe("HQ birth shared progress", () => {
  const atDeploy = {
    ...HQ_BIRTH_START,
    step: "deploy" as const,
    importId: "b1",
    projectId: "hq1",
    serviceId: "svc-hq",
    appVersionId: "av-kept",
    deployProcessId: "process-1",
  };
  const underway = () =>
    fakeZerops({
      projects: [
        {
          id: "hq1",
          name: "Headquarters",
          status: "ACTIVE",
          tagList: ["mate:hq", "b1"],
        },
      ],
    });
  const seed = (zerops: ReturnType<typeof fakeZerops>, record: HqBirthRecord) =>
    zerops.projectEnv.set("MATE_HQ_BIRTH_RECORD_0", JSON.stringify({ version: 1, record }));

  it("a new browser automatically follows the project's recorded deploy handle", async () => {
    const zerops = underway();
    seed(zerops, atDeploy);
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.outcome).toMatchObject({ ok: true });
    expect(zerops.calls).toContain("process process-1");
    expect(
      zerops.calls.filter((call) => /^(import|app-version|upload|deploy)/u.test(call)),
    ).toEqual([]);
  });

  it("records the version handle before uploading, and the deploy handle before following it", async () => {
    const zerops = fakeZerops();
    const snapshots = () => [...zerops.projectEnv.values()].join("\n");
    zerops.platform.uploadAppVersionArchive = async (id) => {
      expect(snapshots()).toContain(id);
    };
    const read = zerops.platform.readProcessStatus;
    zerops.platform.readProcessStatus = async (id) => {
      if (!id.startsWith("env-")) expect(snapshots()).toContain(id);
      return read(id);
    };
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.outcome.ok).toBe(true);
  });

  it("a definite credit refusal stops once, with the reason and the way on", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "import",
      new ZeropsApiError("Insufficient credit", "invalid-input", 400, "insufficientCredit"),
    );
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.outcome).toMatchObject({
      ok: false,
      uncertain: false,
      reason: expect.stringMatching(/Insufficient credit.*add credit/iu),
    });
    expect(zerops.calls.filter((call) => call === "import")).toHaveLength(1);
  });

  it.each([
    {
      step: "credential",
      options: { importVariablesSyncing: 2 },
      call: "secret svc-hq HQ_ORG_TOKEN",
    },
    { step: "deploy", options: { variablesSyncing: 2 }, call: "deploy av-1 hq" },
  ])(
    "a $step sync refusal stops and each manual Again sends one attempt",
    async ({ step, options, call }) => {
      const zerops = fakeZerops(options);
      const stopped = {
        ok: false,
        step,
        reason: "Variables still syncing. Press Again to continue HQ's setup.",
        uncertain: false,
      };
      const first = await birth(HQ_BIRTH_START, zerops);
      expect(first.outcome).toEqual(stopped);
      expect(first.record.stopped).toEqual({ step, reason: stopped.reason, uncertain: false });
      expect(zerops.calls.filter((entry) => entry === call)).toHaveLength(1);
      if (step === "deploy") {
        expect(first.record).toMatchObject({ appVersionId: "av-1", archiveUploaded: true });
      }

      // A new browser reads the same stopped outcome and sends no side effect.
      const reopened = await birth(HQ_BIRTH_START, zerops);
      expect(reopened.outcome).toEqual(stopped);
      expect(zerops.calls.filter((entry) => entry === call)).toHaveLength(1);

      const second = await birth(reopened.record, zerops, deps(zerops), true);
      expect(second.outcome).toEqual(stopped);
      expect(zerops.calls.filter((entry) => entry === call)).toHaveLength(2);
      const finished = await birth(second.record, zerops, deps(zerops), true);
      expect(finished.outcome.ok).toBe(true);
      expect(zerops.calls.filter((entry) => entry === call)).toHaveLength(3);
      expect(zerops.calls.filter((entry) => entry.startsWith("app-version "))).toHaveLength(1);
      expect(zerops.calls.filter((entry) => entry.startsWith("upload "))).toHaveLength(1);
      expect(finished.record.appVersionId).toBe("av-1");
    },
  );

  it("a new browser reads a recorded refusal instead of automatically trying the failed step", async () => {
    const zerops = underway();
    seed(zerops, {
      ...atDeploy,
      stopped: {
        step: "deploy",
        reason: "Insufficient credit. Ask an organization owner to add credit, then press Again.",
        uncertain: false,
      },
    });
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.outcome).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Insufficient credit"),
    });
    expect(zerops.calls.filter((call) => call.startsWith("process "))).toEqual([]);
  });

  it("an unanswered upload is not sent again by the next browser", async () => {
    const zerops = underway();
    seed(zerops, { ...atDeploy, appVersionId: "av-kept", deployProcessId: null });
    zerops.projectEnv.set(
      "MATE_HQ_BIRTH_ACTION_upload_0",
      JSON.stringify({ state: "started", handles: { appVersionId: "av-kept" } }),
    );
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.outcome).toMatchObject({ ok: false, step: "deploy", uncertain: true });
    expect(zerops.calls.filter((call) => /^(app-version|upload|deploy)/u.test(call))).toEqual([]);
  });
});

describe("HQ birth takeover", () => {
  it("a stale claim transfers automatically, following the late receipt while only one browser sends the build", async () => {
    const zerops = fakeZerops({
      projects: [
        {
          id: "hq1",
          name: "Headquarters",
          status: "ACTIVE",
          tagList: ["mate:hq", "b1"],
        },
      ],
    });
    const record = {
      ...HQ_BIRTH_START,
      step: "deploy" as const,
      importId: "b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      appVersionId: "av-kept",
      archiveUploaded: true,
    };
    zerops.projectEnv.set("MATE_HQ_BIRTH_RECORD_0", JSON.stringify({ version: 1, record }));
    const entered = Promise.withResolvers<void>();
    const build = Promise.withResolvers<{ processId: string }>();
    let builds = 0;
    zerops.platform.buildAndDeployAppVersion = async () => {
      builds++;
      entered.resolve();
      return build.promise;
    };
    const first = birth(HQ_BIRTH_START, zerops);
    await entered.promise;
    let now = 90_001;
    const second = await birth(HQ_BIRTH_START, zerops, {
      ...deps(zerops),
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        build.resolve({ processId: "process-1" });
        await Promise.resolve();
      },
    });
    expect(second.outcome).toMatchObject({ ok: true });
    expect(builds).toBe(1);
    expect((await first).outcome).toMatchObject({ ok: false });
  });

  it("a recorded domain-sync process is followed even if the routing already reads synced", async () => {
    const zerops = fakeZerops({ coreDeployed: true });
    await zerops.platform.createPublicHttpRouting("hq1", {
      domains: [PUBLIC_ZONE],
      locations: [{ path: "/", port: 8080, serviceStackId: "svc-hq" }],
    });
    await zerops.platform.syncPublicHttpRouting("hq1");
    zerops.platform.readProcessStatus = async (id) =>
      id.startsWith("env-") ? "FINISHED" : "FAILED";
    const result = await birth(
      {
        ...HQ_BIRTH_START,
        step: "domain",
        projectId: "hq1",
        serviceId: "svc-hq",
        deployProcessId: "process-1",
        syncProcessId: "process-sync",
      },
      zerops,
    );
    expect(result.outcome).toMatchObject({ ok: false, step: "domain" });
  });

  it("a definite permission refusal tells the person how to restore access", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("import", new ZeropsApiError("Insufficient permissions", "forbidden", 403));
    expect((await birth(HQ_BIRTH_START, zerops)).outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(
        /Insufficient permissions.*organization owner.*access.*Again/iu,
      ),
    });
  });
});

describe("HQ import receipts", () => {
  it("retains the import process and service ids before waiting for services to become active", async () => {
    const zerops = fakeZerops();
    zerops.platform.listProjectServices = async () => [
      { id: "svc-hq", name: "hq", status: "FAILED" },
    ];
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.record).toMatchObject({
      importProcessId: "process-import",
      serviceIds: { hq: "svc-hq" },
    });
    expect(result.outcome).toMatchObject({
      ok: false,
      step: "services",
      reason: expect.stringContaining("FAILED"),
    });
  });

  it("a definite refusal on the accepted import's process stops with its platform reason", async () => {
    const zerops = fakeZerops();
    zerops.platform.readProjectCreation = async () => ({
      processId: "process-import",
      status: "FAILED",
      error: { code: "insufficientCredit", message: "Insufficient credit" },
    });
    const result = await birth(HQ_BIRTH_START, zerops);
    expect(result.outcome).toMatchObject({
      ok: false,
      step: "services",
      reason: expect.stringMatching(/Insufficient credit.*add credit/iu),
    });
    expect(result.record).toMatchObject({ importProcessId: "process-import" });
  });
});

it("a new browser deploys the uploaded version with its recorded YAML even without a bundled archive", async () => {
  const zerops = fakeZerops({
    projects: [
      {
        id: "hq1",
        name: "Headquarters",
        status: "ACTIVE",
        tagList: ["mate:hq", "b1"],
      },
    ],
  });
  zerops.projectEnv.set(
    "MATE_HQ_BIRTH_RECORD_0",
    JSON.stringify({
      version: 1,
      record: {
        ...HQ_BIRTH_START,
        step: "deploy",
        importId: "b1",
        projectId: "hq1",
        serviceId: "svc-hq",
        appVersionId: "av-kept",
        archiveUploaded: true,
        coreYaml: "zerops:\n  - setup: hq\n",
      },
    }),
  );
  const result = await birth(HQ_BIRTH_START, zerops, {
    ...deps(zerops),
    core: async () => {
      throw new Error("No bundled archive in this browser");
    },
  });
  expect(result.outcome).toMatchObject({ ok: true });
  expect(zerops.calls.filter((call) => /^(app-version|upload|deploy)/u.test(call))).toEqual([
    "deploy av-kept hq",
  ]);
});

it("a journal env process that fails prevents the next side effect", async () => {
  const zerops = fakeZerops();
  const read = zerops.platform.readProcessStatus;
  zerops.platform.readProcessStatus = async (id) => (id.startsWith("env-") ? "FAILED" : read(id));
  const result = await birth(HQ_BIRTH_START, zerops);
  expect(result.outcome).toMatchObject({ ok: false });
  expect(zerops.calls.filter((call) => /^(mint|app-version|upload|deploy)/u.test(call))).toEqual(
    [],
  );
});

it("waits for an imported project's initial journal to appear without importing another project", async () => {
  const zerops = fakeZerops({
    projects: [
      {
        id: "hq1",
        name: "Headquarters",
        status: "ACTIVE",
        tagList: ["mate:hq", "b1"],
      },
    ],
  });
  zerops.projectEnv.set(
    "MATE_HQ_BIRTH_RECORD_0",
    JSON.stringify({
      version: 1,
      record: {
        ...HQ_BIRTH_START,
        step: "deploy",
        importId: "b1",
        projectId: "hq1",
        serviceId: "svc-hq",
        appVersionId: "av-kept",
        deployProcessId: "process-1",
      },
    }),
  );
  const read = zerops.platform.readProjectBirthEnv;
  let reads = 0;
  zerops.platform.readProjectBirthEnv = async (id) => (++reads === 1 ? new Map() : read(id));
  const result = await birth(HQ_BIRTH_START, zerops);
  expect(result.outcome).toMatchObject({ ok: false, uncertain: false });
  expect(zerops.imports).toEqual([]);
});

it("follows a creation that was running at first and later refuses the project", async () => {
  const zerops = fakeZerops();
  let reads = 0;
  zerops.platform.readProjectCreation = async () =>
    ++reads === 1
      ? { processId: "process-import", status: "RUNNING", error: null }
      : {
          processId: "process-import",
          status: "FAILED",
          error: { code: "insufficientCredit", message: "Insufficient credit" },
        };
  const read = zerops.platform.readProcessStatus;
  zerops.platform.readProcessStatus = async (id) => (id === "process-import" ? "FAILED" : read(id));
  zerops.platform.listProjectServices = async () => [];
  expect((await birth(HQ_BIRTH_START, zerops)).outcome).toMatchObject({
    ok: false,
    reason: expect.stringMatching(/Insufficient credit.*add credit/iu),
  });
});

it("follows each recorded service-import process instead of trusting an active service listing", async () => {
  const zerops = fakeZerops();
  const read = zerops.platform.readProcessStatus;
  zerops.platform.readProcessStatus = async (id) =>
    id === "process-db-import" ? "FAILED" : read(id);
  zerops.platform.listProjectServices = async () =>
    ["db", "vol", "hq"].map((name) => ({ id: `svc-${name}`, name, status: "ACTIVE" }));
  const result = await birth(
    {
      ...HQ_BIRTH_START,
      step: "services",
      importId: "b1",
      projectId: "hq1",
      importProcesses: { "process-db-import": "svc-db" },
    },
    zerops,
  );
  expect(result.outcome).toMatchObject({
    ok: false,
    step: "services",
    reason: expect.stringContaining("FAILED"),
  });
  expect(zerops.calls.filter((call) => /^(mint|app-version|upload|deploy)/u.test(call))).toEqual(
    [],
  );
});
